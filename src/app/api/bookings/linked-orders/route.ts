import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

/**
 * GET /api/bookings/linked-orders?bookingId=<uuid>
 * 
 * Fetches all order items from dining sessions linked to a booking via booking_id.
 * Used by the billing modal to show dining orders placed at restaurant tables
 * that were linked to a hotel guest's booking.
 */
export async function GET(req: NextRequest) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const bookingId = req.nextUrl.searchParams.get('bookingId')
        console.log('[linked-orders API] Received bookingId:', bookingId)
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Find all sessions linked to this booking. Pull the session's table so we
        // can tell an ordinary dining table (room_id NULL) from the room's own
        // in-room QR table.
        const { data: linkedSessions, error: sessErr } = await supabase
            .from('sessions')
            .select('id, status, table_id, tables:table_id(room_id)')
            .eq('booking_id', bookingId)

        if (sessErr) {
            console.error('[linked-orders] Error fetching sessions:', sessErr)
            return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
        }

        // Exclude the room's own in-room QR session: those orders are already shown
        // as room service on the folio, so returning them here too would double-count.
        // The embedded `tables` relation may come back as an object or a single-row
        // array depending on how PostgREST types the join, so normalize both.
        const roomIdOf = (t: unknown): string | null => {
            const rel = Array.isArray(t) ? t[0] : t
            return (rel as { room_id?: string | null } | null)?.room_id ?? null
        }
        const diningSessions = (linkedSessions || []).filter(
            (s: { tables?: unknown }) => !roomIdOf(s.tables)
        )

        if (diningSessions.length === 0) {
            return NextResponse.json({ success: true, items: [] })
        }

        const sessionIds = diningSessions.map((s: { id: string }) => s.id)

        // Fetch all order items from these sessions
        const { data: orders, error: ordErr } = await supabase
            .from('orders')
            .select('id, session_id, status, payment_status, order_items(id, quantity, unit_price, menu_items(name))')
            .in('session_id', sessionIds)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid')

        if (ordErr) {
            console.error('[linked-orders] Error fetching orders:', ordErr)
            return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
        }

        console.log('[linked-orders API] Found orders matching sessionIds:', orders?.length, orders)

        // Flatten order items
        const items = (orders || []).flatMap((o: any) =>
            (o.order_items || []).map((item: any) => ({
                id: item.id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                menu_items: item.menu_items
            }))
        )

        console.log('[linked-orders API] Flattened items to return:', items)

        return NextResponse.json({ success: true, items })
    } catch (error) {
        console.error('[linked-orders] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
