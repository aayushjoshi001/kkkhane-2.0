import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getRoomContextForTable } from '@/lib/rooms'
import { computeFolioForStays } from '@/lib/folio'

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
            .select('id, check_in, check_out, paid_amount, room_id, group_id, discount_amount')
            .eq('id', roomContext.bookingId)
            .single()

        if (!booking) {
            return NextResponse.json({ isHotelRoom: false })
        }

        // 2a. If this room is part of a multi-room reservation, the guest owes
        // the combined bill — that is what checkout will charge them, and this
        // page exists precisely so the two can never disagree.
        let stays = [booking]
        if (booking.group_id) {
            const { data: groupRows } = await supabase
                .from('bookings')
                .select('id, check_in, check_out, paid_amount, room_id, group_id, discount_amount')
                .eq('group_id', booking.group_id)
                .neq('status', 'cancelled')
                .order('created_at', { ascending: true })
            if (groupRows && groupRows.length > 0) stays = groupRows
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
        const folio = await computeFolioForStays(supabase, {
            restaurantId: tableData.restaurant_id,
            stays: stays.map(s => ({
                bookingId: s.id,
                roomId: s.room_id,
                checkIn: s.check_in,
                checkOut: s.check_out,
            })),
            sessionId: activeSession?.id ?? null,
            discountAmount: stays.reduce((sum, s) => sum + (Number(s.discount_amount) || 0), 0),
        })

        // Advances were collected per room, so the reservation's advance is the
        // sum over its rooms.
        const advancePaid = stays.reduce((sum, s) => sum + Number(s.paid_amount || 0), 0)
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
            discountAmount: folio.discountAmount,
            foodOrders: folio.orders,
            additionalCharges: folio.charges,
            // Present only for a multi-room reservation, so the guest sees which
            // rooms their single bill covers instead of an unexplained total.
            rooms: folio.rooms.length > 1 ? folio.rooms : undefined,
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
