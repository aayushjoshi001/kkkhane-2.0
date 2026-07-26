import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { postHotelPaymentIncomeAndLedger, postBargainDiscountExpense } from '@/lib/ledger'
import { computeFolioTotal } from '@/lib/folio'
import { findOrCreateCustomerCreditAccount, postCreditCharge, postLoyaltyEarn, postLoyaltyRedeem } from '@/lib/customerCredit'
import { syncInvoiceToIrd } from '@/lib/irdSync'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

/**
 * Fully settles every non-cancelled order matching the given session or
 * booking: marks every order_item 'served' and the order 'delivered', so it
 * drops out of the kitchen queue and the waiter/room-billing panels the same
 * moment the guest checks out — not just payment_status, which previously
 * left the kitchen thinking these orders were still active.
 *
 * payment_status/paid_at are only stamped for orders that weren't already
 * paid — an order settled mid-stay (e.g. a cash payment via the cashier)
 * keeps its original paid_at instead of being silently moved to the
 * checkout timestamp, which would corrupt revenue-by-day reporting.
 */
async function settleOrdersMatching(
    supabase: AdminClient,
    restaurantId: string,
    match: { session_id: string } | { booking_id: string },
) {
    // Fetch partner restaurant if linked
    const { data: hotelData } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id')
        .eq('id', restaurantId)
        .maybeSingle()

    const partnerRestaurantId = hotelData?.linked_restaurant_id
    const targetRestaurantIds = [restaurantId]
    if (partnerRestaurantId) {
        targetRestaurantIds.push(partnerRestaurantId)
    }

    let query = supabase
        .from('orders')
        .select('id')
        .in('restaurant_id', targetRestaurantIds)
        .neq('status', 'cancelled')

    query = 'session_id' in match
        ? query.eq('session_id', match.session_id)
        : query.eq('booking_id', match.booking_id)

    const { data: orders } = await query
    const orderIds = (orders || []).map(o => o.id)
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

    await supabase
        .from('orders')
        .update({ status: 'delivered' })
        .in('id', orderIds)

    await supabase
        .from('orders')
        .update({ payment_status: 'paid', paid_at: now })
        .in('id', orderIds)
        .neq('payment_status', 'paid')
}

/** Settles a session's orders and closes it — but only if the session really
 * belongs to this restaurant, matching the guard the old inline code had
 * before it was folded into settleOrdersMatching. */
async function settleAndCloseSession(
    supabase: AdminClient,
    restaurantId: string,
    sessionId: string,
) {
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (!session) return

    await settleOrdersMatching(supabase, restaurantId, { session_id: sessionId })
    await supabase
        .from('sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('status', 'active')
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            booking_id, room_id, total_amount, cash_paid, qr_paid, qr_code_id, session_id,
            discount_amount, discount_reason, credit_amount, customer_name, customer_phone,
            redeemed_points, extra_hour_charge,
        } = body

        if (!booking_id || !room_id) {
            return NextResponse.json({ error: 'Missing booking_id or room_id' }, { status: 400 })
        }

        // The client-declared total is kept only for reconciliation in the audit
        // trail — it is never what we charge (see computeFolioTotal).
        const clientTotal = Number(total_amount)
        if (total_amount != null && (!Number.isFinite(clientTotal) || clientTotal < 0)) {
            return NextResponse.json({ error: 'total_amount must be a number >= 0' }, { status: 400 })
        }

        // A stay can be settled cash + QR + credit in any combination — the
        // credit portion isn't collected now, it's charged to the guest's
        // customer_credit_accounts balance below (see findOrCreateCustomerCreditAccount).
        let creditAmount = Number(credit_amount) || 0
        if (creditAmount < 0) {
            return NextResponse.json({ error: 'credit_amount cannot be negative' }, { status: 400 })
        }
        const creditCustomerName = typeof customer_name === 'string' ? customer_name.trim() : ''
        const creditCustomerPhone = typeof customer_phone === 'string' ? customer_phone.trim() : ''
        if (creditAmount > 0 && (!creditCustomerName || !creditCustomerPhone)) {
            return NextResponse.json({ error: 'Customer name and phone are required for credit' }, { status: 400 })
        }
        const settledNow = (Number(cash_paid) || 0) + (Number(qr_paid) || 0) + creditAmount

        // A bargained room rate — any staff at checkout can apply one, but a
        // reason is mandatory as the audit trail (no separate manager
        // approval step, since a guest is standing there waiting to pay).
        const discountAmount = Number(discount_amount) || 0
        if (discountAmount < 0) {
            return NextResponse.json({ error: 'discount_amount cannot be negative' }, { status: 400 })
        }
        const discountReason = typeof discount_reason === 'string' ? discount_reason.trim() : ''
        if (discountAmount > 0 && !discountReason) {
            return NextResponse.json({ error: 'A reason is required to apply a discount' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Resolve target restaurant IDs for fetching the booking
        const { data: currentRest } = await supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', currentUser.restaurantId)
            .maybeSingle()

        const partnerId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
        const targetRestaurantIds = [currentUser.restaurantId]
        if (partnerId) {
            targetRestaurantIds.push(partnerId)
        }

        // 0. Fetch the booking (with stay dates + room) to combine the settlement
        // with the advance already collected and to recompute its folio.
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('id, paid_amount, status, check_in, check_out, room_id, guest_name, guest_phone, guest_email, restaurant_id')
            .eq('id', booking_id)
            .in('restaurant_id', targetRestaurantIds)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        // 0a. Authoritative, server-computed folio total — computed before the
        // atomic claim below so an invalid discount can be rejected without
        // ever flipping the booking to checked_out (that claim can't be
        // cleanly undone once made).
        const folio = await computeFolioTotal(supabase, {
            restaurantId: booking.restaurant_id,
            bookingId: booking_id,
            roomId: booking.room_id || room_id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            sessionId: session_id || null,
            discountAmount,
        })
        const extraHourCharge = Number(extra_hour_charge) || 0
        if (extraHourCharge < 0) {
            return NextResponse.json({ error: 'extra_hour_charge cannot be negative' }, { status: 400 })
        }

        if (discountAmount > folio.stayCost) {
            return NextResponse.json({ error: 'Discount cannot exceed the room rate' }, { status: 400 })
        }
        const authoritativeTotal = folio.total + extraHourCharge

        const { getRestaurantFeatures } = await import('@/lib/features')
        const features = await getRestaurantFeatures(booking.restaurant_id)
        const isInvoiceEnabled = !!features?.generateInvoiceEnabled

        if (!isInvoiceEnabled) {
            // 1. Settle the session orders (if session_id is provided)
            if (session_id) {
                await settleAndCloseSession(supabase, booking.restaurant_id, session_id)
            }

            // 2. Mark the booking as checked out
            const { error: bookingErr } = await supabase
                .from('bookings')
                .update({ status: 'checked_out', payment_status: 'paid' })
                .eq('id', booking_id)
            if (bookingErr) throw bookingErr

            // 3. Mark the room as dirty (vacant)
            const { error: roomErr } = await supabase
                .from('rooms')
                .update({ status: 'dirty' })
                .eq('id', room_id)
            if (roomErr) throw roomErr

            return NextResponse.json({ success: true, total: authoritativeTotal, breakdown: folio })
        }

        const clientMismatch = Number.isFinite(clientTotal)
            ? round2(Math.abs(clientTotal - authoritativeTotal))
            : null

        const newPaidAmount = (Number(booking.paid_amount) || 0) + settledNow
        const paymentStatus =
            authoritativeTotal > 0 && newPaidAmount >= authoritativeTotal ? 'paid'
                : newPaidAmount > 0 ? 'partial'
                    : 'unpaid'

        // 1. Fetch current restaurant linkage & split settings (from the booking's hotel)
        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('ledger_split_mode, billing_commission_rate, linked_restaurant_id, vat_registered, vat_number')
            .eq('id', booking.restaurant_id)
            .single()

        const partnerRestaurantId = restaurant?.linked_restaurant_id
        
        // 2. Fetch room details
        const { data: roomContext } = await supabase
            .from('rooms')
            .select('room_number')
            .eq('id', room_id)
            .single()

        const roomNumber = roomContext?.room_number || 'Unknown'
        const guestName = booking.guest_name || 'Guest'

        // 3. Resolve cash, qr, and credit splits
        const isIrd = features?.irdSyncEnabled === true
        const cashPaid = isIrd ? (Number(cash_paid) || 0) : Math.max(0, settledNow - creditAmount)
        const qrPaid = isIrd ? (Number(qr_paid) || 0) : 0

        let hotelCash = cashPaid
        let hotelQr = qrPaid
        let hotelCredit = creditAmount

        let restCash = 0
        let restQr = 0
        let restCredit = 0

        if (partnerRestaurantId && folio.ordersTotal > 0 && settledNow > 0) {
            const restaurantAlloc = Math.min(folio.ordersTotal, settledNow)
            const restaurantRatio = restaurantAlloc / settledNow

            restCash = round2(cashPaid * restaurantRatio)
            restQr = round2(qrPaid * restaurantRatio)
            restCredit = round2(creditAmount * restaurantRatio)

            hotelCash = round2(cashPaid - restCash)
            hotelQr = round2(qrPaid - restQr)
            hotelCredit = round2(creditAmount - restCredit)
        }

        // 4. Resolve customer credit account if credit is used (under booking's hotel)
        let creditAccountId: string | null = null
        if (creditAmount > 0) {
            const account = await findOrCreateCustomerCreditAccount(supabase, booking.restaurant_id, currentUser.id, {
                name: creditCustomerName,
                phone: creditCustomerPhone,
            })
            if ('error' in account) {
                return NextResponse.json({ error: `Credit account error: ${account.error}` }, { status: 400 })
            }
            creditAccountId = account.id
        }

        // 5. Invoke transaction-locked database RPC to settle checkout atomically
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('settle_booking_checkout_v2', {
            p_booking_id: booking_id,
            p_restaurant_id: booking.restaurant_id,
            p_room_id: room_id,
            p_session_id: session_id || null,
            p_hotel_cash: hotelCash,
            p_hotel_qr: hotelQr,
            p_hotel_credit: hotelCredit,
            p_rest_cash: restCash,
            p_rest_qr: restQr,
            p_rest_credit: restCredit,
            p_discount_amount: discountAmount,
            p_discount_reason: discountReason || '',
            p_hotel_credit_account_id: creditAccountId,
            p_room_number: roomNumber,
            p_guest_name: guestName,
            p_user_id: currentUser.id,
            p_partner_restaurant_id: partnerRestaurantId || null,
            p_settled_now: settledNow,
            p_new_paid_amount: newPaidAmount,
            p_payment_status: paymentStatus,
            p_authoritative_total: authoritativeTotal,
            p_orders_total: folio.ordersTotal,
            p_ledger_split_mode: restaurant?.ledger_split_mode || 'direct',
            p_commission_rate: Number(restaurant?.billing_commission_rate) || 0.00,
            p_extra_hour_charge: extraHourCharge
        })

        if (rpcErr) {
            console.error('RPC Checkout Transaction Error:', rpcErr)
            return NextResponse.json({ error: `Checkout transaction failed: ${rpcErr.message}` }, { status: 500 })
        }

        const resObj = rpcRes as unknown as { success: boolean; error?: string }
        if (!resObj.success) {
            return NextResponse.json({ error: resObj.error || 'Transaction rolled back' }, { status: 400 })
        }

        // Trigger IRD CBMS Synchronization
        const isVatRegistered = !!restaurant?.vat_registered
        const totalAmount = Number(authoritativeTotal) || 0
        const discountVal = Number(discountAmount) || 0
        const vatVal = isVatRegistered ? (totalAmount - (totalAmount / 1.13)) : 0
        const taxableVal = totalAmount - vatVal
        const invoiceNumber = `INV-HOTEL-${booking_id.split('-')[0].toUpperCase()}`

        void syncInvoiceToIrd(booking.restaurant_id, {
            invoiceNumber,
            buyerName: guestName,
            buyerPan: null,
            totalAmount,
            discountAmount: discountVal,
            taxableAmount: taxableVal,
            vatAmount: vatVal
        })

        // 6. Log audit event
        void logAudit({
            restaurantId: booking.restaurant_id,
            userId: currentUser.id,
            action: 'booking_checked_out',
            entityType: 'booking',
            entityId: booking_id,
            newValue: {
                total_amount: authoritativeTotal,
                folio,
                client_total: Number.isFinite(clientTotal) ? clientTotal : null,
                client_mismatch: clientMismatch,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
                cash_paid: Number(cash_paid) || 0,
                qr_paid: Number(qr_paid) || 0,
                discount_amount: discountAmount,
                discount_reason: discountAmount > 0 ? discountReason : null,
                session_id: session_id || null,
                split_mode: restaurant?.ledger_split_mode || 'direct',
                commission_rate: Number(restaurant?.billing_commission_rate) || 0
            },
        })

        // Handle loyalty points (5% earn on Cash/QR payments)
        const rPoints = Number(redeemed_points) || 0
        const phone = customer_phone ? customer_phone.trim() : (booking.guest_phone ? booking.guest_phone.trim() : '')
        const name = customer_name ? customer_name.trim() : (booking.guest_name ? booking.guest_name.trim() : 'Guest')
        if (phone && (cashPaid > 0 || qrPaid > 0 || rPoints > 0)) {
            const pointsToEarn = Math.round((cashPaid + qrPaid) * 0.05)
            const { data: account } = await supabase
                .from('customer_credit_accounts')
                .select('id')
                .eq('restaurant_id', booking.restaurant_id)
                .eq('customer_phone', phone)
                .maybeSingle()

            if (account) {
                if (pointsToEarn > 0) {
                    await postLoyaltyEarn(supabase, booking.restaurant_id, account.id, pointsToEarn, `Earned from Room ${roomNumber} stay`)
                }
                if (rPoints > 0) {
                    await postLoyaltyRedeem(supabase, booking.restaurant_id, account.id, rPoints, `Redeemed on Room ${roomNumber} stay`)
                }
            }
        }

        return NextResponse.json({ success: true, total: authoritativeTotal, breakdown: folio })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
