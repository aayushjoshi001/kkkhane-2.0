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

        if (!tableData) {
            return NextResponse.json({ isHotelRoom: false })
        }

        const roomContext = await getRoomContextForTable(supabase, tableData.id)
        if (!roomContext || !roomContext.bookingId) {
            return NextResponse.json({ isHotelRoom: false })
        }

        // 2. Fetch active booking details
        const { data: booking } = await supabase
            .from('bookings')
            .select('*, rooms:room_id(room_number, room_types:room_type_id(base_price, name))')
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

        // 4. Fetch all non-cancelled orders for this booking_id
        const { data: orders } = await supabase
            .from('orders')
            .select('id, total_amount, placed_at')
            .eq('booking_id', booking.id)
            .neq('status', 'cancelled')

        const foodOrders = (orders || []).map(o => ({
            id: o.id,
            total: Number(o.total_amount || 0),
            placedAt: o.placed_at
        }))
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
