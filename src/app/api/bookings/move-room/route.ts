import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * Move a checked-in stay into a different room.
 *
 * The stay keeps its identity — same booking id, same folio — so room-service
 * orders, manual charges and the advance already taken all follow the guest.
 * What changes is which room it points at, and that is recorded rather than
 * overwritten: the open segment in `booking_room_stays` is closed and a new one
 * opened, so the folio can still bill the earlier nights at the old room's rate.
 *
 * The in-room QR needs no special handling. `getActiveBookingForRoom` resolves a
 * room's guest through `bookings.room_id`, so after the update the new room's QR
 * finds this stay and the old room's finds nothing — which is exactly right the
 * moment the guest walks out of it.
 */
export async function POST(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, to_room_id, reason } = body

        if (!booking_id || !to_room_id) {
            return NextResponse.json({ error: 'Booking and destination room are required' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: booking } = await supabase
            .from('bookings')
            .select('id, room_id, guest_name, status, check_in, restaurant_id')
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (booking.status !== 'checked_in') {
            return NextResponse.json(
                { error: 'Only a checked-in stay can be moved to another room.' },
                { status: 409 },
            )
        }
        if (booking.room_id === to_room_id) {
            return NextResponse.json({ error: 'The guest is already in that room.' }, { status: 400 })
        }

        const [{ data: fromRoom }, { data: toRoom }] = await Promise.all([
            supabase
                .from('rooms')
                .select('id, room_number')
                .eq('id', booking.room_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .maybeSingle(),
            supabase
                .from('rooms')
                .select('id, room_number, status, is_active')
                .eq('id', to_room_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .maybeSingle(),
        ])

        if (!toRoom) {
            return NextResponse.json({ error: 'Destination room not found' }, { status: 404 })
        }
        if (!toRoom.is_active) {
            return NextResponse.json({ error: `Room ${toRoom.room_number} is not in service.` }, { status: 409 })
        }

        // Occupancy is decided by whether another stay holds the room, not by the
        // room's status flag — a room left 'dirty' or wrongly marked 'occupied'
        // after a cancelled stay should not block a move, but a room with a real
        // guest in it must.
        const { data: blocking } = await supabase
            .from('bookings')
            .select('id, guest_name')
            .eq('room_id', to_room_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .in('status', ['checked_in', 'pending'])
            .neq('id', booking_id)
            .limit(1)
            .maybeSingle()

        if (blocking) {
            return NextResponse.json(
                { error: `Room ${toRoom.room_number} is occupied by ${blocking.guest_name}. Check that guest out first.` },
                { status: 409 },
            )
        }

        const movedAt = new Date().toISOString()

        // Point the stay at the new room. The DB's exclusion constraint on
        // overlapping active stays is the backstop if the check above raced.
        const { error: bookingUpdateError } = await supabase
            .from('bookings')
            .update({ room_id: to_room_id })
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingUpdateError) {
            const conflict = bookingUpdateError.code === '23P01'
            return NextResponse.json(
                {
                    error: conflict
                        ? `Room ${toRoom.room_number} was taken by another stay just now. Try a different room.`
                        : bookingUpdateError.message,
                },
                { status: conflict ? 409 : 500 },
            )
        }

        // Close the segment for the room being left, then open one for the new
        // room. Ordering matters: a partial unique index allows only one open
        // segment per stay, so the close has to land first.
        const { error: closeError } = await supabase
            .from('booking_room_stays')
            .update({ to_ts: movedAt })
            .eq('booking_id', booking_id)
            .is('to_ts', null)

        if (closeError) console.error('Failed to close room segment', booking_id, closeError)

        const { error: openError } = await supabase
            .from('booking_room_stays')
            .insert({
                restaurant_id: currentUser.restaurantId,
                booking_id,
                room_id: to_room_id,
                from_ts: movedAt,
                moved_by: currentUser.id,
                reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
            })

        if (openError) console.error('Failed to open room segment', booking_id, openError)

        // The room just vacated needs housekeeping before it can be sold again;
        // marking it available would put a bed that has been slept in back on the
        // board as ready.
        await Promise.all([
            supabase
                .from('rooms')
                .update({ status: 'dirty' })
                .eq('id', booking.room_id)
                .eq('restaurant_id', currentUser.restaurantId),
            supabase
                .from('rooms')
                .update({ status: 'occupied' })
                .eq('id', to_room_id)
                .eq('restaurant_id', currentUser.restaurantId),
        ])

        // An open room-service session lives on the old room's QR table. Move it
        // with the guest so a tab started before the move stays on their folio
        // and the new room's QR continues it rather than opening a second one.
        const { data: newTable } = await supabase
            .from('tables')
            .select('id')
            .eq('room_id', to_room_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (newTable) {
            await supabase
                .from('sessions')
                .update({ table_id: newTable.id })
                .eq('booking_id', booking_id)
                .eq('restaurant_id', currentUser.restaurantId)
                .eq('status', 'active')
        }

        await logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_room_changed',
            entityType: 'booking',
            entityId: booking_id,
            oldValue: { room_id: booking.room_id, room_number: fromRoom?.room_number ?? null },
            newValue: {
                room_id: to_room_id,
                room_number: toRoom.room_number,
                moved_at: movedAt,
                reason: reason || null,
            },
        })

        return NextResponse.json({
            success: true,
            from_room: fromRoom?.room_number ?? null,
            to_room: toRoom.room_number,
            moved_at: movedAt,
        })
    } catch (error) {
        console.error('Room move failed:', error)
        const message = error instanceof Error ? error.message : 'Failed to move room'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
