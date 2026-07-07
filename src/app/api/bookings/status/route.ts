import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        
        const { bookingId, status } = await req.json()
        if (!bookingId || !status) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }
        
        const supabase = await createAdminClient()
        
        // Retrieve booking to find the associated room
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('room_id')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()
            
        if (fetchError || !booking) throw fetchError || new Error('Booking not found')
        
        // Update booking status
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({ status })
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            
        if (bookingError) throw bookingError
        
        // If checking in, make the room occupied; if checking out, make it dirty for cleaning!
        let roomStatus = null
        if (status === 'checked_in') {
            roomStatus = 'occupied'
        } else if (status === 'checked_out') {
            roomStatus = 'dirty'
        }
        
        if (roomStatus) {
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
