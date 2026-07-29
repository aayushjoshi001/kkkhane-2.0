import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * Send one room of a shared bill home early, without settling it.
 *
 * A combined bill settles and closes as one unit, which is right when everyone
 * leaves together and wrong the moment they don't: two colleagues share a bill,
 * one flies out Wednesday and the other stays to Friday. The desk's only
 * options were to separate Wednesday's room onto its own bill — defeating the
 * point of combining them — or leave a departed guest checked in for two days,
 * holding a room housekeeping couldn't turn over and reception couldn't re-let.
 *
 * So the room departs and the bill stays whole. The stay goes to 'checked_out'
 * (which is what frees the room to be re-let, see the active-booking guard in
 * /api/bookings) and `checked_out_at` freezes its nights, but its `group_id` is
 * untouched — its stay cost, orders and charges ride on the combined folio and
 * settle with everyone else at the end.
 *
 * No money moves here. That is the whole point, and it is why this is a
 * separate endpoint from checkout rather than a flag on it.
 */

const OPEN_STATUSES = ['pending', 'checked_in']

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const bookingId = typeof body.booking_id === 'string' ? body.booking_id : ''
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: booking } = await supabase
            .from('bookings')
            .select('id, room_id, group_id, status, bill_settled_at, guest_name, rooms:room_id(room_number)')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (!OPEN_STATUSES.includes(booking.status || '')) {
            return NextResponse.json({ error: 'This room has already been checked out' }, { status: 409 })
        }
        if (booking.bill_settled_at) {
            return NextResponse.json(
                { error: 'This bill is already settled — use the normal checkout to release the room.' },
                { status: 409 },
            )
        }
        if (!booking.group_id) {
            return NextResponse.json({
                error: 'This room is not sharing a bill with anything, so there is nothing to leave behind. Check it out and settle it in the usual way.',
            }, { status: 400 })
        }

        // The bill has to survive the departure. Letting the last open room go
        // this way would leave a fully-departed reservation nobody can reach:
        // every screen that settles a bill reaches it through a room that is
        // still checked in.
        const { data: siblings } = await supabase
            .from('bookings')
            .select('id, status')
            .eq('group_id', booking.group_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('status', 'cancelled')

        const stillOpen = (siblings || []).filter(
            b => b.id !== bookingId && OPEN_STATUSES.includes((b.status as string) || ''),
        )
        if (stillOpen.length === 0) {
            return NextResponse.json({
                error: 'This is the last room still checked in on this bill. Settle the bill instead — that closes it and releases the room.',
            }, { status: 409 })
        }

        const roomRaw = booking.rooms as unknown
        const roomRow = Array.isArray(roomRaw) ? roomRaw[0] : (roomRaw as { room_number?: string } | null)
        const roomNumber = roomRow?.room_number ?? ''

        // `checked_out_at` is stamped by the bookings_stamp_checked_out_at
        // trigger the moment status flips, and that timestamp is what freezes
        // this room's nights on the shared folio (see resolveDeparture).
        const { error: closeError } = await supabase
            .from('bookings')
            .update({ status: 'checked_out' })
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
        if (closeError) throw closeError

        // This guest is gone, so their in-room QR must stop ordering onto the
        // bill — and the room may have someone new in it within the hour, who
        // needs a session of their own rather than inheriting this one.
        await supabase
            .from('sessions')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .eq('booking_id', bookingId)
            .eq('status', 'active')

        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', booking.room_id)
            .eq('restaurant_id', currentUser.restaurantId)
        if (roomError) throw roomError

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_room_departed',
            entityType: 'booking',
            entityId: bookingId,
            newValue: {
                // Nothing financial happened here; the room's share of the bill
                // is still owed and settles with the rest of the group.
                room_number: roomNumber,
                group_id: booking.group_id,
                rooms_still_checked_in: stillOpen.length,
                settled: false,
            },
        })

        return NextResponse.json({
            success: true,
            roomNumber,
            roomId: booking.room_id,
            roomsStillCheckedIn: stillOpen.length,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
