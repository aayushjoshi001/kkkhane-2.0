import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import BookingsClient from './BookingsClient'
import type { Booking, Room } from '@/types/database'

export const revalidate = 0

export default async function BookingsPage() {
    const currentUser = await getCurrentUser()
    const { restaurantId } = currentUser

    const adminSupabase = await createAdminClient()
    
    // Fetch bookings and rooms with safety
    let bookings: Booking[] = []
    let rooms: Room[] = []

    try {
        const [bookingsRes, roomsRes] = await Promise.all([
            adminSupabase
                .from('bookings')
                .select('*, rooms:room_id(*)')
                .eq('restaurant_id', restaurantId)
                .order('created_at', { ascending: false }),
            adminSupabase
                .from('rooms')
                .select('*')
                .eq('restaurant_id', restaurantId)
                .order('room_number', { ascending: true })
        ])

        bookings = (bookingsRes.data as unknown as Booking[]) || []
        rooms = (roomsRes.data as unknown as Room[]) || []
    } catch (e) {
        console.error("Failed to load bookings data from DB", e)
    }

    return (
        <BookingsClient 
            initialBookings={bookings} 
            rooms={rooms}
            restaurantId={restaurantId} 
        />
    )
}
