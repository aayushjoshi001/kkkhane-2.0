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
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Find all sessions linked to this booking
        const { data: linkedSessions, error: sessErr } = await supabase
            .from('sessions')
            .select('id')
            .eq('booking_id', bookingId)

        if (sessErr) {
            console.error('[linked-orders] Error fetching sessions:', sessErr)
            return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
        }

        if (!linkedSessions || linkedSessions.length === 0) {
            return NextResponse.json({ success: true, items: [] })
        }

        const sessionIds = linkedSessions.map((s: { id: string }) => s.id)

        // Fetch all order items from these sessions
        const { data: orders, error: ordErr } = await supabase
            .from('orders')
            .select('id, session_id, status, order_items(id, quantity, unit_price, menu_items(name))')
            .in('session_id', sessionIds)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('status', 'cancelled')

        if (ordErr) {
            console.error('[linked-orders] Error fetching orders:', ordErr)
            return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
        }

        // Flatten order items
        const items = (orders || []).flatMap((o: any) =>
            (o.order_items || []).map((item: any) => ({
                id: item.id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                menu_items: item.menu_items
            }))
        )

        return NextResponse.json({ success: true, items })
    } catch (error) {
        console.error('[linked-orders] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
