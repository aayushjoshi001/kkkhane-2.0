// The complete bill for one hotel stay, in the two forms a stay ever has one:
//
//   • the bill the guest was actually handed at checkout — read back from the
//     snapshot the checkout route wrote to the audit log, so it is the figures
//     that were charged rather than what today's prices would produce, and
//   • the bill so far for a guest still in house — the live folio, the same
//     server-side computation the cashier screen quotes and checkout bills off.
//
// Both were previously re-derived in the browser from a nightly rate times a
// night count, which quietly ignored manual charges, late-checkout nights, the
// service charge, VAT, per-room pricing on a group reservation and any move to
// a differently priced room. The card showed a breakdown that could not add up
// to the total beside it.

import { SupabaseClient } from '@supabase/supabase-js'
import { computeFolioForStays, type FolioBreakdown } from '@/lib/folio'
import { resolveFolioBookingIds } from '@/lib/bookingGroup'
import { getBookingCustomPrice, bookingInvoiceNumber } from '@/lib/utils'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** How an order reached this bill — a guest's in-room QR order, a dining table
 *  linked to the stay, or one the desk put straight onto the room. */
export type BookingBillOrderKind = 'room_qr' | 'dining_table' | 'direct'

export interface BookingBillOrderItem {
    id: string
    name: string
    /** Variation chosen, when the dish has them ("Large", "Half plate"). */
    variation: string | null
    quantity: number
    unitPrice: number
    lineTotal: number
    /** kitchen / bar — which station made it, and what the room service charge
     *  is calculated on (kitchen items only). */
    station: string | null
    specialRequest: string | null
}

export interface BookingBillOrder {
    id: string
    /** Short human reference, the same 5 characters the tickets print. */
    ref: string
    placedAt: string
    kind: BookingBillOrderKind
    status: string
    paymentStatus: string
    orderType: string
    tableLabel: string | null
    items: BookingBillOrderItem[]
    /** Σ of the item lines, before any service charge. */
    subtotal: number
    /**
     * The room service charge this order contributed to the bill: the folio's
     * own figure for it (10% of its kitchen items, when the room is in the
     * allowlist), not a number recomputed here — so an order's line and the
     * bill's service charge line can never disagree.
     */
    serviceCharge: number
    /** What this order adds to the bill: subtotal + serviceCharge. */
    billedTotal: number
    /** Recorded on the order itself at the time it was placed. Shown for
     *  reference only — room-service items are priced tax-inclusive, so the
     *  folio deliberately does not add these on top again. */
    taxAtOrderTime: number
    discountAtOrderTime: number
    /**
     * False when the folio did not count this order — it was cancelled out from
     * under the bill, or belongs to a session that no longer resolves to this
     * stay. Worth showing rather than hiding: it is an order somebody placed
     * against this room that the guest was not charged for.
     */
    billed: boolean
}

export interface BookingBillCharge {
    id: string
    description: string
    amount: number
    chargeType: string
}

export interface BookingBillRoomLine {
    bookingId: string
    roomNumber: string
    roomType: string | null
    nights: number
    /** Nights on this line charged only because the guest left late. */
    lateNights: number
    /** Nightly rate to display: the rate agreed for the stay, else the type's
     *  catalog price. Indicative only on a stay that moved rooms or crossed a
     *  weekend/occupancy rule — `stayCost` is the figure that is billed. */
    nightlyRate: number
    stayCost: number
}

export interface BookingBillTotals {
    /** Room stay across every room on the bill, before the room discount. */
    stayCost: number
    /** Bargain rate given on the room, per bookings.discount_amount. */
    roomDiscount: number
    chargesTotal: number
    /** Food and drink as billed — service charge included. */
    ordersTotal: number
    /** The service charge inside ordersTotal, at the rate actually billed. */
    serviceCharge: number
    /** What the rules produced before a cashier typed over it, when they did. */
    serviceChargeAuto: number
    serviceChargeOverridden: boolean
    /** Promo/loyalty discounts that landed on the food orders themselves. */
    foodDiscount: number
    vat: number
    /** Charged for a late departure, stored at settlement. */
    extraHourCharge: number
    /**
     * What the bill comes to. On a settled stay this is the figure that was
     * charged, taken from the settlement record — not a recomputation of it.
     */
    total: number
    /**
     * Settled stays only: total charged minus what the snapshot's lines add up
     * to. Normally the extra-hour charge; anything else is an adjustment the
     * cashier made at the till, and it is shown as its own line rather than
     * silently folded into a subtotal that would then not reconcile.
     */
    adjustment: number
}

export interface BookingBillPayments {
    advanceCash: number
    advanceQr: number
    advanceTotal: number
    settlementCash: number
    settlementQr: number
    /** Left on the guest's ledger account instead of collected — only ever set
     *  from an explicit payment row, never inferred. */
    credit: number
    /**
     * Charged and not accounted for by anything above. On a settled bill that is
     * money the guest did not hand over: taken as credit onto their ledger, or
     * simply never collected. Reported as its own figure rather than called
     * credit, because the booking record cannot tell those two apart.
     */
    uncollected: number
    collectedTotal: number
    /** Σ bookings.paid_amount — what the booking rows themselves record. */
    paidRecorded: number
    /** Still to collect on a stay in house. 0 once settled. */
    netDue: number
    /** Advance beyond the bill — money that goes back to the guest. */
    returnToGuest: number
    advanceMethod: string | null
    /**
     * 'recorded'      — every figure came from booking_payments rows.
     * 'reconstructed' — that table has nothing for this stay, so the split was
     *                   rebuilt from the settlement snapshot and paid_amount.
     *                   True of most stays before 2026-07-28, when the table
     *                   started being written: reporting zeros for those would
     *                   say money was never taken when it was.
     */
    detail: 'recorded' | 'reconstructed'
    /** False when the advance is known as a total but not split cash vs QR —
     *  a reconstructed advance taken on a 'split' method. */
    advanceSplitKnown: boolean
}

export interface BookingBillSettlement {
    at: string
    by: string | null
    /** False when the guest paid the bill and kept the room. */
    closedStay: boolean
    totalCharged: number
    cashPaid: number
    qrPaid: number
    creditAmount: number
    discountAmount: number
    /** The reference the IRD sync filed this bill under. */
    invoiceNumber: string
    /** The folio exactly as it stood when the bill was issued. */
    snapshot: FolioBreakdown | null
}

export interface BookingBill {
    bookingId: string
    groupId: string | null
    guestName: string
    guestPhone: string | null
    /** Address taken at check-in. Null when it was never asked for. */
    guestAddress: string | null
    status: string
    checkIn: string
    checkOut: string
    checkedInAt: string | null
    checkedInBy: string | null
    checkedOutAt: string | null
    checkedOutBy: string | null
    /** Nights on the longest stay on this bill. */
    nights: number
    /** The rate agreed for this stay, or 0 when it is on catalog prices. */
    customRatePerNight: number
    parkingVehicleNo: string | null
    rooms: BookingBillRoomLine[]
    charges: BookingBillCharge[]
    orders: BookingBillOrder[]
    totals: BookingBillTotals
    payments: BookingBillPayments
    /** Null while the stay has never been settled. */
    settlement: BookingBillSettlement | null
    /**
     * 'issued'  — the bill as handed to the guest, from the settlement snapshot.
     * 'running' — what the stay has run up so far, from the live folio.
     */
    mode: 'issued' | 'running'
    /** Set when a settled stay has run up more since it was billed (the guest
     *  paid and kept the room, then ordered again). */
    runningSinceSettlement: number | null
    asOf: string
}

type OrderRow = {
    id: string
    session_id: string | null
    booking_id: string | null
    status: string
    payment_status: string
    placed_at: string
    order_type: string | null
    subtotal_amount: number | null
    tax_amount: number | null
    discount_amount: number | null
    total_amount: number | null
    order_items?: Array<{
        id: string
        status?: string | null
        quantity: number
        unit_price: number
        station?: string | null
        special_request?: string | null
        menu_items?: { name?: string } | null
        menu_item_variations?: { name?: string } | null
    }> | null
    sessions?: { id: string; tables?: { label?: string | null; room_id?: string | null } | null } | null
}

/** PostgREST hands an embedded to-one back as an object or, in some shapes, a
 *  one-element array. Both appear across these queries. */
function one<T>(value: T | T[] | null | undefined): T | null {
    if (!value) return null
    return Array.isArray(value) ? (value[0] ?? null) : value
}

/**
 * Assemble the bill for `bookingId`, covering every room on its reservation.
 *
 * Returns null when the booking does not exist for this restaurant, so the
 * caller answers 404 rather than an empty bill.
 */
export async function buildBookingBill(
    supabase: SupabaseClient,
    opts: { restaurantId: string; bookingId: string },
): Promise<BookingBill | null> {
    const { restaurantId, bookingId } = opts

    const memberIds = await resolveFolioBookingIds(supabase, bookingId)

    // None of these three depends on either of the others' results — only on
    // memberIds/restaurantId, both already known — so they were previously
    // three sequential round trips for no reason. Fetching them together
    // cuts that to one.
    const [stayRowsRes, currentRestRes, linkedSessionsRes] = await Promise.all([
        supabase
            .from('bookings')
            .select(`
                id, restaurant_id, room_id, group_id, guest_name, guest_phone, guest_address, status,
                check_in, check_out, checked_in_at, checked_in_by, checked_out_at, cashier_id,
                total_amount, paid_amount, discount_amount, discount_reason, extra_hour_charge,
                service_charge_override, advance_payment_method, notes, parking_vehicle_no,
                rooms:room_id(room_number, room_types:type_id(name, base_price))
            `)
            .in('id', memberIds)
            .order('created_at', { ascending: true }),
        // The partner restaurant's orders bill onto this folio too, so its id
        // has to be in scope for the order query below — the same resolution
        // folio.ts does.
        supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', restaurantId)
            .maybeSingle(),
        supabase
            .from('sessions')
            .select('id')
            .in('booking_id', memberIds),
    ])

    const stays = stayRowsRes.data || []
    const primary = stays.find(s => s.id === bookingId)
    if (!primary || primary.restaurant_id !== restaurantId) return null

    const partnerId = currentRestRes.data?.linked_restaurant_id || currentRestRes.data?.linked_hotel_id
    const targetRestaurantIds = partnerId ? [restaurantId, partnerId] : [restaurantId]
    const sessionIds = (linkedSessionsRes.data || []).map(s => s.id as string)

    const orderSelect = `
        id, session_id, booking_id, status, payment_status, placed_at, order_type,
        subtotal_amount, tax_amount, discount_amount, total_amount,
        order_items(id, status, quantity, unit_price, station, special_request,
                    menu_items(name), menu_item_variations:menu_item_variation_id(name)),
        sessions(id, tables:table_id(label, room_id))
    `

    let orderQuery = supabase
        .from('orders')
        .select(orderSelect)
        .in('restaurant_id', targetRestaurantIds)
        .neq('status', 'cancelled')
    orderQuery = sessionIds.length > 0
        ? orderQuery.or(`booking_id.in.(${memberIds.join(',')}),session_id.in.(${sessionIds.join(',')})`)
        : orderQuery.in('booking_id', memberIds)

    // Orders, manual charges, payments and the settlement snapshot don't need
    // the live folio recomputed to be read, so fetch them without waiting on it.
    const [ordersRes, chargesRes, paymentsRes, settlementRes] = await Promise.all([
        orderQuery,
        supabase
            .from('room_charges')
            .select('id, description, amount, charge_type')
            .in('booking_id', memberIds)
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: true }),
        supabase
            .from('booking_payments')
            .select('amount, cash_amount, qr_amount, note')
            .in('booking_id', memberIds),
        // The bill as issued. Written by the checkout route with the folio of
        // the moment inside it, which is the only record of what the guest was
        // actually handed — recomputing it later can drift with menu and room
        // prices. 'booking_bill_settled' is the pay-and-keep-the-room variant.
        supabase
            .from('audit_logs')
            .select('user_id, created_at, new_value')
            .eq('restaurant_id', restaurantId)
            .eq('entity_type', 'booking')
            .in('entity_id', memberIds)
            .in('action', ['booking_checked_out', 'booking_bill_settled'])
            .order('created_at', { ascending: false })
            .limit(1),
    ])

    const settlementRow = settlementRes.data?.[0] ?? null
    const settlementValue = (settlementRow?.new_value ?? null) as Record<string, unknown> | null
    const isSettled = !!settlementRow
    // Undefined/missing means the stay closed out normally (the common case
    // recorded before this field existed); only an explicit `false` means the
    // guest paid and kept the room.
    const closedStay = settlementValue?.closed_stay !== false

    // The full folio recompute — room pricing rules, occupancy, per-order
    // service charge, and several more queries inside it — is only needed
    // while a stay is still running, or once settled if the guest paid and
    // kept the room, where charges can still be added after the bill was
    // issued. A stay that is settled AND closed can never run up more: its
    // bill is the settlement snapshot, full stop. Recomputing the live folio
    // just to confirm runningSinceSettlement is 0 there is wasted latency —
    // and that's the case for the large majority of "View History" clicks,
    // which look back at stays that finished long ago.
    const folio = (!isSettled || closedStay === false)
        ? await computeFolioForStays(supabase, {
            // No serviceChargeOverride passed, so a settled stay replays the
            // charge it was billed at rather than what the rules would
            // produce today.
            restaurantId,
            stays: stays.map(s => ({
                bookingId: s.id as string,
                roomId: s.room_id as string,
                checkIn: s.check_in as string,
                checkOut: s.check_out as string,
                checkedOutAt: s.checked_out_at as string | null,
                status: s.status as string | null,
            })),
            sessionId: null,
            // Summed across the reservation, the way /api/rooms/stay-billing
            // does it. The folio here is built over every member room, but the
            // discount came from the primary booking alone — and checkout
            // spreads a group discount proportionally across the rooms
            // (allocateAcrossRooms), so on a 3-room group each row holds a
            // third. Reading one row left the recomputed folio short of the
            // discount actually given and overstated what was still running.
            discountAmount: stays.reduce((sum, s) => sum + (Number(s.discount_amount) || 0), 0),
        }).catch(() => null)
        : null

    // Which folio the bill is built from, decided once: the snapshot for a stay
    // that has been settled — that is the bill the guest was given, and every
    // line, room and per-order figure has to come from the same place or the
    // parts stop adding up to the total — and the live one while it is running.
    const snapshot = (settlementValue?.folio ?? null) as FolioBreakdown | null
    const lines = (isSettled ? snapshot : null) ?? folio
    const settledTotal = round2(Number(settlementValue?.total_amount) || 0)
    const total = isSettled ? settledTotal : round2(folio?.total ?? 0)
    // Everything the lines account for. What the guest was charged over that is
    // the extra-hour charge, or an adjustment made at the till.
    const linesTotal = round2(lines?.total ?? 0)

    // ── Names on the bill ────────────────────────────────────────────────────
    const userIds = [
        primary.checked_in_by as string | null,
        primary.cashier_id as string | null,
        settlementRow?.user_id as string | null,
    ].filter((id): id is string => !!id)
    const { data: userRows } = userIds.length > 0
        ? await supabase.from('users').select('id, full_name').in('id', [...new Set(userIds)])
        : { data: [] as Array<{ id: string; full_name: string | null }> }
    const nameById = new Map((userRows || []).map(u => [u.id as string, u.full_name as string | null]))
    const nameOf = (id: string | null | undefined) => (id ? nameById.get(id) || 'Unknown' : null)

    // ── Room lines ───────────────────────────────────────────────────────────
    const stayById = new Map(stays.map(s => [s.id as string, s]))
    const customRatePerNight = getBookingCustomPrice(primary)
    const roomLines: BookingBillRoomLine[] = (lines?.rooms ?? []).map(line => {
        const stay = stayById.get(line.bookingId)
        const room = one(stay?.rooms as never) as { room_number?: string; room_types?: unknown } | null
        const roomType = one(room?.room_types as never) as { name?: string; base_price?: number } | null
        const agreed = stay ? getBookingCustomPrice(stay) : 0
        return {
            bookingId: line.bookingId,
            roomNumber: line.roomNumber || room?.room_number || '',
            roomType: roomType?.name ?? null,
            nights: line.nights,
            lateNights: line.lateNights,
            nightlyRate: agreed > 0 ? agreed : Number(roomType?.base_price) || 0,
            stayCost: round2(line.stayCost),
        }
    })

    // ── Service orders ───────────────────────────────────────────────────────
    // What each order contributed comes from the same folio the bill's lines
    // did, so an order's own figure and the bill's food total can never
    // disagree. An order the folio has no line for is still listed — somebody
    // placed it against this room — but marked as not billed, which on a settled
    // stay is exactly what an order placed after checkout is.
    const folioOrderTotal = new Map((lines?.orders ?? []).map(o => [o.id, Number(o.total) || 0]))
    const roomIdToNumber = new Map(
        stays.map(s => {
            const room = one(s.rooms as never) as { room_number?: string } | null
            return [s.room_id as string, room?.room_number || '']
        }),
    )

    const orders: BookingBillOrder[] = ((ordersRes.data || []) as unknown as OrderRow[])
        .map(o => {
            const items = (o.order_items || []).filter(it => it.status !== 'cancelled')
            const subtotal = round2(items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0))
            const session = one(o.sessions as never) as { id: string; tables?: unknown } | null
            const table = one(session?.tables as never) as { label?: string | null; room_id?: string | null } | null

            // A session whose table belongs to a room is the in-room QR; a
            // session on an ordinary table is dining billed to the stay; no
            // session at all is the desk putting an order onto the room.
            const kind: BookingBillOrderKind = !o.session_id
                ? 'direct'
                : table?.room_id
                    ? 'room_qr'
                    : 'dining_table'

            const billed = folioOrderTotal.has(o.id)
            const billedTotal = billed ? round2(folioOrderTotal.get(o.id) as number) : 0

            return {
                id: o.id,
                ref: `#${o.id.slice(0, 5).toUpperCase()}`,
                placedAt: o.placed_at,
                kind,
                status: o.status,
                paymentStatus: o.payment_status,
                orderType: o.order_type || 'dine_in',
                tableLabel: kind === 'room_qr'
                    ? `Room ${roomIdToNumber.get(table?.room_id as string) || ''}`.trim()
                    : table?.label ?? null,
                items: items.map(it => {
                    const menuItem = one(it.menu_items as never) as { name?: string } | null
                    const variation = one(it.menu_item_variations as never) as { name?: string } | null
                    const quantity = Number(it.quantity) || 0
                    const unitPrice = Number(it.unit_price) || 0
                    return {
                        id: it.id,
                        name: menuItem?.name || 'Item',
                        variation: variation?.name ?? null,
                        quantity,
                        unitPrice,
                        lineTotal: round2(unitPrice * quantity),
                        station: it.station ?? null,
                        specialRequest: it.special_request ?? null,
                    }
                }),
                subtotal,
                // What the folio added over the item lines is the room service
                // charge on this order.
                serviceCharge: billed ? Math.max(0, round2(billedTotal - subtotal)) : 0,
                billedTotal,
                taxAtOrderTime: round2(Number(o.tax_amount) || 0),
                discountAtOrderTime: round2(Number(o.discount_amount) || 0),
                billed,
            }
        })
        .sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime())

    const foodDiscount = round2(orders.reduce((s, o) => s + o.discountAtOrderTime, 0))

    const charges: BookingBillCharge[] = (chargesRes.data || []).map(c => ({
        id: c.id as string,
        description: (c.description as string) || 'Charge',
        amount: round2(Number(c.amount)),
        chargeType: (c.charge_type as string) || 'other',
    }))

    // ── Payments ─────────────────────────────────────────────────────────────
    // Settlement rows carry the literal note 'Settlement' (recordSettlementPayment
    // in the checkout route); an advance's note is front-desk editable, so
    // "not Settlement" is what reliably means the advance.
    const paymentRows = paymentsRes.data || []
    const sumBy = (isSettlement: boolean, field: 'cash_amount' | 'qr_amount') =>
        round2(paymentRows
            .filter(p => (p.note === 'Settlement') === isSettlement)
            .reduce((s, p) => s + (Number(p[field]) || 0), 0))
    // booking_payments has no credit column: the settlement row's `amount` is
    // cash + qr + credit, so the remainder is what went on the guest's account.
    const creditSettled = round2(paymentRows
        .filter(p => p.note === 'Settlement')
        .reduce((s, p) => s + Math.max(0, (Number(p.amount) || 0) - (Number(p.cash_amount) || 0) - (Number(p.qr_amount) || 0)), 0))

    const hasAdvanceRow = paymentRows.some(p => p.note !== 'Settlement')
    const hasSettlementRow = paymentRows.some(p => p.note === 'Settlement')
    const paidRecorded = round2(stays.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0))
    const advanceMethod = (primary.advance_payment_method as string) || null

    // ── Totals ───────────────────────────────────────────────────────────────
    const extraHourCharge = round2(stays.reduce((s, r) => s + (Number(r.extra_hour_charge) || 0), 0))

    const totals: BookingBillTotals = {
        stayCost: round2(lines?.stayCost ?? 0),
        roomDiscount: round2(lines?.discountAmount ?? 0),
        chargesTotal: round2(lines?.chargesTotal ?? 0),
        ordersTotal: round2(lines?.ordersTotalCharged ?? lines?.ordersTotal ?? 0),
        serviceCharge: round2(lines?.serviceChargeCharged ?? 0),
        serviceChargeAuto: round2(lines?.serviceCharge ?? 0),
        serviceChargeOverridden: round2(lines?.serviceChargeCharged ?? 0) !== round2(lines?.serviceCharge ?? 0),
        foodDiscount,
        vat: round2(lines?.vat ?? 0),
        extraHourCharge,
        total,
        adjustment: isSettled ? round2(total - linesTotal) : 0,
    }

    // What was taken at the till, in order of how directly it was recorded.
    //
    // booking_payments only started being written on 2026-07-28, so for most
    // stays it is empty and its cash/QR columns would report that nothing was
    // ever received. The settlement snapshot carries cash_paid/qr_paid for every
    // settled stay before that, and bookings.paid_amount carries the rest.
    const settlementCash = hasSettlementRow
        ? sumBy(true, 'cash_amount')
        : round2(Number(settlementValue?.cash_paid) || 0)
    const settlementQr = hasSettlementRow
        ? sumBy(true, 'qr_amount')
        : round2(Number(settlementValue?.qr_paid) || 0)
    const settlementCollected = round2(settlementCash + settlementQr)

    // paid_amount already includes whatever was collected at settlement, so the
    // advance is the remainder. In-house stays have no settlement, which leaves
    // paid_amount as exactly the advance.
    const advanceTotal = hasAdvanceRow
        ? round2(sumBy(false, 'cash_amount') + sumBy(false, 'qr_amount'))
        : Math.max(0, round2(paidRecorded - settlementCollected))
    // A reconstructed advance can only be attributed when the method says how it
    // came in; 'split' records the total but not the division.
    const advanceSplitKnown = hasAdvanceRow || advanceTotal === 0 || advanceMethod === 'cash' || advanceMethod === 'qr_digital'
    const advanceCash = hasAdvanceRow
        ? sumBy(false, 'cash_amount')
        : (advanceMethod === 'cash' ? advanceTotal : 0)
    const advanceQr = hasAdvanceRow
        ? sumBy(false, 'qr_amount')
        : (advanceMethod === 'qr_digital' ? advanceTotal : 0)

    const collectedTotal = round2(advanceTotal + settlementCollected)
    // Only an explicit payment row can say "this went on the guest's account";
    // anything else the bill charged and did not collect is reported as
    // uncollected, which is all the booking record actually knows.
    const uncollected = isSettled
        ? Math.max(0, round2(total - collectedTotal - creditSettled))
        : 0
    const netDue = isSettled ? 0 : Math.max(0, round2(total - collectedTotal))
    const returnToGuest = Math.max(0, round2(collectedTotal + creditSettled - total))

    const payments: BookingBillPayments = {
        advanceCash,
        advanceQr,
        advanceTotal,
        settlementCash,
        settlementQr,
        credit: creditSettled,
        uncollected,
        collectedTotal,
        paidRecorded,
        netDue,
        returnToGuest,
        advanceMethod,
        detail: paymentRows.length > 0 ? 'recorded' : 'reconstructed',
        advanceSplitKnown,
    }

    const settlement: BookingBillSettlement | null = settlementRow
        ? {
            at: settlementRow.created_at as string,
            by: nameOf(settlementRow.user_id as string | null) ?? nameOf(primary.cashier_id as string | null),
            closedStay,
            totalCharged: settledTotal,
            cashPaid: round2(Number(settlementValue?.cash_paid) || 0),
            qrPaid: round2(Number(settlementValue?.qr_paid) || 0),
            creditAmount: creditSettled,
            discountAmount: round2(Number(settlementValue?.discount_amount) || 0),
            // Rebuilt the way the checkout route builds it for the IRD filing,
            // which is the only place this reference is minted.
            invoiceNumber: bookingInvoiceNumber(primary.id as string),
            snapshot,
        }
        : null

    return {
        bookingId: primary.id as string,
        groupId: (primary.group_id as string) || null,
        guestName: (primary.guest_name as string) || 'Guest',
        guestPhone: (primary.guest_phone as string) || null,
        guestAddress: (primary.guest_address as string) || null,
        status: primary.status as string,
        checkIn: primary.check_in as string,
        checkOut: primary.check_out as string,
        checkedInAt: (primary.checked_in_at as string) || null,
        checkedInBy: nameOf(primary.checked_in_by as string | null),
        checkedOutAt: (primary.checked_out_at as string) || null,
        checkedOutBy: nameOf(primary.cashier_id as string | null),
        nights: lines?.nights ?? folio?.nights ?? 0,
        customRatePerNight,
        parkingVehicleNo: (primary.parking_vehicle_no as string) || null,
        rooms: roomLines,
        charges,
        orders,
        totals,
        payments,
        settlement,
        mode: isSettled ? 'issued' : 'running',
        // A stay that was billed and kept the room can go on running up charges,
        // and the difference is the one number that says so.
        runningSinceSettlement: isSettled && folio
            ? round2(Math.max(0, round2(folio.total) - linesTotal))
            : null,
        asOf: new Date().toISOString(),
    }
}
