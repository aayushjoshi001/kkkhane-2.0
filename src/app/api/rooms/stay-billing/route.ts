import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getRoomContextForTable } from '@/lib/rooms'
import { calculateNights } from '@/lib/utils'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const tableSlug = searchParams.get('tableSlug')
        if (!tableSlug) {
            return NextResponse.json({ error: 'Missing tableSlug' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Resolve table
        const { data: tableData } = await supabase
            .from('tables')
            .select('id, room_id')
            .eq('qr_token', tableSlug)
            .single()

        if (!tableData || !tableData.room_id) {
            return NextResponse.json({ isHotelRoom: false })
        }

        const roomContext = await getRoomContextForTable(supabase, tableData.id)
        if (!roomContext) {
            return NextResponse.json({ isHotelRoom: false })
        }

        if (!roomContext.bookingId) {
            return NextResponse.json({
                isHotelRoom: true,
                hasActiveBooking: false,
                roomNumber: roomContext.roomNumber
            })
        }

        // 2. Fetch active booking details
        const { data: booking } = await supabase
            .from('bookings')
            .select('*, rooms:room_id(room_number, room_types:type_id(base_price, name))')
            .eq('id', roomContext.bookingId)
            .single()

        if (!booking) {
            return NextResponse.json({ isHotelRoom: false })
        }

        const room = booking.rooms as any
        const roomType = room?.room_types as any
        const pricePerNight = Number(roomType?.base_price ?? 0)

        // 3. Stay cost calculation
        const nights = calculateNights(booking.check_in, booking.check_out)
        const stayCost = pricePerNight * nights

        // 4. Fetch all non-cancelled orders for this booking_id (in-room QR orders —
        // booking_id is stamped directly on the order at placement, see checkout/actions.ts)
        const { data: orders } = await supabase
            .from('orders')
            .select('id, total_amount, placed_at')
            .eq('booking_id', booking.id)
            .neq('status', 'cancelled')

        // 4b. Fetch dining-table orders a waiter linked to this stay (linkSessionToBooking
        // only stamps sessions.booking_id, never the individual orders.booking_id, so these
        // are a disjoint set from the room-QR orders above — see waiter/actions.ts).
        const { data: linkedSessions } = await supabase
            .from('sessions')
            .select('id')
            .eq('booking_id', booking.id)

        const linkedSessionIds = (linkedSessions || []).map(s => s.id)
        let linkedOrders: { id: string; total_amount: number | null; placed_at: string }[] = []
        if (linkedSessionIds.length > 0) {
            const { data: tableOrders } = await supabase
                .from('orders')
                .select('id, total_amount, placed_at')
                .in('session_id', linkedSessionIds)
                .neq('status', 'cancelled')
                .neq('payment_status', 'paid')
            linkedOrders = tableOrders || []
        }

        // De-duplicate defensively in case an order ever ends up reachable via both paths.
        const orderMap = new Map<string, { id: string; total: number; placedAt: string }>()
        for (const o of [...(orders || []), ...linkedOrders]) {
            orderMap.set(o.id, { id: o.id, total: Number(o.total_amount || 0), placedAt: o.placed_at })
        }
        const foodOrders = Array.from(orderMap.values())
        const foodOrdersTotal = foodOrders.reduce((sum, o) => sum + o.total, 0)

        // 5. Fetch all room charges
        const { data: charges } = await supabase
            .from('room_charges')
            .select('*')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: true })

        const additionalCharges = (charges || []).map(c => ({
            id: c.id,
            description: c.description,
            amount: Number(c.amount || 0),
            chargeType: c.charge_type
        }))
        const additionalChargesTotal = additionalCharges.reduce((sum, c) => sum + c.amount, 0)

        // 6. Totals calculation
        const advancePaid = Number(booking.paid_amount || 0)
        const grandTotal = stayCost + foodOrdersTotal + additionalChargesTotal
        const balanceDue = Math.max(0, grandTotal - advancePaid)

        return NextResponse.json({
            isHotelRoom: true,
            roomNumber: roomContext.roomNumber,
            guestName: roomContext.guestName,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            nights,
            roomBasePrice: pricePerNight,
            stayCost,
            foodOrders,
            additionalCharges,
            advancePaid,
            grandTotal,
            balanceDue
        })
    } catch (e: any) {
        console.error('stay-billing endpoint error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
