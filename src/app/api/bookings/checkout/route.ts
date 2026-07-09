import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

/**
 * Fully settles every non-cancelled order matching the given session or
 * booking: marks every order_item 'served' and the order 'delivered' +
 * 'paid', so it drops out of the kitchen queue and the waiter/room-billing
 * panels the same moment the guest checks out — not just payment_status,
 * which previously left the kitchen thinking these orders were still active.
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
        .update({ status: 'delivered', payment_status: 'paid', paid_at: now })
        .in('id', orderIds)
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

        // 1. Persist the settlement and update booking status
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

        // 2. Update Room status to dirty
        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError

        // 3. Settle every order billed to this stay — the room's own QR orders
        // (linked via orders.booking_id, stamped at placement) plus, defensively,
        // anything still reachable by the room session's own id. This marks them
        // 'delivered'/'paid' so they drop out of the kitchen queue and stop
        // reappearing on the guest's order tracker after checkout.
        await settleOrdersMatching(supabase, currentUser.restaurantId, { booking_id })
        if (session_id) {
            await settleOrdersMatching(supabase, currentUser.restaurantId, { session_id })
        }

        // 3b. Close the room's own session so the cashier can't collect its orders again.
        if (session_id) {
            const { data: session } = await supabase
                .from('sessions')
                .select('id')
                .eq('id', session_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .maybeSingle()

            if (session) {
                await supabase
                    .from('sessions')
                    .update({ status: 'closed', closed_at: new Date().toISOString() })
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
                await settleOrdersMatching(supabase, currentUser.restaurantId, { session_id: sid })
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
