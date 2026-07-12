import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getRoomContextForTable } from '@/lib/rooms'
import { computeFolioTotal } from '@/lib/folio'

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
            .select('id, room_id, restaurant_id')
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
            .select('id, check_in, check_out, paid_amount, room_id')
            .eq('id', roomContext.bookingId)
            .single()

        if (!booking) {
            return NextResponse.json({ isHotelRoom: false })
        }

        // 3. The room's own active QR session, if any - same third folio source
        // computeFolioTotal expects at checkout, so this guest-facing number can
        // never disagree with what they'll actually be charged.
        const { data: activeSession } = await supabase
            .from('sessions')
            .select('id')
            .eq('table_id', tableData.id)
            .eq('status', 'active')
            .maybeSingle()

        // 4. Authoritative folio - the exact same calculation actual checkout
        // uses, so this guest-facing bill can never drift from what's really owed.
        const folio = await computeFolioTotal(supabase, {
            restaurantId: tableData.restaurant_id,
            bookingId: booking.id,
            roomId: booking.room_id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            sessionId: activeSession?.id ?? null,
        })

        const advancePaid = Number(booking.paid_amount || 0)
        const balanceDue = Math.max(0, folio.total - advancePaid)

        return NextResponse.json({
            isHotelRoom: true,
            roomNumber: roomContext.roomNumber,
            guestName: roomContext.guestName,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            nights: folio.nights,
            roomBasePrice: folio.nights > 0 ? round2(folio.stayCost / folio.nights) : 0,
            stayCost: folio.stayCost,
            foodOrders: folio.orders,
            additionalCharges: folio.charges,
            advancePaid,
            grandTotal: folio.total,
            balanceDue
        })
    } catch (e: any) {
        console.error('stay-billing endpoint error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

const round2 = (n: number) => Math.round(n * 100) / 100
