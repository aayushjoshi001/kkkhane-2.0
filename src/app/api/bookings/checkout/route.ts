import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { postHotelPaymentIncomeAndLedger, postBargainDiscountExpense } from '@/lib/ledger'
import { computeFolioForStays } from '@/lib/folio'
import { findOrCreateCustomerCreditAccount, postCreditCharge, settleLoyalty } from '@/lib/customerCredit'
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
    userId: string,
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

    // cashier_id rides with paid_at, and so inherits its guard: an order the
    // guest settled mid-stay keeps the cashier who took that money rather than
    // being reattributed to whoever ran the checkout.
    await supabase
        .from('orders')
        .update({ payment_status: 'paid', paid_at: now, cashier_id: userId })
        .in('id', orderIds)
        .neq('payment_status', 'paid')
}

/** Settles a session's orders and closes it — but only if the session really
 * belongs to this restaurant, matching the guard the old inline code had
 * before it was folded into settleOrdersMatching. */
async function settleAndCloseSession(
    supabase: AdminClient,
    restaurantId: string,
    userId: string,
    sessionId: string,
) {
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (!session) return

    await settleOrdersMatching(supabase, restaurantId, userId, { session_id: sessionId })
    await supabase
        .from('sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('status', 'active')
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Records how much of a checkout settlement came in as cash vs QR, on the
 * same booking_payments table the advance already writes to (see
 * POST /api/bookings) — so "total cash/QR received" for a stay is a single
 * SUM query across both rows instead of parsed out of the audit log. Cash/QR
 * figures are what the guest actually handed over (pre partner-restaurant
 * split), matching what a front-desk read of "money received" means; the
 * credit portion isn't cash or QR, so it only affects `amount`.
 */
async function recordSettlementPayment(
    supabase: AdminClient,
    restaurantId: string,
    bookingId: string,
    userId: string,
    cash: number,
    qr: number,
    credit: number,
) {
    const amount = round2(cash + qr + credit)
    if (amount <= 0) return
    const method = cash > 0 && qr > 0 ? 'split' : cash > 0 ? 'cash' : qr > 0 ? 'qr_digital' : 'credit'
    const { error } = await supabase.from('booking_payments').insert({
        restaurant_id: restaurantId,
        booking_id: bookingId,
        amount,
        payment_method: method,
        cash_amount: round2(cash),
        qr_amount: round2(qr),
        note: 'Settlement',
        created_by: userId,
    })
    if (error) console.error('Failed to record settlement payment:', error)
}

/**
 * Split a reservation's single settled bill back out across its rooms.
 *
 * The guest pays once, but `bookings.total_amount`/`paid_amount` are per-room
 * columns that revenue-by-room reporting reads. Dumping the whole bill on one
 * room would make that room look enormously profitable and the others free, so
 * each room takes a share proportional to its own stay cost — the one figure
 * that is genuinely attributable to it.
 *
 * Rounding remainders go to the first room so the parts always sum back to the
 * exact total charged; the extra-hour charge rides there too, for the same
 * reason. Rooms with no rate on file fall back to an even split.
 */
function allocateAcrossRooms(
    members: Array<{ id: string; room_id: string }>,
    folio: { rooms: Array<{ bookingId: string; stayCost: number }> },
    totals: {
        authoritativeTotal: number
        newPaidAmount: number
        discountAmount: number
        extraHourCharge: number
    },
) {
    const stayCostFor = new Map(folio.rooms.map(r => [r.bookingId, r.stayCost]))
    const weights = members.map(m => stayCostFor.get(m.id) ?? 0)
    const weightTotal = weights.reduce((s, w) => s + w, 0)
    const share = (i: number) => (weightTotal > 0 ? weights[i] / weightTotal : 1 / members.length)

    const rows = members.map((m, i) => ({
        booking_id: m.id,
        room_id: m.room_id,
        total_amount: round2(totals.authoritativeTotal * share(i)),
        paid_amount: round2(totals.newPaidAmount * share(i)),
        discount_amount: round2(totals.discountAmount * share(i)),
        extra_hour_charge: 0,
    }))

    const fix = (key: 'total_amount' | 'paid_amount' | 'discount_amount', target: number) => {
        const allocated = rows.reduce((s, r) => s + r[key], 0)
        rows[0][key] = round2(rows[0][key] + (target - allocated))
    }
    fix('total_amount', totals.authoritativeTotal)
    fix('paid_amount', totals.newPaidAmount)
    fix('discount_amount', totals.discountAmount)
    rows[0].extra_hour_charge = totals.extraHourCharge

    return rows
}

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
            redeemed_points, extra_hour_charge, service_charge_override,
            close_stay,
        } = body

        if (!booking_id || !room_id) {
            return NextResponse.json({ error: 'Missing booking_id or room_id' }, { status: 400 })
        }

        // Guests settle before they leave — the card is here now, the group is
        // splitting up, they're going before the desk is staffed — and the room
        // is still theirs until morning. False takes every peso exactly as a
        // checkout does and then stops: the stay stays open, the room stays
        // occupied, the QR session stays orderable. Absent means true, so every
        // caller that predates this behaves exactly as it did.
        const closeStay = close_stay !== false

        // The client-declared total is kept only for reconciliation in the audit
        // trail — it is never what we charge (see computeFolioTotal).
        const clientTotal = Number(total_amount)
        if (total_amount != null && (!Number.isFinite(clientTotal) || clientTotal < 0)) {
            return NextResponse.json({ error: 'total_amount must be a number >= 0' }, { status: 400 })
        }

        // Unlike total_amount, this one IS charged: the cashier can replace the
        // service charge the folio rules work out. Absent/null keeps it on auto,
        // 0 waives it — so the empty-string case has to be excluded explicitly
        // rather than leaning on Number('') being 0.
        const hasServiceChargeOverride = service_charge_override !== undefined && service_charge_override !== null && service_charge_override !== ''
        const serviceChargeOverride = hasServiceChargeOverride ? round2(Number(service_charge_override)) : null
        if (serviceChargeOverride !== null && (!Number.isFinite(serviceChargeOverride) || serviceChargeOverride < 0)) {
            return NextResponse.json({ error: 'service_charge_override must be a non-negative number' }, { status: 400 })
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
            .select('id, paid_amount, status, check_in, check_out, checked_out_at, bill_settled_at, room_id, group_id, guest_name, guest_phone, guest_email, restaurant_id')
            .eq('id', booking_id)
            .in('restaurant_id', targetRestaurantIds)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        // 0a. Resolve every room being settled. A multi-room reservation checks
        // out as one unit — the guest pays a single combined bill — so checking
        // out any one of its rooms settles them all. A normal stay is just a
        // group of one and follows the identical path below.
        type Member = {
            id: string
            room_id: string
            check_in: string
            check_out: string
            checked_out_at: string | null
            status: string | null
            paid_amount: number | null
        }
        let members: Member[] = [{
            id: booking.id,
            room_id: booking.room_id || room_id,
            check_in: booking.check_in,
            check_out: booking.check_out,
            checked_out_at: booking.checked_out_at ?? null,
            status: booking.status ?? null,
            paid_amount: booking.paid_amount,
        }]

        if (booking.group_id) {
            const { data: groupRows } = await supabase
                .from('bookings')
                .select('id, room_id, check_in, check_out, checked_out_at, status, paid_amount')
                .eq('group_id', booking.group_id)
                .neq('status', 'cancelled')
                .order('created_at', { ascending: true })
            if (groupRows && groupRows.length > 0) {
                members = groupRows as Member[]
            }
        }
        const isGroup = members.length > 1

        // 0b. Authoritative, server-computed folio total — computed before the
        // atomic claim below so an invalid discount can be rejected without
        // ever flipping the booking to checked_out (that claim can't be
        // cleanly undone once made).
        const folio = await computeFolioForStays(supabase, {
            restaurantId: booking.restaurant_id,
            stays: members.map(m => ({
                bookingId: m.id,
                roomId: m.room_id,
                checkIn: m.check_in,
                checkOut: m.check_out,
                // Still in house at this point, so the folio bills the overstay
                // up to now — which is the moment the RPC below stamps as the
                // departure, keeping the charge and the record consistent.
                checkedOutAt: m.checked_out_at,
                status: m.status,
            })),
            sessionId: session_id || null,
            discountAmount,
            serviceChargeOverride,
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

        const memberIds = members.map(m => m.id)
        // Only the rooms this reservation is still in. A room that departed
        // early (see /api/bookings/checkout-room) was handed to housekeeping
        // then and may well have a different guest in it by now — sending it to
        // 'dirty' again would evict a stranger from the board.
        const memberRoomIds = members
            .filter(m => m.status !== 'checked_out')
            .map(m => m.room_id)

        if (!isInvoiceEnabled) {
            // 1. Settle the session orders (if session_id is provided). On an
            // early settlement the orders are marked paid but the session is
            // left open — the guest still has the room, and closing their QR
            // session would take away ordering for the rest of the stay.
            if (session_id) {
                if (closeStay) {
                    await settleAndCloseSession(supabase, booking.restaurant_id, currentUser.id, session_id)
                } else {
                    await settleOrdersMatching(supabase, booking.restaurant_id, currentUser.id, { session_id })
                }
            }

            // 2. Mark the booking(s) as checked out — every room of a group
            // reservation, since they settled on one bill. An early settlement
            // records the money and the cashier but leaves the stay open.
            const now = new Date().toISOString()
            const { error: bookingErr } = await supabase
                .from('bookings')
                .update({
                    payment_status: 'paid',
                    cashier_id: currentUser.id,
                    // Remembered so a later recompute of this folio doesn't
                    // rebuild the service charge from the rules and quote a
                    // figure the guest was never charged.
                    service_charge_override: serviceChargeOverride,
                    ...(closeStay
                        ? {
                            status: 'checked_out',
                            // Freezes the overstay: without it the folio would
                            // read the clock on every later recompute and a
                            // settled bill would keep growing.
                            checked_out_at: now,
                        }
                        : {
                            // Deliberately not frozen — the guest is still in
                            // the room, so further nights and orders are real
                            // charges and belong on this same folio.
                            bill_settled_at: booking.bill_settled_at ?? now,
                        }),
                })
                .in('id', memberIds)
            if (bookingErr) throw bookingErr

            // 3. Mark the room(s) as dirty (vacant) — only once the guest has
            // actually vacated.
            if (closeStay) {
                const { error: roomErr } = await supabase
                    .from('rooms')
                    .update({ status: 'dirty' })
                    .in('id', memberRoomIds)
                if (roomErr) throw roomErr
            }

            await recordSettlementPayment(
                supabase, booking.restaurant_id, booking_id, currentUser.id,
                Number(cash_paid) || 0, Number(qr_paid) || 0, creditAmount,
            )

            return NextResponse.json({
                success: true,
                total: authoritativeTotal,
                breakdown: folio,
                closed: closeStay,
            })
        }

        const clientMismatch = Number.isFinite(clientTotal)
            ? round2(Math.abs(clientTotal - authoritativeTotal))
            : null

        // Advances were collected per room (the creation route spreads a group's
        // single advance across its rooms), so the already-paid figure for the
        // bill is the sum over every room on it.
        const priorPaid = members.reduce((s, m) => s + (Number(m.paid_amount) || 0), 0)
        const newPaidAmount = priorPaid + settledNow
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
        
        // 2. Fetch room details. The folio already resolved a number for every
        // room on the bill, so the ledger description names all of them
        // ("101, 102, 205") rather than just the room that was clicked.
        const roomLabel = folio.rooms.map(r => r.roomNumber).filter(Boolean).join(', ')
        let roomNumber = roomLabel
        if (!roomNumber) {
            const { data: roomContext } = await supabase
                .from('rooms')
                .select('room_number')
                .eq('id', room_id)
                .maybeSingle()
            roomNumber = roomContext?.room_number || 'Unknown'
        }
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

        // Charged, not auto: a waived service charge shrinks the partner
        // restaurant's share of what was collected, and a raised one grows it,
        // rather than the hotel silently absorbing the difference.
        if (partnerRestaurantId && folio.ordersTotalCharged > 0 && settledNow > 0) {
            const restaurantAlloc = Math.min(folio.ordersTotalCharged, settledNow)
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

        // 5. Invoke transaction-locked database RPC to settle checkout atomically.
        // A group reservation goes through the group RPC so all of its rooms
        // close in one transaction and the payment posts to the day book once,
        // instead of once per room.
        const sharedRpcArgs = {
            p_restaurant_id: booking.restaurant_id,
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
            p_guest_name: guestName,
            p_user_id: currentUser.id,
            p_partner_restaurant_id: partnerRestaurantId || null,
            p_payment_status: paymentStatus,
            p_authoritative_total: authoritativeTotal,
            // Drives the B2B payable to the partner restaurant and the
            // commission taken off it, so it tracks the charged figure for the
            // same reason the direct-mode split above does.
            p_orders_total: folio.ordersTotalCharged,
            p_ledger_split_mode: restaurant?.ledger_split_mode || 'direct',
            p_commission_rate: Number(restaurant?.billing_commission_rate) || 0.00,
            p_extra_hour_charge: extraHourCharge,
            // The money posts identically either way; this decides only whether
            // the stay, its session and its room are closed behind it.
            p_close_stay: closeStay,
        }

        const { data: rpcRes, error: rpcErr } = isGroup
            ? await supabase.rpc('settle_booking_group_checkout', {
                ...sharedRpcArgs,
                p_room_label: roomNumber,
                p_bookings: allocateAcrossRooms(members, folio, {
                    authoritativeTotal,
                    newPaidAmount,
                    discountAmount,
                    extraHourCharge,
                }),
            })
            : await supabase.rpc('settle_booking_checkout_v2', {
                ...sharedRpcArgs,
                p_booking_id: booking_id,
                p_room_id: room_id,
                p_room_number: roomNumber,
                p_settled_now: settledNow,
                p_new_paid_amount: newPaidAmount,
            })

        if (rpcErr) {
            console.error('RPC Checkout Transaction Error:', rpcErr)
            return NextResponse.json({ error: `Checkout transaction failed: ${rpcErr.message}` }, { status: 500 })
        }

        const resObj = rpcRes as unknown as { success: boolean; error?: string }
        if (!resObj.success) {
            return NextResponse.json({ error: resObj.error || 'Transaction rolled back' }, { status: 400 })
        }

        // cashPaid/qrPaid are what the guest actually handed over, before the
        // hotel/restaurant partner split above — that split only decides whose
        // books the money lands in, not how much cash vs QR was received.
        await recordSettlementPayment(
            supabase, booking.restaurant_id, booking_id, currentUser.id,
            cashPaid, qrPaid, creditAmount,
        )

        // Written after the settling transaction rather than inside it: the RPC
        // has already charged this figure by way of authoritativeTotal, and
        // storing it is only so a later recompute of the folio reproduces the
        // same number. A failure here leaves the bill correctly settled and the
        // stored charge stale, which is why it is not allowed to fail the
        // checkout — the audit log records the override either way.
        if (serviceChargeOverride !== null) {
            const { error: scErr } = await supabase
                .from('bookings')
                .update({ service_charge_override: serviceChargeOverride })
                .in('id', memberIds)
            if (scErr) console.error('Failed to store service charge override:', scErr)
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
            action: closeStay ? 'booking_checked_out' : 'booking_bill_settled',
            entityType: 'booking',
            entityId: booking_id,
            newValue: {
                total_amount: authoritativeTotal,
                folio,
                // False means the guest paid and kept the room — the stay is
                // still open and will be closed by /api/bookings/close-stay.
                closed_stay: closeStay,
                service_charge_overridden: serviceChargeOverride !== null,
                group_id: booking.group_id || null,
                // Every booking closed by this settlement — one for a normal
                // stay, all of them for a multi-room reservation.
                settled_booking_ids: memberIds,
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

        // Handle loyalty points (5% earn on Cash/QR payments). settleLoyalty
        // creates the guest's CRM record if this is their first visit — read
        // only, a cash-paying guest never had one and so never earned anything.
        await settleLoyalty(supabase, booking.restaurant_id, currentUser.id, {
            name: customer_name ? customer_name.trim() : (booking.guest_name ? booking.guest_name.trim() : 'Guest'),
            phone: customer_phone ? customer_phone.trim() : (booking.guest_phone ? booking.guest_phone.trim() : ''),
            earnPoints: Math.round((cashPaid + qrPaid) * 0.05),
            redeemPoints: Number(redeemed_points) || 0,
            earnDescription: `Earned from Room ${roomNumber} stay`,
            redeemDescription: `Redeemed on Room ${roomNumber} stay`,
        })

        return NextResponse.json({ success: true, total: authoritativeTotal, breakdown: folio, closed: closeStay })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
