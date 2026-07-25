// The single source of truth for "how much does this guest owe" on a hotel
// stay. Used by both the actual checkout settlement (bookings/checkout/route.ts)
// and the guest-facing "my bill" page (api/rooms/stay-billing/route.ts) — those
// two used to each maintain their own copy of this calculation and had already
// drifted apart (one skipped already-paid orders inconsistently, the other
// never applied tax at all). Centralizing it here means they can't diverge
// again, and a fix here always reaches both places.

import { SupabaseClient } from '@supabase/supabase-js'
import { getRestaurantFeatures } from '@/lib/features'
import { calculateNights, NEPAL_TZ } from '@/lib/utils'

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
    discountAmount: number
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
/** One room the stay occupied, with the nightly rate that room carries. */
export interface RoomRateSegment {
    /** When the guest entered this room. */
    fromTs: string
    /** Nightly rate for the room in this segment. */
    price: number
}

/**
 * Nightly rate for the night beginning `nightStart`, given the rooms a stay has
 * occupied.
 *
 * A move takes effect by calendar date, not by instant: a guest moved at any
 * hour on the 24th is billed the new room's rate for the night beginning the
 * 24th. Splitting on the exact timestamp instead would bill a 3pm move at the
 * old room's rate for the night the guest actually slept in the new room. Dates
 * are read in Kathmandu so the boundary lines up with the business day.
 *
 * With no segments — a stay predating the move history — this returns
 * `fallbackPrice`, which is the whole-stay behaviour that came before.
 */
export function resolveNightlyRate(
    segments: RoomRateSegment[],
    nightStart: string | Date,
    fallbackPrice: number,
): number {
    if (segments.length === 0) return fallbackPrice
    const day = (value: string | Date) =>
        new Date(value).toLocaleDateString('en-CA', { timeZone: NEPAL_TZ })

    const nightDay = day(nightStart)
    const ordered = [...segments].sort((a, b) => day(a.fromTs).localeCompare(day(b.fromTs)))

    let rate = ordered[0].price
    for (const seg of ordered) {
        if (day(seg.fromTs) <= nightDay) rate = seg.price
        else break
    }
    return rate
}

export async function computeFolioTotal(
    supabase: SupabaseClient,
    opts: {
        restaurantId: string
        bookingId: string
        roomId: string
        checkIn: string
        checkOut: string
        sessionId: string | null
        // A staff-applied bargain rate, reducing the room stay cost
        // specifically (so VAT below is computed on the net rate, not the
        // standard one) — see bookings.discount_amount.
        discountAmount?: number
    }
): Promise<FolioBreakdown> {
    const { restaurantId, bookingId, roomId, checkIn, checkOut, sessionId, discountAmount: rawDiscount } = opts

    // Fetch partner restaurant/hotel if linked
    const { data: currentRest } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id, linked_hotel_id')
        .eq('id', restaurantId)
        .maybeSingle()

    const hotelId = currentRest?.linked_hotel_id || restaurantId
    const partnerRestaurantId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
    
    let linkAllowFolioCharges = true
    if (currentRest?.linked_restaurant_id) {
        const { data: colCheck } = await supabase
            .from('restaurants')
            .select('link_allow_folio_charges')
            .eq('id', restaurantId)
            .maybeSingle()
        if (colCheck && colCheck.link_allow_folio_charges === false) {
            linkAllowFolioCharges = false
        }
    } else if (currentRest?.linked_hotel_id) {
        const { data: colCheck } = await supabase
            .from('restaurants')
            .select('link_allow_folio_charges')
            .eq('id', currentRest.linked_hotel_id)
            .maybeSingle()
        if (colCheck && colCheck.link_allow_folio_charges === false) {
            linkAllowFolioCharges = false
        }
    }
    
    const targetRestaurantIds = [restaurantId]
    if (partnerRestaurantId && linkAllowFolioCharges) {
        targetRestaurantIds.push(partnerRestaurantId)
    }

    // Fetch dynamic pricing rules, total rooms, and checked-in bookings count
    const [roomRes, bookingsCountRes, roomsCountRes, rulesRes, segmentsRes] = await Promise.all([
        supabase
            .from('rooms')
            .select('room_types:type_id(base_price)')
            .eq('id', roomId)
            .eq('restaurant_id', hotelId)
            .maybeSingle(),
        supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('restaurant_id', hotelId)
            .eq('status', 'checked_in'),
        supabase
            .from('rooms')
            .select('*', { count: 'exact', head: true })
            .eq('restaurant_id', hotelId)
            .eq('is_active', true),
        supabase
            .from('dynamic_pricing_rules')
            .select('*')
            .eq('restaurant_id', hotelId)
            .eq('is_active', true),
        // Rooms this stay has occupied, oldest first. A stay that was never
        // moved has a single segment and prices exactly as it did before.
        supabase
            .from('booking_room_stays')
            .select('room_id, from_ts, rooms:room_id(room_types:type_id(base_price))')
            .eq('booking_id', bookingId)
            .order('from_ts', { ascending: true })
    ])

    const basePrice = Number((roomRes.data?.room_types as { base_price?: number } | null)?.base_price) || 0
    const nights = calculateNights(checkIn, checkOut)

    const segments: RoomRateSegment[] = (segmentsRes.data || []).map((seg) => ({
        fromTs: seg.from_ts as string,
        // A segment whose room lost its type would otherwise price its nights at
        // zero; fall back to the booking's current room rate.
        price:
            Number(((seg.rooms as { room_types?: { base_price?: number } | null } | null)?.room_types)?.base_price) ||
            basePrice,
    }))
    const rateForNight = (nightStart: Date) => resolveNightlyRate(segments, nightStart, basePrice)
    
    // Calculate current occupancy rate
    const totalRoomsCount = roomsCountRes.count || 1
    const activeBookingsCount = bookingsCountRes.count || 0
    const occupancyPct = (activeBookingsCount / totalRoomsCount) * 100

    let stayCost = 0
    const start = new Date(checkIn)
    const pricingRules = rulesRes.data || []

    if (nights > 0) {
        for (let i = 0; i < nights; i++) {
            const nightDate = new Date(start)
            nightDate.setDate(start.getDate() + i)
            
            let nightMultiplier = 1.0
            
            // Apply weekend rules (Friday / Saturday nights)
            const weekendRule = pricingRules.find(r => r.rule_type === 'weekend')
            if (weekendRule && (nightDate.getDay() === 5 || nightDate.getDay() === 6)) {
                nightMultiplier *= Number(weekendRule.multiplier)
            }
            
            // Apply occupancy rules
            const occupancyRule = pricingRules.find(r => 
                r.rule_type === 'occupancy' && 
                occupancyPct >= Number(r.occupancy_threshold_pct || 0)
            )
            if (occupancyRule) {
                nightMultiplier *= Number(occupancyRule.multiplier)
            }
            
            stayCost += rateForNight(nightDate) * nightMultiplier
        }
    }

    // Clamped so a stale/oversized discount can never push the room cost
    // negative — the checkout route also rejects discount > stayCost
    // up front, this is just the calculation's own floor.
    const discountAmount = Math.min(Math.max(Number(rawDiscount) || 0, 0), stayCost)
    const netStayCost = stayCost - discountAmount

    // Manual charges added during the stay (minibar, laundry, …).
    const { data: chargeRows } = await supabase
        .from('room_charges')
        .select('id, amount, description, charge_type')
        .eq('booking_id', bookingId)
        .eq('restaurant_id', hotelId)
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
        rows: Array<{ id: string; placed_at: string; order_items?: Array<{ status?: string; quantity: number; unit_price: number }> }> | null
    ) => {
        for (const o of rows || []) {
            const sum = (o.order_items || [])
                .filter((it: any) => it.status !== 'cancelled')
                .reduce(
                    (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0)
            orderTotals.set(o.id, { id: o.id, total: sum, placedAt: o.placed_at })
        }
    }

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, placed_at, order_items(status, quantity, unit_price)')
        .in('restaurant_id', targetRestaurantIds)
        .eq('booking_id', bookingId)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid')
    addOrders(byBooking as never)

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, placed_at, order_items(status, quantity, unit_price)')
            .in('restaurant_id', targetRestaurantIds)
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
    const features = await getRestaurantFeatures(hotelId)
    const vatEnabled = !!features?.vatEnabled
    const taxRate = Number(features?.defaultTaxRate) || 0
    const vat = vatEnabled ? round2((netStayCost + chargesTotal) * (taxRate / 100)) : 0

    const total = round2(netStayCost + chargesTotal + ordersTotal + vat)
    return {
        nights,
        stayCost: round2(stayCost),
        discountAmount: round2(discountAmount),
        chargesTotal: round2(chargesTotal),
        ordersTotal: round2(ordersTotal),
        vat,
        total,
        orders,
        charges,
    }
}
