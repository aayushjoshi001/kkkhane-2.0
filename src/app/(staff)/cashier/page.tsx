import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashierClient, { type UnpaidOrder, type ActiveOrder } from '@/components/waiter/CashierClient'
import { type PaymentClaim } from '@/components/waiter/PaymentVerificationFeed'
import { getRestaurantMode } from '@/lib/features'

export const revalidate = 0

export default async function CashierPage() {
    const { id: userId, restaurantId } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const adminSupabase = await createAdminClient()

    const [
        { data: unpaidOrders },
        { data: activeOrders },
        { data: tables },
        { data: activeSessions },
        { data: paymentClaims },
        restaurantData,
        { data: rooms },
        mode,
        { data: bookings },
    ] = await Promise.all([
        // Delivered but not yet paid — ready for cashier
        adminSupabase
            .from('orders')
            .select(`
                id, total_amount, delivered_at, payment_status, payment_method, session_id, booking_id,
                sessions ( id, booking_id, seat_number, tables ( id, label ) ),
                order_items ( quantity, unit_price, menu_items ( name ) )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('status', 'delivered')
            .eq('payment_status', 'unpaid')
            .order('delivered_at', { ascending: true })
            .limit(50),

        adminSupabase
            .from('orders')
            .select(`
                id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address, payment_status, booking_id,
                sessions ( id, booking_id, seat_number, tables ( label ) ),
                order_items ( id, quantity, status, unit_price, menu_items ( name ) )
            `)
            .eq('restaurant_id', restaurantId)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),

        // All active tables
        adminSupabase
            .from('tables')
            .select('id, label, capacity, table_status, cleaning_claimed_by, cleaning_claimed_at, qr_token, room_id')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('label', { ascending: true }),

        // All active sessions
        adminSupabase
            .from('sessions')
            .select('id, table_id, restaurant_id, status, opened_at, session_token, booking_id, seat_number')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'active')
            .order('seat_number', { ascending: true }),

        // Online payment claims (UPI/card) awaiting staff verification
        adminSupabase
            .from('payment_verifications')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(20),

        // Restaurant slug for manual takeaway/delivery redirect
        adminSupabase
            .from('restaurants')
            .select('slug')
            .eq('id', restaurantId)
            .single(),

        // All active rooms
        adminSupabase
            .from('rooms')
            .select('*, room_types:type_id(*)')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('room_number', { ascending: true }),

        // Get restaurant mode
        getRestaurantMode(restaurantId),

        // All active checked-in bookings
        adminSupabase
            .from('bookings')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'checked_in')
    ])

    // A split table carries one active session per seat — keep them all, not just
    // one, so the cashier can bill each seat (Table 4-1, 4-2, ...) independently.
    // Seat 1 stays `activeSession` (what all single-session code paths expect);
    // seats 2+ surface as `otherActiveSessions`, mirroring the waiter page.
    const sessionsByTable: Record<string, NonNullable<typeof activeSessions>> = {}
    for (const s of activeSessions || []) {
        (sessionsByTable[s.table_id] ??= []).push(s)
    }
    const mappedTables = tables?.map(t => {
        const tableSessions = sessionsByTable[t.id] || []
        const primary = tableSessions.find(s => s.seat_number === 1) || tableSessions[0] || null
        return {
            ...t,
            activeSession: primary,
            otherActiveSessions: tableSessions.filter(s => s.id !== primary?.id),
        }
    }) || []

    const restaurantSlug = restaurantData?.data?.slug || ''
    const isHotel = mode === 'hotel'

    return (
        <CashierClient
            restaurantId={restaurantId}
            restaurantSlug={restaurantSlug}
            userId={userId}
            initialUnpaid={(unpaidOrders || []) as unknown as UnpaidOrder[]}
            initialActive={(activeOrders || []) as unknown as ActiveOrder[]}
            initialClaims={(paymentClaims || []) as unknown as PaymentClaim[]}
            tables={mappedTables as any}
            rooms={rooms || []}
            isHotel={isHotel}
            initialBookings={(bookings || [])}
        />
    )
}
