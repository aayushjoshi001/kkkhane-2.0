// The single source of truth for "how much does this guest owe" on a hotel
// stay. Used by both the actual checkout settlement (bookings/checkout/route.ts)
// and the guest-facing "my bill" page (api/rooms/stay-billing/route.ts) — those
// two used to each maintain their own copy of this calculation and had already
// drifted apart (one skipped already-paid orders inconsistently, the other
// never applied tax at all). Centralizing it here means they can't diverge
// again, and a fix here always reaches both places.

import { SupabaseClient } from '@supabase/supabase-js'
import { getRestaurantFeatures } from '@/lib/features'
import { calculateNights, getBookingCustomPrice, lateCheckoutNights, resolveDeparture, NEPAL_TZ } from '@/lib/utils'

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

/** One room on the bill. A single-room stay has exactly one of these. */
export interface FolioRoomLine {
    bookingId: string
    roomId: string
    roomNumber: string
    /** Booked nights plus any charged for a late departure. */
    nights: number
    /** This room's own share of the stay cost, before any discount. */
    stayCost: number
    /** Nights included above solely because the guest checked out late. */
    lateNights: number
}

export interface FolioBreakdown {
    /** Nights on the longest stay in the bill — for a group, all rooms share a
     * window, so this reads the same as it does for a single room. */
    nights: number
    stayCost: number
    discountAmount: number
    chargesTotal: number
    /** Sum of the per-order totals in `orders`, service charge included at the
     *  rate the rules produced. Stays in step with those lines, so it is the
     *  figure to itemize a bill from — not the one to settle money against. */
    ordersTotal: number
    /** `ordersTotal` shifted by any service-charge override: what the food side
     *  of this bill is actually being charged. Every money path keys off this —
     *  the partner restaurant's share of the payment and the B2B payable both
     *  move with a waived or raised charge rather than ignoring it. */
    ordersTotalCharged: number
    /** Room service charge the rules produce on their own, before any staff
     *  edit. Already contained in `ordersTotal` — it is broken out so a bill
     *  can show the line and so an override can be billed as a difference. */
    serviceCharge: number
    /** What the service charge was actually billed at. Equals `serviceCharge`
     *  unless a cashier typed over it. */
    serviceChargeCharged: number
    vat: number
    total: number
    orders: FolioOrderLine[]
    charges: FolioCharge[]
    /** Per-room split of `stayCost`. Lets a multi-room bill itemize each room
     * instead of showing one opaque lump. */
    rooms: FolioRoomLine[]
}

/** One room-stay to be billed. A group folio passes several. */
export interface FolioStay {
    bookingId: string
    roomId: string
    checkIn: string
    /** The departure the guest booked, not necessarily the one that happened. */
    checkOut: string
    /** When the guest actually left. NULL while they are still in house. */
    checkedOutAt?: string | null
    /** Used only to read a NULL checkedOutAt correctly — see resolveDeparture. */
    status?: string | null
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
        /** Actual departure, for billing a late checkout. See FolioStay. */
        checkedOutAt?: string | null
        status?: string | null
        sessionId: string | null
        // A staff-applied bargain rate, reducing the room stay cost
        // specifically (so VAT below is computed on the net rate, not the
        // standard one) — see bookings.discount_amount.
        discountAmount?: number
    }
): Promise<FolioBreakdown> {
    return computeFolioForStays(supabase, {
        restaurantId: opts.restaurantId,
        stays: [{
            bookingId: opts.bookingId,
            roomId: opts.roomId,
            checkIn: opts.checkIn,
            checkOut: opts.checkOut,
            checkedOutAt: opts.checkedOutAt,
            status: opts.status,
        }],
        sessionId: opts.sessionId,
        discountAmount: opts.discountAmount,
    })
}

/**
 * The combined folio for a multi-room reservation.
 *
 * Every room in the group bills onto one bill: each room's own nightly rate
 * over its own nights, all manual charges, and every unpaid room-service order
 * from any of the rooms — with one discount and one VAT line across the whole
 * thing, because the guest pays once.
 *
 * Returns null if the group has no billable stays left (all cancelled, or the
 * group id is stale), so callers can fall back to a single-booking folio.
 */
export async function computeGroupFolioTotal(
    supabase: SupabaseClient,
    opts: {
        restaurantId: string
        groupId: string
        sessionId: string | null
        discountAmount?: number
    }
): Promise<FolioBreakdown | null> {
    const { data: members } = await supabase
        .from('bookings')
        .select('id, room_id, check_in, check_out, checked_out_at, status')
        .eq('group_id', opts.groupId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true })

    if (!members || members.length === 0) return null

    return computeFolioForStays(supabase, {
        restaurantId: opts.restaurantId,
        stays: members.map((m) => ({
            bookingId: m.id as string,
            roomId: m.room_id as string,
            checkIn: m.check_in as string,
            checkOut: m.check_out as string,
            checkedOutAt: m.checked_out_at as string | null,
            status: m.status as string | null,
        })),
        sessionId: opts.sessionId,
        discountAmount: opts.discountAmount,
    })
}

export async function computeFolioForStays(
    supabase: SupabaseClient,
    opts: {
        restaurantId: string
        /** One entry for a normal stay, several for a multi-room reservation. */
        stays: FolioStay[]
        sessionId: string | null
        // A staff-applied bargain rate, reducing the room stay cost
        // specifically (so VAT below is computed on the net rate, not the
        // standard one) — see bookings.discount_amount. One discount covers the
        // whole bill, however many rooms are on it.
        discountAmount?: number
        // A cashier's replacement for the service charge the rules worked out.
        // 0 is a real instruction to waive it, so it has to survive as a value.
        // Omit it entirely — as every caller but the checkout route does — and
        // any override already stored on the stay is replayed instead, so a
        // settled bill recomputes to the figure the guest was actually charged.
        serviceChargeOverride?: number | null
    }
): Promise<FolioBreakdown> {
    const { restaurantId, stays, sessionId, discountAmount: rawDiscount } = opts
    const bookingIds = stays.map(s => s.bookingId)
    const roomIds = [...new Set(stays.map(s => s.roomId))]

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

    // Fetch dynamic pricing rules, total rooms, checked-in bookings count, the
    // stays' own notes (a cashier's session rate lives in there), and features
    const [roomRes, bookingsCountRes, roomsCountRes, rulesRes, segmentsRes, bookingRowsRes, features] = await Promise.all([
        supabase
            .from('rooms')
            .select('id, room_number, room_types:type_id(base_price)')
            .in('id', roomIds)
            .eq('restaurant_id', hotelId),
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
        // Rooms each stay has occupied, oldest first. A stay that was never
        // moved has a single segment and prices exactly as it did before.
        supabase
            .from('booking_room_stays')
            .select('booking_id, room_id, from_ts, rooms:room_id(room_types:type_id(base_price))')
            .in('booking_id', bookingIds)
            .order('from_ts', { ascending: true }),
        // A rate the desk agreed for this stay only, tagged into the notes at
        // booking time — read per stay, so a group can hold rooms at different
        // negotiated rates.
        supabase
            .from('bookings')
            .select('id, notes')
            .in('id', bookingIds),
        getRestaurantFeatures(hotelId),
    ])

    const roomInfo = new Map(
        (roomRes.data || []).map((r) => [
            r.id as string,
            {
                roomNumber: (r.room_number as string) || '',
                basePrice: Number((r.room_types as { base_price?: number } | null)?.base_price) || 0,
            },
        ])
    )

    // Move segments, bucketed by the stay they belong to.
    const segmentsByBooking = new Map<string, RoomRateSegment[]>()
    for (const seg of segmentsRes.data || []) {
        const bookingId = seg.booking_id as string
        const bucket = segmentsByBooking.get(bookingId) ?? []
        bucket.push({
            fromTs: seg.from_ts as string,
            // A segment whose room lost its type would otherwise price its
            // nights at zero; fall back to that stay's current room rate.
            price:
                Number(((seg.rooms as { room_types?: { base_price?: number } | null } | null)?.room_types)?.base_price) ||
                0,
        })
        segmentsByBooking.set(bookingId, bucket)
    }

    // Session rate per stay: overrides the room type's catalog price for these
    // nights only, and leaves the catalog untouched.
    const customRateByBooking = new Map<string, number>(
        (bookingRowsRes.data || []).map((b) => [b.id as string, getBookingCustomPrice(b)])
    )

    // Calculate current occupancy rate
    const totalRoomsCount = roomsCountRes.count || 1
    const activeBookingsCount = bookingsCountRes.count || 0
    const occupancyPct = (activeBookingsCount / totalRoomsCount) * 100

    const pricingRules = rulesRes.data || []

    // Price each room's nights independently — a group can hold rooms of
    // different types, so one blended rate would misprice every one of them.
    const roomLines: FolioRoomLine[] = []
    let stayCost = 0
    let nights = 0

    const now = new Date()

    for (const stay of stays) {
        const info = roomInfo.get(stay.roomId)
        // A rate agreed for this stay stands in for the room type's price, so
        // every night, segment fallback and pricing rule below works off it.
        const customRate = customRateByBooking.get(stay.bookingId) || 0
        const basePrice = customRate > 0 ? customRate : (info?.basePrice ?? 0)
        // Booked nights, plus any the guest owes for leaving late. The late
        // nights are appended to the booked window rather than folded into
        // calculateNights: that function ceilings the whole span, so passing it
        // the real departure would tip a stay into an extra night the moment it
        // crossed a 24h boundary, ignoring the grace period entirely.
        const bookedNights = calculateNights(stay.checkIn, stay.checkOut)
        const departure = resolveDeparture({
            check_out: stay.checkOut,
            checked_out_at: stay.checkedOutAt,
            status: stay.status,
        }, now)
        const lateNights = lateCheckoutNights(stay.checkOut, departure)
        const stayNights = bookedNights + lateNights
        // A stay-level agreed rate is what the guest was quoted, so it holds
        // even if they were moved to a room that lists for more or less.
        const segments = customRate > 0
            ? []
            : (segmentsByBooking.get(stay.bookingId) ?? []).map(seg => ({
                fromTs: seg.fromTs,
                price: seg.price || basePrice,
            }))
        const rateForNight = (nightStart: Date) => resolveNightlyRate(segments, nightStart, basePrice)

        const start = new Date(stay.checkIn)
        let roomStayCost = 0

        for (let i = 0; i < stayNights; i++) {
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

            roomStayCost += rateForNight(nightDate) * nightMultiplier
        }

        stayCost += roomStayCost
        nights = Math.max(nights, stayNights)
        roomLines.push({
            bookingId: stay.bookingId,
            roomId: stay.roomId,
            roomNumber: info?.roomNumber ?? '',
            nights: stayNights,
            stayCost: round2(roomStayCost),
            lateNights,
        })
    }

    // Clamped so a stale/oversized discount can never push the room cost
    // negative — the checkout route also rejects discount > stayCost
    // up front, this is just the calculation's own floor.
    const discountAmount = Math.min(Math.max(Number(rawDiscount) || 0, 0), stayCost)
    const netStayCost = stayCost - discountAmount

    // An override the caller passes wins — that is the checkout route settling
    // the bill, and it is the request that decides the figure. Anything else
    // replays what settlement stored, so recomputing a closed stay (the emailed
    // invoice, the guest's own bill page) reproduces the charge that was taken
    // rather than the one the rules would produce today. One bill carries one
    // override, so a group reads the first of its rooms that has one.
    let serviceChargeOverride = opts.serviceChargeOverride
    if (serviceChargeOverride === undefined) {
        const { data: storedRows } = await supabase
            .from('bookings')
            .select('service_charge_override')
            .in('id', bookingIds)
            .not('service_charge_override', 'is', null)
            .limit(1)
        const stored = storedRows?.[0]?.service_charge_override
        serviceChargeOverride = stored === undefined || stored === null ? undefined : Number(stored)
    }

    // Manual charges added during the stay (minibar, laundry, …), across every
    // room on the bill.
    const { data: chargeRows } = await supabase
        .from('room_charges')
        .select('id, amount, description, charge_type')
        .in('booking_id', bookingIds)
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
    // On a group bill this sweeps every room's orders onto the one folio, and
    // the dedupe means an order reachable from two of those routes still counts
    // once.
    //
    // Each session also carries which room its table belongs to, if any — needed
    // below to tell an in-room QR order (service charge on food only) apart from
    // a normal dine-in order that happens to be billed to this stay (no room
    // service charge).
    const [linkedSessionsRes, extraSessionRes] = await Promise.all([
        supabase
            .from('sessions')
            .select('id, booking_id, tables(room_id)')
            .in('booking_id', bookingIds),
        sessionId
            ? supabase.from('sessions').select('id, booking_id, tables(room_id)').eq('id', sessionId).maybeSingle()
            : Promise.resolve({ data: null }),
    ])
    const sessionRoomId = new Map<string, string | null>()
    for (const s of linkedSessionsRes.data || []) {
        sessionRoomId.set(s.id as string, ((s.tables as { room_id?: string } | null)?.room_id) ?? null)
    }
    if (extraSessionRes.data) {
        const s = extraSessionRes.data as { id: string; tables: { room_id?: string } | null }
        sessionRoomId.set(s.id, s.tables?.room_id ?? null)
    }
    const sessionIds = new Set<string>(sessionRoomId.keys())
    if (sessionId) sessionIds.add(sessionId)

    // Room this stay's own direct (non-QR) orders bill to, so a manager
    // switching the room service charge on/off is reflected on this folio
    // immediately — including orders placed before the toggle, since this is
    // always computed against current settings rather than a value stored on
    // the order at placement time.
    const roomIdByBooking = new Map(stays.map((s) => [s.bookingId, s.roomId]))
    const roomScEnabled = !!features?.roomServiceChargeEnabled
    const roomScRooms = Array.isArray(features?.roomServiceChargeRooms) ? features!.roomServiceChargeRooms! : []

    const orderTotals = new Map<string, FolioOrderLine>()
    // Kept per order id rather than as a running sum: the same order can be
    // reached through more than one of the queries below, and re-adding its
    // service charge on the second pass would inflate the line.
    const orderServiceCharges = new Map<string, number>()
    const addOrders = (
        rows: Array<{
            id: string
            placed_at: string
            booking_id: string | null
            session_id: string | null
            order_items?: Array<{ status?: string; quantity: number; unit_price: number; station?: string | null }>
        }> | null
    ) => {
        for (const o of rows || []) {
            const lineTotal = (it: { quantity: number; unit_price: number }) =>
                (Number(it.unit_price) || 0) * (Number(it.quantity) || 0)
            const items = (o.order_items || []).filter((it) => it.status !== 'cancelled')
            const subtotal = items.reduce((s, it) => s + lineTotal(it), 0)

            // A direct room order (placed by staff straight onto the stay, no
            // QR session) is charged on every item; an in-room QR order is
            // charged on food items only — the same split applied when the
            // order's own totals are first computed.
            let roomId: string | null = null
            let isDirectRoomOrder = false
            if (o.session_id) {
                // Both the guest's own in-room QR order and a cashier placing an
                // order straight into that same room's live session bind the
                // ORDER's booking_id the moment it's placed, but never touch
                // sessions.booking_id — so a session missing from sessionRoomId
                // (as opposed to present but mapping to null, which means a
                // confirmed ordinary dine-in table) isn't "not a room order",
                // it just means we have to read the room off the order's own
                // booking_id instead.
                roomId = sessionRoomId.has(o.session_id)
                    ? sessionRoomId.get(o.session_id) ?? null
                    : (o.booking_id ? roomIdByBooking.get(o.booking_id) ?? null : null)
            } else if (o.booking_id) {
                roomId = roomIdByBooking.get(o.booking_id) ?? null
                isDirectRoomOrder = !!roomId
            }

            let serviceCharge = 0
            if (roomScEnabled && roomId && roomScRooms.includes(roomId)) {
                const base = items.filter((it) => it.station === 'kitchen').reduce((s, it) => s + lineTotal(it), 0)
                serviceCharge = round2(base * 0.10)
            }

            orderTotals.set(o.id, { id: o.id, total: round2(subtotal + serviceCharge), placedAt: o.placed_at })
            orderServiceCharges.set(o.id, serviceCharge)
        }
    }

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, placed_at, booking_id, session_id, order_items(status, quantity, unit_price, station)')
        .in('restaurant_id', targetRestaurantIds)
        .in('booking_id', bookingIds)
        .neq('status', 'cancelled')
    addOrders(byBooking as never)

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, placed_at, booking_id, session_id, order_items(status, quantity, unit_price, station)')
            .in('restaurant_id', targetRestaurantIds)
            .in('session_id', Array.from(sessionIds))
            .neq('status', 'cancelled')
        addOrders(bySession as never)
    }
    const orders = Array.from(orderTotals.values())
    const ordersTotal = orders.reduce((s, o) => s + o.total, 0)

    // The service charge is already inside ordersTotal, so an override bills as
    // the difference from what the rules produced — adding the whole overridden
    // figure would charge the guest for it twice.
    const autoServiceCharge = round2(Array.from(orderServiceCharges.values()).reduce((s, v) => s + v, 0))
    const hasScOverride = serviceChargeOverride !== undefined && serviceChargeOverride !== null
    const serviceChargeCharged = hasScOverride
        ? round2(Math.max(0, Number(serviceChargeOverride) || 0))
        : autoServiceCharge
    const serviceChargeDelta = round2(serviceChargeCharged - autoServiceCharge)

    // VAT (Nepal) applies to the room + manual charges only; room-service items are
    // already priced with their own tax at order time, so taxing them again here
    // would double-charge. Off unless the tenant has vatEnabled set.
    const vatEnabled = !!features?.vatEnabled
    const taxRate = Number(features?.defaultTaxRate) || 0
    const vat = vatEnabled ? round2((netStayCost + chargesTotal) * (taxRate / 100)) : 0

    const total = Math.max(0, round2(netStayCost + chargesTotal + ordersTotal + serviceChargeDelta + vat))
    return {
        nights,
        stayCost: round2(stayCost),
        discountAmount: round2(discountAmount),
        chargesTotal: round2(chargesTotal),
        ordersTotal: round2(ordersTotal),
        ordersTotalCharged: Math.max(0, round2(ordersTotal + serviceChargeDelta)),
        serviceCharge: autoServiceCharge,
        serviceChargeCharged,
        vat,
        total,
        orders,
        charges,
        rooms: roomLines,
    }
}
