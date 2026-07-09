import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

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
    let query = supabase
        .from('orders')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .neq('status', 'cancelled')

    query = 'session_id' in match
        ? query.eq('session_id', match.session_id)
        : query.eq('booking_id', match.booking_id)

    const { data: orders } = await query
    const orderIds = (orders || []).map(o => o.id)
    if (orderIds.length === 0) return

    const now = new Date().toISOString()

    await supabase
        .from('order_items')
        .update({ status: 'served' })
        .in('order_id', orderIds)
        .neq('status', 'cancelled')

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

        const parsedTotal = Number(total_amount)
        if (!Number.isFinite(parsedTotal) || parsedTotal < 0) {
            return NextResponse.json({ error: 'total_amount must be a number >= 0' }, { status: 400 })
        }
        const settledNow = (Number(cash_paid) || 0) + (Number(qr_paid) || 0)

        const supabase = await createAdminClient()

        // 0. Fetch the existing booking to combine the settlement with the advance already collected
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('id, paid_amount, status')
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

        const newPaidAmount = (Number(booking.paid_amount) || 0) + settledNow
        const paymentStatus =
            parsedTotal > 0 && newPaidAmount >= parsedTotal ? 'paid'
                : newPaidAmount > 0 ? 'partial'
                    : 'unpaid'

        // 1. Settle every order billed to this stay BEFORE flipping the booking to
        // checked_out — the room's own QR orders (linked via orders.booking_id,
        // stamped at placement), the room's own session (defensively, and closed
        // once settled), and any dining sessions linked to this booking (e.g. a
        // hotel guest ordered from the restaurant and a waiter linked the session).
        // Settling first avoids a window where a concurrent read sees the booking
        // already checked out but its orders not yet marked delivered/paid.
        await settleOrdersMatching(supabase, currentUser.restaurantId, { booking_id })
        if (session_id) {
            await settleAndCloseSession(supabase, currentUser.restaurantId, session_id)
        }

        const { data: linkedSessions } = await supabase
            .from('sessions')
            .select('id')
            .eq('booking_id', booking_id)
            .eq('status', 'active')

        for (const sid of (linkedSessions || []).map(s => s.id)) {
            if (sid === session_id) continue // already handled above
            await settleAndCloseSession(supabase, currentUser.restaurantId, sid)
        }

        // 2. Persist the settlement and update booking status
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({
                status: 'checked_out',
                total_amount: parsedTotal,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
            })
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingError) throw bookingError

        // 3. Update Room status to dirty
        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_checked_out',
            entityType: 'booking',
            entityId: booking_id,
            newValue: {
                total_amount: parsedTotal,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
                cash_paid: Number(cash_paid) || 0,
                qr_paid: Number(qr_paid) || 0,
                session_id: session_id || null,
            },
        })

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
