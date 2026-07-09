import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures } from '@/lib/features'
import { calculateNights } from '@/lib/utils'
import { logAudit } from '@/lib/audit'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

const round2 = (n: number) => Math.round(n * 100) / 100

export interface FolioBreakdown {
    nights: number
    stayCost: number
    chargesTotal: number
    ordersTotal: number
    vat: number
    total: number
}

/**
 * Recompute a stay's folio total from the source of truth in the database.
 *
 * Billing must never trust the browser: the RoomBillingModal sends the total it
 * rendered, but a stale tab, a race, or a tampered payload could under- or
 * over-charge the guest. We rebuild the number here from the room rate, manual
 * charges, and unpaid room-service orders, and bill that instead.
 */
async function computeFolioTotal(
    supabase: AdminClient,
    opts: {
        restaurantId: string
        bookingId: string
        roomId: string
        checkIn: string
        checkOut: string
        sessionId: string | null
    }
): Promise<FolioBreakdown> {
    const { restaurantId, bookingId, roomId, checkIn, checkOut, sessionId } = opts

    // Room stay cost = nightly rate × nights.
    const { data: room } = await supabase
        .from('rooms')
        .select('room_types:type_id(base_price)')
        .eq('id', roomId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle()
    const basePrice = Number((room?.room_types as { base_price?: number } | null)?.base_price) || 0
    const nights = calculateNights(checkIn, checkOut)
    const stayCost = basePrice * nights

    // Manual charges added during the stay (minibar, laundry, …).
    const { data: chargeRows } = await supabase
        .from('room_charges')
        .select('amount')
        .eq('booking_id', bookingId)
        .eq('restaurant_id', restaurantId)
    const chargesTotal = (chargeRows || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)

    // Unpaid room-service orders billed to this stay, from three sources that can
    // overlap — so we key by order id and count each order exactly once:
    //   • orders keyed directly to the stay (room QR)   → orders.booking_id
    //   • orders in the room's active QR session        → sessions.id = sessionId
    //   • orders in dining sessions linked to the stay  → sessions.booking_id
    // The old client-side folio summed the first-and-third lists separately and
    // could double-count a room's own session; the de-dupe here fixes that.
    const { data: linkedSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('booking_id', bookingId)
    const sessionIds = new Set<string>((linkedSessions || []).map((s: { id: string }) => s.id))
    if (sessionId) sessionIds.add(sessionId)

    const orderTotals = new Map<string, number>()
    const addOrders = (rows: Array<{ id: string; order_items?: Array<{ quantity: number; unit_price: number }> }> | null) => {
        for (const o of rows || []) {
            const sum = (o.order_items || []).reduce(
                (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0)
            orderTotals.set(o.id, sum)
        }
    }

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, order_items(quantity, unit_price)')
        .eq('restaurant_id', restaurantId)
        .eq('booking_id', bookingId)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid')
    addOrders(byBooking as never)

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, order_items(quantity, unit_price)')
            .eq('restaurant_id', restaurantId)
            .in('session_id', Array.from(sessionIds))
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid')
        addOrders(bySession as never)
    }
    const ordersTotal = Array.from(orderTotals.values()).reduce((s, v) => s + v, 0)

    // VAT (Nepal) applies to the room + manual charges only; room-service items are
    // already priced with their own tax at order time, so taxing them again here
    // would double-charge. Off unless the tenant has vatEnabled set.
    const features = await getRestaurantFeatures(restaurantId)
    const vatEnabled = !!features?.vatEnabled
    const taxRate = Number(features?.defaultTaxRate) || 0
    const vat = vatEnabled ? round2((stayCost + chargesTotal) * (taxRate / 100)) : 0

    const total = round2(stayCost + chargesTotal + ordersTotal + vat)
    return { nights, stayCost: round2(stayCost), chargesTotal: round2(chargesTotal), ordersTotal: round2(ordersTotal), vat, total }
}

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, room_id, total_amount, cash_paid, qr_paid, session_id } = body

        if (!booking_id || !room_id) {
            return NextResponse.json({ error: 'Missing booking_id or room_id' }, { status: 400 })
        }

        // The client-declared total is kept only for reconciliation in the audit
        // trail — it is never what we charge (see computeFolioTotal).
        const clientTotal = Number(total_amount)
        if (total_amount != null && (!Number.isFinite(clientTotal) || clientTotal < 0)) {
            return NextResponse.json({ error: 'total_amount must be a number >= 0' }, { status: 400 })
        }
        const settledNow = (Number(cash_paid) || 0) + (Number(qr_paid) || 0)

        const supabase = await createAdminClient()

        // 0. Fetch the booking (with stay dates + room) to combine the settlement
        // with the advance already collected and to recompute its folio.
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('id, paid_amount, status, check_in, check_out, room_id')
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (booking.status === 'checked_out') {
            return NextResponse.json({ error: 'Booking is already checked out' }, { status: 409 })
        }

        // 0a. Authoritative, server-computed folio total.
        const folio = await computeFolioTotal(supabase, {
            restaurantId: currentUser.restaurantId,
            bookingId: booking_id,
            roomId: booking.room_id || room_id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            sessionId: session_id || null,
        })
        const authoritativeTotal = folio.total
        const clientMismatch = Number.isFinite(clientTotal)
            ? round2(Math.abs(clientTotal - authoritativeTotal))
            : null

        const newPaidAmount = (Number(booking.paid_amount) || 0) + settledNow
        const paymentStatus =
            authoritativeTotal > 0 && newPaidAmount >= authoritativeTotal ? 'paid'
                : newPaidAmount > 0 ? 'partial'
                    : 'unpaid'

        // 1. Persist the settlement and update booking status
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({
                status: 'checked_out',
                total_amount: authoritativeTotal,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
            })
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingError) throw bookingError

        // 2. Update Room status to dirty
        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError

        // 3. If the room's QR session was folded into this bill, settle its
        // orders and close the session so the cashier can't collect them again.
        if (session_id) {
            const { data: session } = await supabase
                .from('sessions')
                .select('id')
                .eq('id', session_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .maybeSingle()

            if (session) {
                const now = new Date().toISOString()
                await supabase
                    .from('orders')
                    .update({ payment_status: 'paid', paid_at: now })
                    .eq('session_id', session_id)
                    .eq('restaurant_id', currentUser.restaurantId)
                    .neq('status', 'cancelled')
                    .neq('payment_status', 'paid')
                await supabase
                    .from('sessions')
                    .update({ status: 'closed', closed_at: now })
                    .eq('id', session_id)
                    .eq('status', 'active')
            }
        }

        // 4. Settle any dining sessions linked to this booking via booking_id
        // (e.g. hotel guest ordered from the restaurant and session was linked)
        const { data: linkedSessions } = await supabase
            .from('sessions')
            .select('id')
            .eq('booking_id', booking_id)
            .eq('status', 'active')

        if (linkedSessions && linkedSessions.length > 0) {
            const now = new Date().toISOString()
            const linkedIds = linkedSessions.map(s => s.id)
            for (const sid of linkedIds) {
                // Skip if already handled above
                if (sid === session_id) continue
                await supabase
                    .from('orders')
                    .update({ payment_status: 'paid', paid_at: now })
                    .eq('session_id', sid)
                    .eq('restaurant_id', currentUser.restaurantId)
                    .neq('status', 'cancelled')
                    .neq('payment_status', 'paid')
                await supabase
                    .from('sessions')
                    .update({ status: 'closed', closed_at: now })
                    .eq('id', sid)
                    .eq('status', 'active')
            }
        }

        void logAudit({
            restaurantId: currentUser.restaurantId,
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
                session_id: session_id || null,
            },
        })

        return NextResponse.json({ success: true, total: authoritativeTotal, breakdown: folio })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
