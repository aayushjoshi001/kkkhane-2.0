// The single source of truth for "how much does this guest owe" on a hotel
// stay. Used by both the actual checkout settlement (bookings/checkout/route.ts)
// and the guest-facing "my bill" page (api/rooms/stay-billing/route.ts) — those
// two used to each maintain their own copy of this calculation and had already
// drifted apart (one skipped already-paid orders inconsistently, the other
// never applied tax at all). Centralizing it here means they can't diverge
// again, and a fix here always reaches both places.

import { SupabaseClient } from '@supabase/supabase-js'
import { getRestaurantFeatures } from '@/lib/features'
import { calculateNights } from '@/lib/utils'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface FolioOrderLine {
    id: string
    total: number
    placedAt: string
}

export interface FolioCharge {
    id: string
    description: string
    amount: number
    chargeType: string
}

export interface FolioBreakdown {
    nights: number
    stayCost: number
    chargesTotal: number
    ordersTotal: number
    vat: number
    total: number
    orders: FolioOrderLine[]
    charges: FolioCharge[]
}

/**
 * Recompute a stay's folio total from the source of truth in the database.
 *
 * Billing must never trust the browser: a stale tab, a race, or a tampered
 * payload could under- or over-charge the guest. This rebuilds the number
 * from the room rate, manual charges, and unpaid room-service orders.
 *
 * Tax is only ever applied if the restaurant has actually turned VAT on
 * (features.vatEnabled) — a tenant that never configured a tax rate gets
 * charged exactly stayCost + chargesTotal + ordersTotal, nothing added on
 * top by default.
 */
export async function computeFolioTotal(
    supabase: SupabaseClient,
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
        .select('id, amount, description, charge_type')
        .eq('booking_id', bookingId)
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: true })
    const charges: FolioCharge[] = (chargeRows || []).map((c) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount) || 0,
        chargeType: c.charge_type,
    }))
    const chargesTotal = charges.reduce((s, c) => s + c.amount, 0)

    // Unpaid room-service orders billed to this stay, from sources that can
    // overlap — so we key by order id and count/list each order exactly once:
    //   • orders keyed directly to the stay (room QR)   → orders.booking_id
    //   • orders in the room's active QR session        → sessions.id = sessionId
    //   • orders in dining sessions linked to the stay  → sessions.booking_id
    const { data: linkedSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('booking_id', bookingId)
    const sessionIds = new Set<string>((linkedSessions || []).map((s: { id: string }) => s.id))
    if (sessionId) sessionIds.add(sessionId)

    const orderTotals = new Map<string, FolioOrderLine>()
    const addOrders = (
        rows: Array<{ id: string; placed_at: string; order_items?: Array<{ quantity: number; unit_price: number }> }> | null
    ) => {
        for (const o of rows || []) {
            const sum = (o.order_items || []).reduce(
                (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0)
            orderTotals.set(o.id, { id: o.id, total: sum, placedAt: o.placed_at })
        }
    }

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, placed_at, order_items(quantity, unit_price)')
        .eq('restaurant_id', restaurantId)
        .eq('booking_id', bookingId)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid')
    addOrders(byBooking as never)

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, placed_at, order_items(quantity, unit_price)')
            .eq('restaurant_id', restaurantId)
            .in('session_id', Array.from(sessionIds))
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid')
        addOrders(bySession as never)
    }
    const orders = Array.from(orderTotals.values())
    const ordersTotal = orders.reduce((s, o) => s + o.total, 0)

    // VAT (Nepal) applies to the room + manual charges only; room-service items are
    // already priced with their own tax at order time, so taxing them again here
    // would double-charge. Off unless the tenant has vatEnabled set.
    const features = await getRestaurantFeatures(restaurantId)
    const vatEnabled = !!features?.vatEnabled
    const taxRate = Number(features?.defaultTaxRate) || 0
    const vat = vatEnabled ? round2((stayCost + chargesTotal) * (taxRate / 100)) : 0

    const total = round2(stayCost + chargesTotal + ordersTotal + vat)
    return {
        nights,
        stayCost: round2(stayCost),
        chargesTotal: round2(chargesTotal),
        ordersTotal: round2(ordersTotal),
        vat,
        total,
        orders,
        charges,
    }
}
