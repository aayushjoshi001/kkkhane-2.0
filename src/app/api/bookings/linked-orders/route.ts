import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveFolioBookingIds } from '@/lib/bookingGroup'
import { computeFolioForStays } from '@/lib/folio'

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
        // Everything that only needs the folio ids, in one go.
        //
        // These four ran one after another, and three of them never needed the
        // answer to the one before. Each PostgREST call costs a round trip of
        // its own -- about 20-50ms even with the function sitting beside the
        // database in Singapore, because the cost is per request, not per row --
        // so the ordering alone was worth a tenth of a second on a route the
        // room panel and the cashier's bill both wait on. The two reads that do
        // have a dependency (orders needs the session ids and the partner
        // restaurant; the folio needs the stays) still run after this.
        const [
            { data: linkedSessions, error: sessErr },
            { data: currentRest },
            { data: stayRows },
            { data: paymentRows },
        ] = await Promise.all([
            supabase
                .from('sessions')
                .select('id')
                .in('booking_id', folioBookingIds),
            // Target restaurant IDs (current hotel/restaurant + partner if any)
            supabase
                .from('restaurants')
                .select('linked_restaurant_id, linked_hotel_id')
                .eq('id', currentUser.restaurantId)
                .maybeSingle(),
            // Booking-level summary for the Bookings & Stays History detail card:
            // who checked the guest in/out and when, the discount applied, the
            // actual service charge billed, and the cash/QR split of everything
            // received (advance + settlement) across the whole folio group.
            supabase
                .from('bookings')
                .select('id, room_id, status, check_in, check_out, checked_out_at, checked_in_at, checked_in_by, cashier_id, discount_amount, discount_reason, service_charge_override')
                .in('id', folioBookingIds),
            // Settlement rows are always written with the literal note
            // 'Settlement' (recordSettlementPayment in bookings/checkout/route.ts);
            // an advance row's note defaults to 'Advance' but the front desk can
            // type over it (advance_note in POST /api/bookings), so "not
            // Settlement" -- not an exact 'Advance' match -- is what reliably
            // means "the advance". Fetched here rather than inside the summary
            // branch below: the primary stay is the booking we were asked about,
            // so it is essentially always present, and hoisting the read saves a
            // round trip on every request instead of costing one on a rare miss.
            supabase
                .from('booking_payments')
                .select('amount, cash_amount, qr_amount, note')
                .in('booking_id', folioBookingIds),
        ])

        if (sessErr) {
            console.error('[linked-orders] Error fetching sessions:', sessErr)
            return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
        }

        const sessionIds = (linkedSessions || []).map((s: { id: string }) => s.id)

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
                id, session_id, status, payment_status, placed_at, order_type, discount_amount,
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

        // Flatten order items
        const getRoomId = (sessionObj: any): string | null => {
            if (!sessionObj) return null
            const sess = Array.isArray(sessionObj) ? sessionObj[0] : sessionObj
            if (!sess?.tables) return null
            const tbl = Array.isArray(sess.tables) ? sess.tables[0] : sess.tables
            return tbl?.room_id ?? null
        }

        type LinkedOrderItem = { id: string; status?: string; quantity: number; unit_price: number; station?: string | null; special_request?: string | null; menu_items: unknown; menu_item_variations?: unknown }
        type LinkedOrder = { id: string; session_id: string | null; status: string; payment_status: string; placed_at: string; order_type?: string; discount_amount?: number | null; sessions: any; order_items?: LinkedOrderItem[] }
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

        // Food discount is whatever promo/loyalty discount landed on the food
        // orders themselves (orders.discount_amount) — separate from the room
        // stay's own bargain-rate discount (bookings.discount_amount), which
        // only ever reduces the room rate (see folio.ts).
        const foodDiscount = ((orders || []) as LinkedOrder[]).reduce((s, o) => s + (Number(o.discount_amount) || 0), 0)

        // stayRows and paymentRows were read in the batch above.
        let bookingSummary: Record<string, unknown> | null = null
        const primary = (stayRows || []).find(b => b.id === bookingId)
        if (primary) {
            const userIds = [primary.checked_in_by, primary.cashier_id].filter((id): id is string => !!id)
            const { data: userRows } = userIds.length > 0
                ? await supabase.from('users').select('id, full_name').in('id', userIds)
                : { data: [] as { id: string; full_name: string | null }[] }
            const nameById = new Map((userRows || []).map(u => [u.id as string, u.full_name as string | null]))

            let serviceChargeAmount = 0
            try {
                const folio = await computeFolioForStays(supabase, {
                    restaurantId: currentUser.restaurantId,
                    stays: (stayRows || []).map(b => ({
                        bookingId: b.id as string,
                        roomId: b.room_id as string,
                        checkIn: b.check_in as string,
                        checkOut: b.check_out as string,
                        checkedOutAt: b.checked_out_at as string | null,
                        status: b.status as string | null,
                    })),
                    sessionId: null,
                })
                serviceChargeAmount = folio.serviceChargeCharged
            } catch (err) {
                console.error('[linked-orders] Failed to compute service charge:', err)
            }

            const sumBy = (isSettlement: boolean, field: 'cash_amount' | 'qr_amount') =>
                (paymentRows || [])
                    .filter(p => (p.note === 'Settlement') === isSettlement)
                    .reduce((s, p) => s + (Number(p[field]) || 0), 0)
            // booking_payments has no credit_amount column — recordSettlementPayment
            // (bookings/checkout/route.ts) writes amount = cash + qr + credit, so
            // whatever's left over after the cash/qr columns is what was put on
            // the guest's account instead of collected. Never negative in
            // practice; the floor is just a defensive guard against rounding.
            const creditSettlement = (paymentRows || [])
                .filter(p => p.note === 'Settlement')
                .reduce((s, p) => s + Math.max(0, (Number(p.amount) || 0) - (Number(p.cash_amount) || 0) - (Number(p.qr_amount) || 0)), 0)

            bookingSummary = {
                checked_in_at: primary.checked_in_at,
                checked_in_by: primary.checked_in_by ? (nameById.get(primary.checked_in_by) || 'Unknown') : null,
                checked_out_at: primary.checked_out_at,
                checked_out_by: primary.cashier_id ? (nameById.get(primary.cashier_id) || 'Unknown') : null,
                room_discount_amount: Number(primary.discount_amount) || 0,
                room_discount_reason: primary.discount_reason,
                food_discount_amount: Math.round(foodDiscount * 100) / 100,
                service_charge_amount: serviceChargeAmount,
                cash_advance: Math.round(sumBy(false, 'cash_amount') * 100) / 100,
                cash_settlement: Math.round(sumBy(true, 'cash_amount') * 100) / 100,
                qr_advance: Math.round(sumBy(false, 'qr_amount') * 100) / 100,
                qr_settlement: Math.round(sumBy(true, 'qr_amount') * 100) / 100,
                credit_settlement: Math.round(creditSettlement * 100) / 100,
            }
        }

        return NextResponse.json({ success: true, items, booking: bookingSummary })
    } catch (error) {
        console.error('[linked-orders] Unexpected error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
