import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import RoomsClient from './RoomsClient'
import type { Room, RoomType } from '@/types/database'

export const revalidate = 0

export default async function RoomsPage() {
    const currentUser = await getCurrentUser()
    const { restaurantId } = currentUser

    const adminSupabase = await createAdminClient()
    
    // Fetch rooms and room types with safety
    let rooms: Room[] = []
    let roomTypes: RoomType[] = []

    try {
        const [roomsRes, typesRes] = await Promise.all([
            adminSupabase
                .from('rooms')
                .select('*, room_types:type_id(*)')
                .eq('restaurant_id', restaurantId)
                .order('room_number', { ascending: true }),
            adminSupabase
                .from('room_types')
                .select('*')
                .eq('restaurant_id', restaurantId)
                .order('name', { ascending: true })
        ])

        rooms = (roomsRes.data as unknown as Room[]) || []
        roomTypes = typesRes.data || []
    } catch (e) {
        console.error("Failed to load rooms data from DB", e)
    }

    return (
        <RoomsClient 
            initialRooms={rooms} 
            roomTypes={roomTypes} 
            restaurantId={restaurantId} 
        />
    )
}
