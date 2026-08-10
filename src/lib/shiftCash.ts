// Computes how much cash+QR a staff member should hand over for one shift
// (clock-in to clock-out, or clock-in to now if still open), by reducing
// their own day_book_entries within that window — including advance payments,
// room settlements, dine-in table checkouts, and POS order payments.
// Bank/other movement is excluded; only Cash and QR collections are included.

import { SupabaseClient } from '@supabase/supabase-js'
import { round2 } from './utils'

export interface ShiftCashItem {
    id: string
    type: 'cash_in' | 'cash_out' | 'bank_in' | 'bank_out'
    category: string
    amount: number
    description: string
    bankName: string | null
    createdAt: string
    isCash: boolean
    isQr: boolean
}

export interface RoomCheckInItem {
    id: string
    roomNumber: string
    guestName: string
    checkInTime: string
    advanceAmount: number
}

export interface RoomCheckOutItem {
    id: string
    roomNumber: string
    guestName: string
    checkOutTime: string
    settledAmount: number
    outstandingAmount: number
}

export interface UncollectedHandoverItem {
    id: string
    type: 'room' | 'table'
    label: string
    description: string
    amount: number
}

export interface ShiftFinancialMetrics {
    serviceChargeTotal: number
    discountTotal: number
    restaurantSalesTotal: number
    roomSalesTotal: number
    /** Standalone table/dine-in orders left unpaid (put on the customer's tab). */
    unpaidOrdersTotal: number
    /** Room stays checked out with a balance still owing on the folio. */
    folioOutstandingTotal: number
    roomCheckIns: RoomCheckInItem[]
    roomCheckOuts: RoomCheckOutItem[]
    uncollectedHandovers: UncollectedHandoverItem[]
    totalUncollectedHandover: number
}

export interface ShiftCashBreakdown {
    totalExpected: number
    cashInTotal: number
    cashOutTotal: number
    qrInTotal: number
    qrOutTotal: number
    items: ShiftCashItem[]
    metrics: ShiftFinancialMetrics
}

export async function computeShiftCashBreakdown(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string,
    clockIn: string,
    windowEnd: string
): Promise<ShiftCashBreakdown> {
    // Add a 2-minute grace buffer on clockIn to catch bookings/payments initiated right as the shift opens
    const exactClockIn = new Date(new Date(clockIn).getTime() - 2 * 60 * 1000).toISOString()
    const exactWindowEnd = new Date(windowEnd).toISOString()

    const { data } = await supabase
        .from('day_book_entries')
        .select('id, type, category, amount, description, bank_name, reference_id, created_at')
        .eq('restaurant_id', restaurantId)
        .eq('created_by', userId)
        .gte('created_at', exactClockIn)
        .lte('created_at', exactWindowEnd)
        .order('created_at', { ascending: false })

    let cashInTotal = 0
    let cashOutTotal = 0
    let qrInTotal = 0
    let qrOutTotal = 0
    const items: ShiftCashItem[] = []

    for (const e of data || []) {
        const amount = Number(e.amount) || 0
        const isQrCategory = e.category === 'qr_payment' || e.category === 'order_payment' || e.category === 'booking_payment' || e.category === 'room_deposit' || e.category === 'refund'

        let isCash = false
        let isQr = false

        if (e.type === 'cash_in') {
            cashInTotal += amount
            isCash = true
        } else if (e.type === 'cash_out') {
            cashOutTotal += amount
            isCash = true
        } else if (e.type === 'bank_in' && isQrCategory) {
            qrInTotal += amount
            isQr = true
        } else if (e.type === 'bank_out' && isQrCategory) {
            qrOutTotal += amount
            isQr = true
        } else {
            // Ignore non-QR bank transfers / other non-cash/QR movements
            continue
        }

        items.push({
            id: e.id,
            type: e.type as ShiftCashItem['type'],
            category: e.category,
            amount,
            description: e.description || '',
            bankName: e.bank_name || null,
            createdAt: e.created_at,
            isCash,
            isQr,
        })
    }

    // 1. Fetch Orders for this user in shift window
    const { data: ordersData } = await supabase
        .from('orders')
        .select('id, total_amount, subtotal_amount, discount_amount, service_charge_amount, payment_status, booking_id, customer_name, placed_at, booking:bookings(rooms(room_number))')
        .eq('restaurant_id', restaurantId)
        .or(`cashier_id.eq.${userId},claimed_by.eq.${userId},waiter_id.eq.${userId}`)
        .gte('placed_at', exactClockIn)
        .lte('placed_at', exactWindowEnd)

    let serviceChargeTotal = 0
    let discountTotal = 0
    let restaurantSalesTotal = 0
    let roomSalesTotal = 0
    let unpaidOrdersTotal = 0
    let folioOutstandingTotal = 0
    const uncollectedHandovers: UncollectedHandoverItem[] = []

    for (const o of ordersData || []) {
        const total = Number(o.total_amount) || 0
        const disc = Number(o.discount_amount) || 0
        const sc = Number(o.service_charge_amount) || 0

        discountTotal += disc
        serviceChargeTotal += sc

        if (o.booking_id) {
            // Table order linked to a room folio counts as ROOM SALES
            roomSalesTotal += total
        } else {
            // Standalone table order counts as RESTAURANT SALES
            restaurantSalesTotal += total
        }

        if (o.payment_status !== 'paid') {
            unpaidOrdersTotal += total
            const roomNum = (o.booking as { rooms?: { room_number?: string } | null } | null)?.rooms?.room_number
            uncollectedHandovers.push({
                id: o.id,
                type: 'table',
                label: roomNum ? `Table Order (Room ${roomNum})` : `Table Order #${o.id.slice(0, 6)}`,
                description: `Customer: ${o.customer_name || 'Walk-in'} — Uncollected table bill`,
                amount: total,
            })
        }
    }

    // 2. Fetch Bookings for Check-Ins strictly within shift window for THIS USER
    const { data: rawCheckInBookings } = await supabase
        .from('bookings')
        .select('id, guest_name, total_amount, paid_amount, discount_amount, checked_in_at, created_at, status, checked_in_by, cashier_id, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .or(`checked_in_at.gte.${exactClockIn},created_at.gte.${exactClockIn}`)

    // 3. Fetch Bookings for Check-Outs strictly within shift window for THIS USER
    const { data: rawCheckOutBookings } = await supabase
        .from('bookings')
        .select('id, guest_name, total_amount, paid_amount, discount_amount, checked_in_at, checked_out_at, bill_settled_at, created_at, status, cashier_id, checked_in_by, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .or(`checked_out_at.gte.${exactClockIn},bill_settled_at.gte.${exactClockIn}`)

    // 3b. What was actually collected AT each checkout — not the booking's
    // cumulative paid_amount, which also bundles in any advance taken at
    // check-in (often a different shift, sometimes a different cashier).
    // Counting the whole stay against whoever happened to run the checkout
    // overstated both "Settled" per room and this shift's Room Sales total.
    const checkoutBookingIds = (rawCheckOutBookings || []).map(b => b.id)
    const { data: settlementRows } = checkoutBookingIds.length > 0
        ? await supabase
            .from('booking_payments')
            .select('booking_id, cash_amount, qr_amount, created_at')
            .in('booking_id', checkoutBookingIds)
            .eq('note', 'Settlement')
        : { data: [] as { booking_id: string; cash_amount: number; qr_amount: number; created_at: string }[] }

    const settlementsByBooking = new Map<string, { cash_amount: number; qr_amount: number; created_at: string }[]>()
    for (const row of settlementRows || []) {
        const list = settlementsByBooking.get(row.booking_id) ?? []
        list.push(row)
        settlementsByBooking.set(row.booking_id, list)
    }

    // booking_payments only started being written 2026-07-28 — before that,
    // there's no per-checkout record to read, so the cumulative paid_amount
    // is the best number available for those.
    const BOOKING_PAYMENTS_START = new Date('2026-07-28T00:00:00Z').getTime()

    /**
     * The settlement collected at this specific checkout. A booking can carry
     * more than one 'Settlement' row over its life (an earlier "Settle, Keep
     * Room" plus the final checkout), so this picks whichever one landed
     * closest to this checkout's own timestamp — the one this event created.
     *
     * Falls back to the booking's cumulative paid_amount only for checkouts
     * that predate booking_payments; after that cutoff, no matching row means
     * nothing new was collected here (e.g. the stay was already fully paid),
     * so it correctly reads as 0 rather than re-attributing an old advance.
     */
    function checkoutSettledAmount(bookingId: string, checkoutTime: string, cumulativePaid: number): number {
        const rows = settlementsByBooking.get(bookingId)
        const targetTs = new Date(checkoutTime).getTime()
        if (rows && rows.length > 0) {
            const closest = rows.reduce((best, row) => {
                const diff = Math.abs(new Date(row.created_at).getTime() - targetTs)
                const bestDiff = Math.abs(new Date(best.created_at).getTime() - targetTs)
                return diff < bestDiff ? row : best
            })
            return round2((Number(closest.cash_amount) || 0) + (Number(closest.qr_amount) || 0))
        }
        return targetTs < BOOKING_PAYMENTS_START ? cumulativePaid : 0
    }

    // Collect booking IDs and descriptions associated with day_book_entries created by THIS user during this shift
    const userDayBookBookingIds = new Set<string>()
    const userDayBookDescriptions: string[] = []
    let dayBookRoomSales = 0
    let dayBookRestaurantSales = 0

    for (const e of data || []) {
        const amt = Number(e.amount) || 0
        if (e.reference_id) userDayBookBookingIds.add(e.reference_id)
        if (e.description) userDayBookDescriptions.push(e.description.toLowerCase())

        if (e.category === 'room_deposit' || e.category === 'booking_payment') {
            dayBookRoomSales += amt
        } else if (e.category === 'order_payment' || e.category === 'qr_payment') {
            dayBookRestaurantSales += amt
        }
    }

    const roomCheckIns: RoomCheckInItem[] = []
    const roomCheckOuts: RoomCheckOutItem[] = []
    const processedCheckins = new Set<string>()
    const processedCheckouts = new Set<string>()

    const startTs = new Date(exactClockIn).getTime()
    const endTs = new Date(exactWindowEnd).getTime()

    for (const b of rawCheckInBookings || []) {
        if (processedCheckins.has(b.id)) continue

        const roomNum = (b.rooms as { room_number?: string } | null)?.room_number?.toLowerCase() || ''
        const guestName = (b.guest_name || '').toLowerCase()
        const descriptionMatch = userDayBookDescriptions.some(desc => (roomNum && desc.includes(`room ${roomNum}`)) || (guestName && desc.includes(guestName)))

        // Room check-in appears ONLY on the shift panel of the staff member who performed the check-in
        const isUserCheckin = b.checked_in_by === userId || userDayBookBookingIds.has(b.id) || descriptionMatch
        if (!isUserCheckin) continue

        const checkinTime = b.checked_in_at || (b.status === 'checked_in' ? b.created_at : null)
        if (!checkinTime) continue

        const checkinTs = new Date(checkinTime).getTime()

        if (checkinTs >= startTs && (checkinTs <= endTs + 2 * 60 * 1000 || userDayBookBookingIds.has(b.id) || descriptionMatch)) {
            processedCheckins.add(b.id)
            const displayRoomNum = (b.rooms as { room_number?: string } | null)?.room_number || 'Room'
            const rawTotal = Number(b.total_amount) || 0
            const paid = Number(b.paid_amount) || 0
            const disc = Number(b.discount_amount) || 0
            const total = rawTotal > 0 ? rawTotal : paid

            discountTotal += disc
            roomSalesTotal += total

            roomCheckIns.push({
                id: b.id,
                roomNumber: displayRoomNum,
                guestName: b.guest_name || 'Guest',
                checkInTime: checkinTime,
                advanceAmount: paid,
            })

            if (b.status === 'checked_in') {
                const pendingBalance = Math.max(0, total - paid)
                if (pendingBalance > 0) {
                    uncollectedHandovers.push({
                        id: b.id,
                        type: 'room',
                        label: `Room ${displayRoomNum} Stay Balance`,
                        description: `Guest: ${b.guest_name} — Active stay to be checked out by next person`,
                        amount: pendingBalance,
                    })
                }
            }
        }
    }

    for (const b of rawCheckOutBookings || []) {
        if (processedCheckouts.has(b.id)) continue

        const roomNum = (b.rooms as { room_number?: string } | null)?.room_number?.toLowerCase() || ''
        const guestName = (b.guest_name || '').toLowerCase()
        const descriptionMatch = userDayBookDescriptions.some(desc => (roomNum && desc.includes(`room ${roomNum}`)) || (guestName && desc.includes(guestName)))

        // Room settlement/checkout appears ONLY on the shift panel of the cashier who settled/checked out the room
        const isUserCheckout = b.cashier_id === userId || userDayBookBookingIds.has(b.id) || descriptionMatch
        if (!isUserCheckout) continue

        const checkoutTime = b.checked_out_at || (b.status === 'checked_out' ? b.bill_settled_at : null)
        if (!checkoutTime) continue

        const checkoutTs = new Date(checkoutTime).getTime()

        if (checkoutTs >= startTs && (checkoutTs <= endTs + 2 * 60 * 1000 || userDayBookBookingIds.has(b.id) || descriptionMatch)) {
            processedCheckouts.add(b.id)
            const displayRoomNum = (b.rooms as { room_number?: string } | null)?.room_number || 'Room'
            const rawTotal = Number(b.total_amount) || 0
            const paid = Number(b.paid_amount) || 0
            const disc = Number(b.discount_amount) || 0
            const total = rawTotal > 0 ? rawTotal : paid
            const outstanding = Math.max(0, total - paid)
            const settledAtCheckout = checkoutSettledAmount(b.id, checkoutTime, paid)

            roomSalesTotal += settledAtCheckout
            discountTotal += disc

            roomCheckOuts.push({
                id: b.id,
                roomNumber: displayRoomNum,
                guestName: b.guest_name || 'Guest',
                checkOutTime: checkoutTime,
                settledAmount: settledAtCheckout,
                outstandingAmount: outstanding,
            })

            if (outstanding > 0) {
                folioOutstandingTotal += outstanding
            }
        }
    }

    const totalUncollectedHandover = round2(uncollectedHandovers.reduce((sum, item) => sum + item.amount, 0))

    const metrics: ShiftFinancialMetrics = {
        serviceChargeTotal: round2(serviceChargeTotal),
        discountTotal: round2(discountTotal),
        restaurantSalesTotal: round2(restaurantSalesTotal),
        roomSalesTotal: round2(roomSalesTotal),
        unpaidOrdersTotal: round2(unpaidOrdersTotal),
        folioOutstandingTotal: round2(folioOutstandingTotal),
        roomCheckIns,
        roomCheckOuts,
        uncollectedHandovers,
        totalUncollectedHandover,
    }

    const totalExpected = round2(cashInTotal - cashOutTotal + qrInTotal - qrOutTotal)

    return {
        totalExpected,
        cashInTotal: round2(cashInTotal),
        cashOutTotal: round2(cashOutTotal),
        qrInTotal: round2(qrInTotal),
        qrOutTotal: round2(qrOutTotal),
        items,
        metrics,
    }
}

export async function computeShiftExpectedCash(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string,
    clockIn: string,
    windowEnd: string
): Promise<number> {
    const breakdown = await computeShiftCashBreakdown(supabase, restaurantId, userId, clockIn, windowEnd)
    return breakdown.totalExpected
}
