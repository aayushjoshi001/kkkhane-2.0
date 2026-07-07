import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, room_id } = body

        if (!booking_id || !room_id) {
            return NextResponse.json({ error: 'Missing booking_id or room_id' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Update Booking status
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({ status: 'checked_out' })
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingError) throw bookingError

        // 2. Update Room status to dirty
        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
