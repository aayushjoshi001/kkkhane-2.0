import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { postHotelPaymentIncomeAndLedger, postBargainDiscountExpense, postFinancialTransaction } from '@/lib/ledger'
import { findOrCreateCustomerCreditAccount, postCreditCharge, postCreditRepayment, settleLoyalty } from '@/lib/customerCredit'
import { syncInvoiceToIrd } from '@/lib/irdSync'
import { getNextInvoiceNumber } from '@/lib/invoiceNumber'
import { assertBusinessOpen } from '@/lib/auth/businessGuard'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Takeaway/delivery equivalent of settleOrders (tables/checkout/route.ts):
 * there's only ever one order here (no session to fan out across), but the
 * same cash-then-QR draw order applies so a split payment still tags the
 * order with a single, correct payment_verifications method.
 */
function resolveMethod(cashPaid: number, qrPaid: number, amount: number): 'cash' | 'qr_scan' | null {
    if (cashPaid >= amount) return 'cash'
    if (qrPaid >= amount) return 'qr_scan'
    return null
}

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const guard = await assertBusinessOpen(currentUser.restaurantId)
        if (!guard.allowed) {
            return NextResponse.json({ error: guard.error }, { status: 403 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            order_id, cash_paid, qr_paid, credit_amount, qr_code_id,
            discount_amount, discount_reason, customer_name, customer_phone,
            previous_due_amount,
        } = body

        if (!order_id) {
            return NextResponse.json({ error: 'Missing order_id' }, { status: 400 })
        }

        const { getRestaurantFeatures } = await import('@/lib/features')
        const features = await getRestaurantFeatures(currentUser.restaurantId)
        const isInvoiceEnabled = !!features?.generateInvoiceEnabled

        const discountAmount = Number(discount_amount) || 0
        if (discountAmount < 0) {
            return NextResponse.json({ error: 'discount_amount cannot be negative' }, { status: 400 })
        }
        const discountReason = typeof discount_reason === 'string' ? discount_reason.trim() : ''
        if (discountAmount > 0 && !discountReason) {
            return NextResponse.json({ error: 'A reason is required to apply a discount' }, { status: 400 })
        }

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

        // "Add previous due to this bill" — collects an old balance alongside
        // the current order in one transaction. Only real money can retire a
        // debt, so it has to come out of cash/QR, never out of new credit
        // (that would just be borrowing to pay off the same borrowing).
        const previousDueAmount = round2(Number(previous_due_amount) || 0)
        if (previousDueAmount < 0) {
            return NextResponse.json({ error: 'previous_due_amount cannot be negative' }, { status: 400 })
        }
        if (previousDueAmount > cashPaid + qrPaid + 0.01) {
            return NextResponse.json({ error: 'Previous due must be covered by cash or QR, not credit' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('vat_registered')
            .eq('id', currentUser.restaurantId)
            .single()

        // 0. Fetch the order to confirm it belongs to this restaurant, isn't
        // cancelled, and isn't already paid, before touching anything.
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('id, restaurant_id, order_type, total_amount, status, payment_status, customer_name, customer_phone')
            .eq('id', order_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }
        if (order.status === 'cancelled') {
            return NextResponse.json({ error: 'Order is cancelled' }, { status: 400 })
        }
        if (order.payment_status === 'paid') {
            return NextResponse.json({ error: 'Order is already paid' }, { status: 409 })
        }

        const isDelivery = order.order_type === 'delivery'
        const orderLabel = `${isDelivery ? 'Delivery' : 'Takeaway'} Order #${order.id.slice(0, 8).toUpperCase()}`

        const effectiveCustomerName = customerName || order.customer_name || ''
        const effectiveCustomerPhone = customerPhone || order.customer_phone || ''
        if (previousDueAmount > 0 && (!effectiveCustomerName || !effectiveCustomerPhone)) {
            return NextResponse.json({ error: 'Customer name and phone are required to collect a previous due' }, { status: 400 })
        }

        // Authoritative bill: the order's own total_amount, already correctly
        // tax/promo/loyalty-adjusted from placement time — never re-derived
        // from raw line items here (same rule as tables/checkout).
        const subtotal = round2(Number(order.total_amount) || 0)

        if (discountAmount > subtotal) {
            return NextResponse.json({ error: 'Discount cannot exceed the order total' }, { status: 400 })
        }
        // This order's own sale amount — used for the tax/IRD invoice and for
        // recognizing income, neither of which should see the previous-due
        // top-up (that money was already recognized as income back when the
        // original credit charge was posted).
        const orderTotal = round2(subtotal - discountAmount)
        // What actually has to be collected right now, across cash/QR/credit.
        const authoritativeTotal = round2(orderTotal + previousDueAmount)

        // Names both figures rather than just the rule — see the same check in
        // /api/tables/checkout for why the bare message was a dead end.
        if (isInvoiceEnabled && Math.abs(cashPaid + qrPaid + creditAmount - authoritativeTotal) > 0.01) {
            return NextResponse.json({
                error: `This bill is Rs. ${authoritativeTotal.toFixed(2)}, but Rs. ${round2(cashPaid + qrPaid + creditAmount).toFixed(2)} was entered (cash + QR + credit). Please re-check and try again.`,
                code: 'TOTAL_MISMATCH',
                expected_total: authoritativeTotal,
                submitted_total: round2(cashPaid + qrPaid + creditAmount),
            }, { status: 400 })
        }

        // Previous due is drawn off cash/QR first (whatever's left funds the
        // order itself), matching the same fixed draw-down order the checkout
        // already uses elsewhere (cash pool before QR pool).
        const dueFromCash = round2(Math.min(cashPaid, previousDueAmount))
        const dueFromQr = round2(Math.min(qrPaid, previousDueAmount - dueFromCash))
        const cashForOrder = round2(cashPaid - dueFromCash)
        const qrForOrder = round2(qrPaid - dueFromQr)

        // 1. Atomically claim the order — only one concurrent request can flip
        // it from unpaid to paid, so a double-click or retry can't post income
        // twice.
        const { data: claimed, error: claimError } = await supabase
            .from('orders')
            .update({
                status: 'delivered',
                delivered_at: new Date().toISOString(),
                payment_status: 'paid',
                paid_at: new Date().toISOString(),
                cashier_id: currentUser.id,
            })
            .eq('id', order_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('payment_status', 'paid')
            .select('id')

        if (claimError) throw claimError
        if (!claimed || claimed.length === 0) {
            return NextResponse.json({ error: 'Order is already paid' }, { status: 409 })
        }

        // Items still awaiting cashier confirmation (QR self-order, Order
        // Confirmation panel) were never sent to the kitchen or deducted
        // stock — force-marking them served would be factually wrong.
        await supabase
            .from('order_items')
            .update({ status: 'served' })
            .eq('order_id', order_id)
            .neq('status', 'cancelled')
            .eq('needs_confirmation', false)

        const method = resolveMethod(cashForOrder, qrForOrder, subtotal)
        if (method) {
            await supabase.from('payment_verifications').insert({
                restaurant_id: currentUser.restaurantId,
                order_id: order.id,
                amount: subtotal,
                payment_method: method,
                staff_verified: true,
                staff_rejected: false,
                staff_verified_by: currentUser.id,
                staff_verified_at: new Date().toISOString(),
            })
        }

        // 2. Post the actual money collected / owed. Only the order's own
        // portion (cashForOrder/qrForOrder) counts as new sales income — the
        // previous-due portion is posted separately below as a plain Day Book
        // movement plus a receivable_transactions payment, never as income
        // (that income was already recognized when the due was first charged).
        if (isInvoiceEnabled) {
            if (cashForOrder > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    guestName: customerName || order.customer_name || 'Walk-in Guest',
                    amount: cashForOrder,
                    paymentMethod: 'cash',
                    isAdvance: false,
                    incomeCategoryName: 'Restaurant Sales',
                    dayBookCategory: 'order_payment',
                    description: `${orderLabel} settled (Cash)`,
                })
            }
            if (qrForOrder > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    guestName: customerName || order.customer_name || 'Walk-in Guest',
                    amount: qrForOrder,
                    paymentMethod: 'qr_digital',
                    isAdvance: false,
                    qrCodeId: qr_code_id || null,
                    incomeCategoryName: 'Restaurant Sales',
                    dayBookCategory: 'order_payment',
                    description: `${orderLabel} settled (QR/Digital)`,
                })
            }
            if (previousDueAmount > 0) {
                const account = await findOrCreateCustomerCreditAccount(supabase, currentUser.restaurantId, currentUser.id, {
                    name: effectiveCustomerName,
                    phone: effectiveCustomerPhone,
                })
                if ('error' in account) {
                    console.error('Failed to resolve customer credit account for previous-due collection:', account.error)
                } else {
                    await postCreditRepayment(supabase, currentUser.restaurantId, currentUser.id, {
                        customerCreditAccountId: account.id,
                        amount: previousDueAmount,
                        description: `Previous due collected with ${orderLabel} (${effectiveCustomerName})`,
                    })
                    if (dueFromCash > 0) {
                        await postFinancialTransaction(supabase, { id: currentUser.id, restaurantId: currentUser.restaurantId }, {
                            type: 'cash_in',
                            amount: dueFromCash,
                            description: `Previous due collected: ${effectiveCustomerName} (${orderLabel})`,
                            category: 'order_payment',
                            requireOpenSession: false,
                        })
                    }
                    if (dueFromQr > 0) {
                        await postFinancialTransaction(supabase, { id: currentUser.id, restaurantId: currentUser.restaurantId }, {
                            type: 'bank_in',
                            amount: dueFromQr,
                            description: `Previous due collected: ${effectiveCustomerName} (${orderLabel})`,
                            category: 'order_payment',
                            requireOpenSession: false,
                        })
                    }
                }
            }
            if (creditAmount > 0) {
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
                        description: `${orderLabel} on credit (${customerName || order.customer_name || 'Customer'})`,
                        incomeCategoryName: 'Restaurant Sales',
                    })
                }
            }
            if (discountAmount > 0) {
                await postBargainDiscountExpense(supabase, currentUser.restaurantId, currentUser.id, {
                    guestName: customerName || order.customer_name || 'Walk-in Guest',
                    locationLabel: orderLabel,
                    amount: discountAmount,
                    reason: discountReason,
                })
            }

            // Loyalty points (5% earn on Cash/QR payments). settleLoyalty
            // creates the guest's CRM record if this is their first visit — read
            // only, a cash-paying guest never had one and so never earned anything.
            await settleLoyalty(supabase, currentUser.restaurantId, currentUser.id, {
                name: customerName || order.customer_name || 'Walk-in Guest',
                phone: customerPhone || order.customer_phone || '',
                earnPoints: Math.round((cashForOrder + qrForOrder) * 0.05),
                redeemPoints: 0,
                earnDescription: `Earned from ${orderLabel}`,
                redeemDescription: '',
            })
        }

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'order_checked_out',
            entityType: 'order',
            entityId: order_id,
            newValue: {
                subtotal,
                discount_amount: discountAmount,
                discount_reason: discountAmount > 0 ? discountReason : null,
                total: orderTotal,
                cash_paid: cashPaid,
                qr_paid: qrPaid,
                credit_amount: creditAmount,
                previous_due_amount: previousDueAmount,
                customer_name: creditAmount > 0 || previousDueAmount > 0 ? effectiveCustomerName : null,
                customer_phone: creditAmount > 0 || previousDueAmount > 0 ? effectiveCustomerPhone : null,
            },
        })

        // Trigger IRD CBMS Synchronization — the order's own sale amount only;
        // the previous-due top-up isn't a new taxable sale, it's collection of
        // an old balance already invoiced when the due was first charged.
        const isVatRegistered = !!restaurant?.vat_registered
        const totalAmount = Number(orderTotal) || 0
        const discountVal = Number(discountAmount) || 0
        const vatVal = isVatRegistered ? (totalAmount - (totalAmount / 1.13)) : 0
        const taxableVal = totalAmount - vatVal
        const invoiceNumber = await getNextInvoiceNumber(currentUser.restaurantId)

        void syncInvoiceToIrd(currentUser.restaurantId, {
            invoiceNumber,
            buyerName: customerName || order.customer_name || 'Walk-in Guest',
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
