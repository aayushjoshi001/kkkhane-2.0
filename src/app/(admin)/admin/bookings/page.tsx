import { createAdminClient } from '@/lib/supabase/server'
import type { BillingTable, BillingOrder } from '@/components/admin/RoomBillingModal'
import { getCurrentUser } from '@/lib/auth'
import BookingsClient from './BookingsClient'
import type { Booking, Room } from '@/types/database'

export const revalidate = 0

export default async function BookingsPage() {
    const currentUser = await getCurrentUser()
    const { restaurantId } = currentUser

    const adminSupabase = await createAdminClient()
    
    // Fetch bookings, rooms, tables, sessions and active orders with safety
    let bookings: Booking[] = []
    let rooms: Room[] = []
    let tablesMapped: BillingTable[] = []
    let activeOrders: BillingOrder[] = []

    try {
        const { data: restData } = await adminSupabase
            .from('restaurants')
            .select('linked_restaurant_id')
            .eq('id', restaurantId)
            .maybeSingle()

        const targetRestaurantIds = [restaurantId]
        if (restData?.linked_restaurant_id) {
            targetRestaurantIds.push(restData.linked_restaurant_id)
        }

        const [bookingsRes, roomsRes, tablesRes, activeSessionsRes, activeOrdersRes] = await Promise.all([
            adminSupabase
                .from('bookings')
                .select('*, rooms:room_id(*, room_types:type_id(*))')
                .eq('restaurant_id', restaurantId)
                .order('created_at', { ascending: false }),
            adminSupabase
                .from('rooms')
                .select('*, room_types:type_id(*)')
                .eq('restaurant_id', restaurantId)
                .order('room_number', { ascending: true }),
            adminSupabase
                .from('tables')
                .select('id, label, capacity, table_status, cleaning_claimed_by, cleaning_claimed_at, room_id')
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .order('label', { ascending: true }),
            adminSupabase
                .from('sessions')
                .select('id, table_id, restaurant_id, status, opened_at')
                .eq('restaurant_id', restaurantId)
                .eq('status', 'active'),
            adminSupabase
                .from('orders')
                .select(`
                    id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address, payment_status,
                    sessions ( id, tables ( label ) ),
                    order_items ( id, quantity, status, unit_price, menu_items ( name ) )
                `)
                .in('restaurant_id', targetRestaurantIds)
                // Every unpaid, non-cancelled order still owed on this room's bill -
                // not just ones still in the kitchen workflow. A 'delivered' order
                // that hasn't been paid yet used to be silently excluded here, making
                // the Room Billing total lower than what was actually owed.
                .neq('status', 'cancelled')
                .neq('payment_status', 'paid')
        ])

        bookings = (bookingsRes.data as unknown as Booking[]) || []
        rooms = (roomsRes.data as unknown as Room[]) || []
        activeOrders = (activeOrdersRes.data as unknown as BillingOrder[]) || []
        
        const activeSessions = activeSessionsRes.data || []
        const activeSessionsByTable = Object.fromEntries(
            activeSessions.map(s => [s.table_id, s])
        )
        tablesMapped = (tablesRes.data || []).map(t => ({
            ...t,
            activeSession: activeSessionsByTable[t.id] || null
        }))
    } catch (e) {
        console.error("Failed to load bookings data from DB", e)
    }

    return (
        <BookingsClient 
            initialBookings={bookings} 
            rooms={rooms}
            restaurantId={restaurantId} 
            tables={tablesMapped}
            activeOrders={activeOrders}
        />
    )
}
