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
    creditSalesTotal: number
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
    let creditSalesTotal = 0
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
            creditSalesTotal += total
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

            roomSalesTotal += total
            discountTotal += disc

            roomCheckOuts.push({
                id: b.id,
                roomNumber: displayRoomNum,
                guestName: b.guest_name || 'Guest',
                checkOutTime: checkoutTime,
                settledAmount: paid,
                outstandingAmount: outstanding,
            })

            if (outstanding > 0) {
                creditSalesTotal += outstanding
            }
        }
    }

    const totalUncollectedHandover = round2(uncollectedHandovers.reduce((sum, item) => sum + item.amount, 0))

    const metrics: ShiftFinancialMetrics = {
        serviceChargeTotal: round2(serviceChargeTotal),
        discountTotal: round2(discountTotal),
        restaurantSalesTotal: round2(restaurantSalesTotal),
        roomSalesTotal: round2(roomSalesTotal),
        creditSalesTotal: round2(creditSalesTotal),
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
