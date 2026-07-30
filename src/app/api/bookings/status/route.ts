import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { bookingId, status, force } = await req.json()
        if (!bookingId || !status) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Retrieve booking to find the associated room and current status
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('room_id, status')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()

        if (fetchError || !booking) throw fetchError || new Error('Booking not found')

        // Guard: block cancellation of a checked-in guest unless explicitly forced.
        // This prevents accidental cancellations that would wipe the guest from the
        // cashier panel mid-stay.
        if (status === 'cancelled' && booking.status === 'checked_in' && !force) {
            return NextResponse.json({
                error: 'Guest is currently checked in. Confirm you want to cancel this active stay.',
                requiresForce: true,
            }, { status: 409 })
        }

        // Update booking status. checked_in_by is stamped here rather than by
        // a trigger (unlike checked_in_at) — a DB trigger has no way to know
        // which staff member is acting, only the app layer does.
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({
                status,
                ...(status === 'checked_in' ? { checked_in_by: currentUser.id } : {}),
            })
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingError) throw bookingError

        // Sync room status to match the new booking status:
        // - checked_in  → occupied   (room is in use)
        // - checked_out → dirty      (room needs cleaning)
        // - cancelled   → available  (release the room so new bookings can be made)
        // - pending     → occupied   (restore: room is re-occupied)
        let roomStatus: string | null = null
        if (status === 'checked_in') {
            roomStatus = 'occupied'
        } else if (status === 'checked_out') {
            roomStatus = 'dirty'
        } else if (status === 'cancelled') {
            roomStatus = 'available'
        } else if (status === 'pending') {
            // Restoring a cancelled booking → re-occupy the room so cashier
            // panel and room grid reflect the guest is back.
            roomStatus = 'occupied'
        }

        if (roomStatus && booking.room_id) {
            await supabase
                .from('rooms')
                .update({ status: roomStatus })
                .eq('id', booking.room_id)
        }

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

