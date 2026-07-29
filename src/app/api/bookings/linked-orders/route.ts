import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveFolioBookingIds } from '@/lib/bookingGroup'

/**
 * GET /api/bookings/linked-orders?bookingId=<uuid>
 *
 * Fetches all order items from dining sessions linked to a booking via booking_id.
 * Used by the billing modal to show dining orders placed at restaurant tables
 * that were linked to a hotel guest's booking.
 *
 * On a multi-room reservation this returns every room's orders, because they
 * all settle on one bill — a family that ordered room service to room 306 pays
 * for it on the reservation's single folio, whichever of their rooms the
 * cashier opened. `resolveFolioBookingIds` returns a one-element list for a
 * normal stay, which is exactly the query this route always ran.
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

        // Every booking on this folio — the one asked for, plus its siblings if
        // it belongs to a multi-room reservation.
        const folioBookingIds = await resolveFolioBookingIds(supabase, bookingId)

        // Find all sessions linked to this booking. Pull the session's table so we
        // can tell an ordinary dining table (room_id NULL) from the room's own
        // in-room QR table.
        //
        // The room_id NULL check happens in JS below, not as a PostgREST
        // `.is('tables.room_id', null)` filter: without `!inner`, filtering on an
        // embedded column nulls out the embed rather than dropping the parent row,
        // so the room's own session would survive the filter and double-count.
        const { data: linkedSessions, error: sessErr } = await supabase
            .from('sessions')
            .select('id')
            .in('booking_id', folioBookingIds)

        if (sessErr) {
            console.error('[linked-orders] Error fetching sessions:', sessErr)
            return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
        }

        const sessionIds = (linkedSessions || []).map((s: { id: string }) => s.id)

        // Resolve target restaurant IDs (current hotel/restaurant + partner if any)
        const { data: currentRest } = await supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', currentUser.restaurantId)
            .maybeSingle()

        const partnerRestaurantId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
        const targetRestaurantIds = [currentUser.restaurantId]
        if (partnerRestaurantId) {
            targetRestaurantIds.push(partnerRestaurantId)
        }

        const includeAll = req.nextUrl.searchParams.get('includeAll') === 'true'

        // Fetch all order items from these sessions or directly linked to the booking
        let query = supabase
            .from('orders')
            .select(`
                id, session_id, status, payment_status, placed_at, order_type,
                order_items(id, status, quantity, unit_price, station, special_request, menu_items(name, station), menu_item_variations:menu_item_variation_id(id, name)),
                sessions(id, table_id, tables:table_id(room_id))
            `)
            .in('restaurant_id', targetRestaurantIds)
            .neq('status', 'cancelled')

        if (!includeAll) {
            query = query.neq('payment_status', 'paid')
        }

        if (sessionIds.length > 0) {
            query = query.or(`booking_id.in.(${folioBookingIds.join(',')}),session_id.in.(${sessionIds.join(',')})`)
        } else {
            query = query.in('booking_id', folioBookingIds)
        }

        const { data: orders, error: ordErr } = await query

        if (ordErr) {
            console.error('[linked-orders] Error fetching orders:', ordErr)
            return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
        }

        console.log('[linked-orders API] Found orders matching sessionIds:', orders?.length, orders)

        // Flatten order items
        const getRoomId = (sessionObj: any): string | null => {
            if (!sessionObj) return null
            const sess = Array.isArray(sessionObj) ? sessionObj[0] : sessionObj
            if (!sess?.tables) return null
            const tbl = Array.isArray(sess.tables) ? sess.tables[0] : sess.tables
            return tbl?.room_id ?? null
        }

        type LinkedOrderItem = { id: string; status?: string; quantity: number; unit_price: number; station?: string | null; special_request?: string | null; menu_items: unknown; menu_item_variations?: unknown }
        type LinkedOrder = { id: string; session_id: string | null; status: string; payment_status: string; placed_at: string; order_type?: string; sessions: any; order_items?: LinkedOrderItem[] }
        const items = ((orders || []) as LinkedOrder[]).flatMap((o) => {
            const roomId = getRoomId(o.sessions)
            const isRoomOrder = roomId !== null || o.session_id === null
            return (o.order_items || [])
                .filter((item: any) => item.status !== 'cancelled')
                .map((item) => ({
                    id: item.id,
                    order_id: o.id,
                    placed_at: o.placed_at,
                    payment_status: o.payment_status,
                    order_type: o.order_type || 'dine_in',
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    station: (item as any).station ?? null,
                    special_request: item.special_request,
                    menu_items: item.menu_items,
                    menu_item_variations: item.menu_item_variations,
                    session_id: o.session_id,
                    is_room_order: isRoomOrder
                }))
        })

        console.log('[linked-orders API] Flattened items to return:', items)

        return NextResponse.json({ success: true, items })
    } catch (error) {
        console.error('[linked-orders] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
