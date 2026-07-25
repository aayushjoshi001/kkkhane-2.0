'use client'

// Claiming lines for printing.
//
// A ticket used to exist only if a station happened to be subscribed to
// realtime at the instant the order landed. Now `order_items.kot_printed_at`
// carries that fact, and a station takes work by claiming it: the claim is a
// conditional UPDATE, so two open tabs racing for the same lines cannot both
// win, and whatever is still unclaimed is outstanding work any station can pick
// up whenever it connects.
//
// The RPCs run SECURITY DEFINER (staff hold read-only RLS on order_items) and
// scope themselves to the caller's restaurant from the JWT, so these can be
// called straight from the browser client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KitchenOrder } from '@/components/kitchen/OrderQueue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public', any>

/** Orders a station may still have work on. */
export const PRINTABLE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready']

/**
 * Take ownership of these lines. Returns only the ids this caller won — print
 * exactly those and nothing else, or you reintroduce the double-print the claim
 * exists to prevent.
 */
export async function claimForPrinting(supabase: Client, itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return []
    const { data, error } = await supabase.rpc('claim_order_items_for_printing', { p_item_ids: itemIds })
    if (error) {
        // Failing closed (printing nothing) is the safe direction: the lines stay
        // unclaimed, so the next catch-up pass picks them up. Printing without a
        // claim risks a duplicate ticket on every open station.
        console.error('[print claim] failed:', error)
        return []
    }
    return ((data ?? []) as { id: string }[]).map(r => r.id)
}

/**
 * Hand a claim back when the ticket never reached paper, so the lines stay
 * outstanding instead of being lost to a claim that printed nothing.
 */
export async function releasePrintClaim(supabase: Client, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return
    const { error } = await supabase.rpc('release_order_item_print_claim', { p_item_ids: itemIds })
    if (error) console.error('[print claim] release failed:', error)
}

/** Everything buildStationTicket needs, for orders with unprinted lines. */
export const OUTSTANDING_PRINT_SELECT = `
    id, status, total_amount, placed_at, session_id, booking_id, order_type, customer_name, customer_phone, delivery_address,
    sessions ( id, seat_number, tables ( id, label, room_id, rooms ( id, room_number ) ) ),
    bookings ( id, rooms ( id, room_number ) ),
    order_items (
        id, quantity, status, unit_price, special_request, needs_confirmation, station, kot_printed_at,
        menu_items ( id, name, station, is_combo ),
        menu_item_variations:menu_item_variation_id ( id, name ),
        order_item_modifiers ( modifier_name, price_adjustment )
    )
`

/**
 * Orders carrying lines nobody has printed yet.
 *
 * This is what makes a station self-healing: it needs no memory of what it has
 * seen and no realtime event to have arrived. Opening the tab, reconnecting, or
 * the periodic poll all run the same query and pick up whatever is genuinely
 * outstanding — including orders placed while no station was open at all.
 */
export async function fetchOrdersWithUnprintedItems(
    supabase: Client,
    restaurantId: string,
    limit = 25,
): Promise<KitchenOrder[]> {
    const { data, error } = await supabase
        .from('orders')
        .select(OUTSTANDING_PRINT_SELECT)
        .eq('restaurant_id', restaurantId)
        .in('status', PRINTABLE_ORDER_STATUSES)
        .is('order_items.kot_printed_at', null)
        .order('placed_at', { ascending: true })
        .limit(limit)
    if (error) {
        console.error('[print claim] outstanding fetch failed:', error)
        return []
    }
    // The embedded filter narrows order_items but still returns the parent order
    // when none matched, so drop the orders that have nothing left to print.
    return ((data ?? []) as unknown as KitchenOrder[]).filter(o => (o.order_items || []).length > 0)
}
