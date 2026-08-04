import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { postHotelPaymentIncomeAndLedger, postBargainDiscountExpense } from '@/lib/ledger'
import { findOrCreateCustomerCreditAccount, postCreditCharge, settleLoyalty } from '@/lib/customerCredit'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'
import { syncInvoiceToIrd } from '@/lib/irdSync'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>
type OrderRow = { id: string; total_amount: number }

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Dine-in equivalent of settleOrdersMatching (bookings/checkout/route.ts):
 * marks every item served and every order delivered/paid. A payment_verifications
 * row is written per order only when a method is given — credit settlements pass
 * null since no cash/qr/card fits the table's CHECK constraint, and no cash
 * actually moved yet (mirrors postBargainDiscountExpense's reasoning).
 */
async function settleOrders(
    supabase: AdminClient,
    restaurantId: string,
    userId: string,
    orders: OrderRow[],
    methodForOrder: (amount: number) => 'cash' | 'qr_scan' | null,
) {
    const orderIds = orders.map(o => o.id)
    if (orderIds.length === 0) return
    const now = new Date().toISOString()

    // Items still awaiting cashier confirmation (QR self-order, Order
    // Confirmation panel) were never sent to the kitchen or deducted stock —
    // force-marking them served here would be factually wrong, so they're
    // left untouched even though the order itself gets closed out below.
    await supabase
        .from('order_items')
        .update({ status: 'served' })
        .in('order_id', orderIds)
        .neq('status', 'cancelled')
        .eq('needs_confirmation', false)

    // cashier_id names who settled the bill, alongside the waiter_id/chef_id the
    // order already carries. Scoped to the same `neq('payment_status', 'paid')`
    // guard as paid_at for the same reason: an order settled earlier in the stay
    // keeps the cashier who actually took the money, not whoever closed the table.
    await supabase
        .from('orders')
        .update({ status: 'delivered', delivered_at: now, payment_status: 'paid', paid_at: now, cashier_id: userId })
        .in('id', orderIds)
        .neq('payment_status', 'paid')

    for (const order of orders) {
        const method = methodForOrder(Number(order.total_amount) || 0)
        if (!method) continue
        await supabase.from('payment_verifications').insert({
            restaurant_id: restaurantId,
            order_id: order.id,
            amount: order.total_amount,
            payment_method: method,
            staff_verified: true,
            staff_rejected: false,
            staff_verified_by: userId,
            staff_verified_at: now,
        })
    }
}

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            session_id, cash_paid, qr_paid, credit_amount, qr_code_id,
            discount_amount, discount_reason, customer_name, customer_phone,
            redeemed_points, service_charge_override,
        } = body

        if (!session_id) {
            return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
        }

        // A bargained table total — same audit-trail rule as the room checkout:
        // any staff can apply one, but a reason is mandatory.
        const discountAmount = Number(discount_amount) || 0
        if (discountAmount < 0) {
            return NextResponse.json({ error: 'discount_amount cannot be negative' }, { status: 400 })
        }
        const discountReason = typeof discount_reason === 'string' ? discount_reason.trim() : ''
        if (discountAmount > 0 && !discountReason) {
            return NextResponse.json({ error: 'A reason is required to apply a discount' }, { status: 400 })
        }

        // The cashier can type over the service charge the orders locked in at
        // placement time. Absent/null means "leave it on auto" — 0 is a real
        // instruction to waive it, so it has to survive the check below.
        const hasServiceChargeOverride = service_charge_override !== undefined && service_charge_override !== null && service_charge_override !== ''
        const serviceChargeOverride = hasServiceChargeOverride ? round2(Number(service_charge_override)) : null
        if (serviceChargeOverride !== null && (!Number.isFinite(serviceChargeOverride) || serviceChargeOverride < 0)) {
            return NextResponse.json({ error: 'service_charge_override must be a non-negative number' }, { status: 400 })
        }

        // Cash + QR + credit can be combined in any mix (e.g. Rs.300 cash +
        // Rs.100 QR on a Rs.500 bill, remaining Rs.100 on credit) — the client
        // already confirmed this exact breakdown with the cashier before
        // sending it (see CashierClient's settlement confirmation popup).
        const cashPaid = round2(Number(cash_paid) || 0)
        const qrPaid = round2(Number(qr_paid) || 0)
        const creditAmount = round2(Number(credit_amount) || 0)

        if (cashPaid < 0 || qrPaid < 0 || creditAmount < 0) {
            return NextResponse.json({ error: 'Payment amounts cannot be negative' }, { status: 400 })
        }

        const customerName = typeof customer_name === 'string' ? customer_name.trim() : ''
        const customerPhone = typeof customer_phone === 'string' ? customer_phone.trim() : ''
        if (creditAmount > 0 && (!customerName || !customerPhone)) {
            return NextResponse.json({ error: 'Customer name and phone are required for credit' }, { status: 400 })
        }

        const supabase = await createAdminClient()


        const { getRestaurantFeatures } = await import('@/lib/features')

        const [features, restResponse, sessionResponse, ordersResponse] = await Promise.all([
            getRestaurantFeatures(currentUser.restaurantId),
            supabase
                .from('restaurants')
                .select('vat_registered')
                .eq('id', currentUser.restaurantId)
                .single(),
            supabase
                .from('sessions')
                .select('id, table_id, booking_id, seat_number, tables:table_id(label)')
                .eq('id', session_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .maybeSingle(),
            supabase
                .from('orders')
                .select('id, total_amount, service_charge_amount')
                .eq('session_id', session_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .neq('status', 'cancelled')
                .neq('payment_status', 'paid')
        ])

        const isInvoiceEnabled = !!features?.generateInvoiceEnabled
        const restaurant = restResponse.data
        const session = sessionResponse.data
        const fetchError = sessionResponse.error
        const orders = ordersResponse.data
        const ordersError = ordersResponse.error

        if (fetchError) throw fetchError
        if (!session) {
            return NextResponse.json({ error: 'Table session not found' }, { status: 404 })
        }
        const baseLabel = (session.tables as unknown as { label: string } | null)?.label || 'Unknown'
        // Seat 2+ of a split table gets its seat in the ledger/audit descriptions
        // ("Table 4-2 bill settled") so per-seat settlements stay distinguishable.
        const seatNumber = (session as unknown as { seat_number?: number }).seat_number ?? 1
        const tableLabel = seatNumber >= 2 ? `${baseLabel}-${seatNumber}` : baseLabel

        // 0a. Authoritative bill: every non-cancelled, unpaid order on this
        // session. Each order's own total_amount is reused as-is (already
        // correctly tax/promo/loyalty-adjusted from placement time) — never
        // re-derived from raw line items here.
        if (ordersError) throw ordersError
        const subtotal = round2((orders || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0))

        // Each order's total_amount already contains its own service charge, so
        // an override is billed as the difference from that auto figure — adding
        // the whole overridden amount would charge the guest for it twice.
        const autoServiceCharge = round2((orders || []).reduce((sum, o) => sum + (Number(o.service_charge_amount) || 0), 0))
        const serviceChargeCharged = serviceChargeOverride ?? autoServiceCharge
        const serviceChargeDelta = round2(serviceChargeCharged - autoServiceCharge)
        const billableSubtotal = round2(subtotal + serviceChargeDelta)

        if (billableSubtotal < 0) {
            return NextResponse.json({ error: 'Service charge override makes the bill negative' }, { status: 400 })
        }
        if (discountAmount > billableSubtotal) {
            return NextResponse.json({ error: 'Discount cannot exceed the session total' }, { status: 400 })
        }
        const authoritativeTotal = round2(billableSubtotal - discountAmount)

        // A table settles in full, unlike a multi-day hotel stay — cash + QR +
        // credit must reconcile exactly to what's owed, catching a stale/
        // tampered request rather than silently over- or under-charging.
        if (isInvoiceEnabled && Math.abs(cashPaid + qrPaid + creditAmount - authoritativeTotal) > 0.01) {
            return NextResponse.json({ error: 'Cash + QR + Credit must add up to the total' }, { status: 400 })
        }

        // 0b. Atomically claim + settle the session's financial fields in one
        // statement, mirroring the booking route's atomic status flip — only
        // one concurrent request can move a row from active to closed, so a
        // double-click or retry can't both close it and both post income twice.
        const { data: claimed, error: claimError } = await supabase
            .from('sessions')
            .update({
                status: 'closed',
                closed_at: new Date().toISOString(),
                discount_amount: discountAmount,
                discount_reason: discountAmount > 0 ? discountReason : null,
                discount_applied_by: discountAmount > 0 ? currentUser.id : null,
                discount_applied_at: discountAmount > 0 ? new Date().toISOString() : null,
            })
            .eq('id', session_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('status', 'active')
            .select('id')

        if (claimError) throw claimError
        if (!claimed || claimed.length === 0) {
            return NextResponse.json({ error: 'Table session is already closed' }, { status: 409 })
        }

        const postCheckoutTasks: PromiseLike<any>[] = []

        postCheckoutTasks.push(markTableDirtyForSession(supabase, session_id))

        // The customer's "send a waiter to collect cash" request is now fulfilled.
        postCheckoutTasks.push(
            supabase
                .from('service_requests')
                .update({ status: 'completed', completed_at: new Date().toISOString() })
                .eq('session_id', session_id)
                .eq('request_type', 'request_bill')
                .in('status', ['pending', 'acknowledged'])
        )

        // 1. Settle every order — cash/QR draw from their pools in order and
        // record a per-order payment_verifications row (so the EOD
        // cash-vs-digital breakdown stays accurate); whatever's left once both
        // pools are exhausted is the credit portion, settled without one (no
        // cash moved for that order).
        let remainingCash = cashPaid
        let remainingQr = qrPaid
        const methodForOrder = (amount: number): 'cash' | 'qr_scan' | null => {
            if (remainingCash >= amount) {
                remainingCash -= amount
                return 'cash'
            }
            if (remainingQr >= amount) {
                remainingQr -= amount
                return 'qr_scan'
            }
            return null
        }
        await settleOrders(supabase, currentUser.restaurantId, currentUser.id, orders || [], methodForOrder)

        // 1b. If this session was linked to a hotel room booking, credit the table payment to the booking's paid_amount
        if (session.booking_id) {
            postCheckoutTasks.push((async () => {
                const { data: booking } = await supabase
                    .from('bookings')
                    .select('paid_amount')
                    .eq('id', session.booking_id)
                    .single()
                
                if (booking) {
                    const currentPaid = Number(booking.paid_amount || 0)
                    const addPaid = cashPaid + qrPaid
                    await supabase
                        .from('bookings')
                        .update({ paid_amount: currentPaid + addPaid })
                        .eq('id', session.booking_id)
                }
            })())
        }

        // 2. Post the actual money collected / owed.
        if (isInvoiceEnabled) {
            if (cashPaid > 0) {
                postCheckoutTasks.push(
                    postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                        guestName: customerName || 'Table Guest',
                        amount: cashPaid,
                        paymentMethod: 'cash',
                        isAdvance: false,
                        incomeCategoryName: 'Restaurant Sales',
                        dayBookCategory: 'order_payment',
                        description: `Table ${tableLabel} bill settled (Cash)`,
                    })
                )
            }
            if (qrPaid > 0) {
                postCheckoutTasks.push(
                    postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                        guestName: customerName || 'Table Guest',
                        amount: qrPaid,
                        paymentMethod: 'qr_digital',
                        isAdvance: false,
                        qrCodeId: qr_code_id || null,
                        incomeCategoryName: 'Restaurant Sales',
                        dayBookCategory: 'order_payment',
                        description: `Table ${tableLabel} bill settled (QR/Digital)`,
                    })
                )
            }
            if (creditAmount > 0) {
                postCheckoutTasks.push((async () => {
                    // The session is already claimed/closed and orders already settled
                    // above — a failure here is logged, not surfaced as a failed
                    // checkout, matching the cash/qr postings' best-effort treatment.
                    const account = await findOrCreateCustomerCreditAccount(supabase, currentUser.restaurantId, currentUser.id, {
                        name: customerName,
                        phone: customerPhone,
                    })
                    if ('error' in account) {
                        console.error('Failed to create/find customer credit account:', account.error)
                    } else {
                        await postCreditCharge(supabase, currentUser.restaurantId, currentUser.id, {
                            customerCreditAccountId: account.id,
                            amount: creditAmount,
                            description: `Table ${tableLabel} bill on credit (${customerName || 'Customer'})`,
                            incomeCategoryName: 'Restaurant Sales',
                        })
                    }
                })())
            }
            if (discountAmount > 0) {
                postCheckoutTasks.push(
                    postBargainDiscountExpense(supabase, currentUser.restaurantId, currentUser.id, {
                        guestName: customerName || 'Table Guest',
                        locationLabel: `Table ${tableLabel}`,
                        amount: discountAmount,
                        reason: discountReason,
                    })
                )
            }

            // Handle loyalty points (5% earn on Cash/QR payments). settleLoyalty
            // creates the guest's CRM record if this is their first visit — read
            // only, a cash-paying guest never had one and so never earned anything.
            postCheckoutTasks.push(
                settleLoyalty(supabase, currentUser.restaurantId, currentUser.id, {
                    name: customerName ? customerName.trim() : 'Table Guest',
                    phone: customerPhone ? customerPhone.trim() : '',
                    earnPoints: Math.round((cashPaid + qrPaid) * 0.05),
                    redeemPoints: Number(redeemed_points) || 0,
                    earnDescription: `Earned from Table ${tableLabel} bill`,
                    redeemDescription: `Redeemed on Table ${tableLabel} bill`,
                })
            )
        }

        await Promise.all(postCheckoutTasks)

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'table_session_checked_out',
            entityType: 'session',
            entityId: session_id,
            newValue: {
                subtotal,
                service_charge_auto: autoServiceCharge,
                service_charge_charged: serviceChargeCharged,
                service_charge_overridden: serviceChargeOverride !== null,
                discount_amount: discountAmount,
                discount_reason: discountAmount > 0 ? discountReason : null,
                total: authoritativeTotal,
                cash_paid: cashPaid,
                qr_paid: qrPaid,
                credit_amount: creditAmount,
                customer_name: creditAmount > 0 ? customerName : null,
                customer_phone: creditAmount > 0 ? customerPhone : null,
            },
        })

        // Trigger IRD CBMS Synchronization
        const isVatRegistered = !!restaurant?.vat_registered
        const totalAmount = Number(authoritativeTotal) || 0
        const discountVal = Number(discountAmount) || 0
        const vatVal = isVatRegistered ? (totalAmount - (totalAmount / 1.13)) : 0
        const taxableVal = totalAmount - vatVal
        const invoiceNumber = `INV-DINE-${session_id.split('-')[0].toUpperCase()}`

        void syncInvoiceToIrd(currentUser.restaurantId, {
            invoiceNumber,
            buyerName: customerName || 'Walk-in Guest',
            buyerPan: null,
            totalAmount,
            discountAmount: discountVal,
            taxableAmount: taxableVal,
            vatAmount: vatVal
        })

        return NextResponse.json({ success: true, total: authoritativeTotal, subtotal })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
