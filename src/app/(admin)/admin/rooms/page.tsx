import { createAdminClient } from '@/lib/supabase/server'
import type { BillingTable, BillingOrder } from '@/components/admin/RoomBillingModal'
import { getCurrentUser } from '@/lib/auth'
import RoomsClient from './RoomsClient'
import type { Room, RoomType } from '@/types/database'

export const revalidate = 0

export default async function RoomsPage() {
    const currentUser = await getCurrentUser()
    const { restaurantId } = currentUser

    const adminSupabase = await createAdminClient()
    
    // Fetch rooms, room types, tables, sessions and active orders with safety
    let rooms: Room[] = []
    let roomTypes: RoomType[] = []
    let restaurantSlug = ''
    let restaurantName = ''
    let tablesMapped: BillingTable[] = []
    let activeOrders: BillingOrder[] = []

    try {
        const [roomsRes, typesRes, restRes, tablesRes, activeSessionsRes, activeOrdersRes] = await Promise.all([
            adminSupabase
                .from('rooms')
                .select('*, room_types:type_id(*)')
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .order('room_number', { ascending: true }),
            adminSupabase
                .from('room_types')
                .select('*')
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .order('name', { ascending: true }),
            adminSupabase
                .from('restaurants')
                .select('name, slug, linked_restaurant_id')
                .eq('id', restaurantId)
                .single(),
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
                .eq('restaurant_id', restaurantId)
                // Every unpaid, non-cancelled order still owed on this room's bill -
                // not just ones still in the kitchen workflow. A 'delivered' order
                // that hasn't been paid yet used to be silently excluded here, making
                // the Room Billing total lower than what was actually owed.
                .neq('status', 'cancelled')
                .neq('payment_status', 'paid')
        ])

        rooms = (roomsRes.data as unknown as Room[]) || []
        roomTypes = typesRes.data || []
        restaurantSlug = restRes.data?.slug || ''
        restaurantName = restRes.data?.name || ''

        // If this is a Hotel linked to a partner Restaurant, resolve the Restaurant's slug for the QR codes!
        if (restRes.data?.linked_restaurant_id) {
            const { data: partnerRest } = await adminSupabase
                .from('restaurants')
                .select('slug')
                .eq('id', restRes.data.linked_restaurant_id)
                .single()
            if (partnerRest?.slug) {
                restaurantSlug = partnerRest.slug
            }
        }

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
        console.error("Failed to load rooms data from DB", e)
    }

    return (
        <RoomsClient 
            initialRooms={rooms} 
            roomTypes={roomTypes} 
            restaurantId={restaurantId} 
            restaurantSlug={restaurantSlug}
            restaurantName={restaurantName}
            tables={tablesMapped}
            activeOrders={activeOrders}
        />
    )
}
