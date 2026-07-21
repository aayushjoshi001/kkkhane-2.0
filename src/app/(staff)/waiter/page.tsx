import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TableManager, { type TableWithSession } from '@/components/waiter/TableManager'
import WaiterRoomManager from '@/components/waiter/WaiterRoomManager'
import WaiterCustomerTabs, { type ServiceRequestWithTable } from '@/components/waiter/WaiterCustomerTabs'
import PaymentVerificationFeed, { type PaymentClaim } from '@/components/waiter/PaymentVerificationFeed'
import WaiterOrderFeed, { type WaiterOrder } from '@/components/waiter/WaiterOrderFeed'
import OrderConfirmFeed, { type ConfirmOrder } from '@/components/waiter/OrderConfirmFeed'
import WaiterTakeoutFeed from '@/components/waiter/WaiterTakeoutFeed'
import WaiterDeliveryFeed from '@/components/waiter/WaiterDeliveryFeed'
import { getReadyDeliveries } from '@/app/api/takeout/actions'
import CashPaymentFeed, { type UnpaidOrder } from '@/components/waiter/CashPaymentFeed'
import WaiterTabs from '@/components/waiter/WaiterTabs'
import WaiterOrdersTabs from '@/components/waiter/WaiterOrdersTabs'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout, type TakeoutOrderRow } from '@/lib/takeout'
import type { TakeoutOrder } from '@/types/database'
import { Users, Package, Bell, ChefHat } from 'lucide-react'

export const revalidate = 0

export default async function WaiterPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    // Self-healing database cleanup: purge any sessions/orders/requests for inactive tables
    const { data: inactiveTables } = await adminSupabase
        .from('tables')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', false)
        
    const inactiveTableIds = inactiveTables?.map(t => t.id) || []
    if (inactiveTableIds.length > 0) {
        // Delete direct service requests
        await adminSupabase.from('service_requests').delete().in('table_id', inactiveTableIds)
        
        // Get sessions for these tables
        const { data: inactiveSessions } = await adminSupabase
            .from('sessions')
            .select('id')
            .in('table_id', inactiveTableIds)
            
        const inactiveSessionIds = inactiveSessions?.map(s => s.id) || []
        if (inactiveSessionIds.length > 0) {
            // Get orders
            const { data: inactiveOrders } = await adminSupabase
                .from('orders')
                .select('id')
                .in('session_id', inactiveSessionIds)
                
            const inactiveOrderIds = inactiveOrders?.map(o => o.id) || []
            if (inactiveOrderIds.length > 0) {
                await adminSupabase.from('order_items').delete().in('order_id', inactiveOrderIds)
                await adminSupabase.from('payment_verifications').delete().in('order_id', inactiveOrderIds)
                await adminSupabase.from('orders').delete().in('id', inactiveOrderIds)
            }
            await adminSupabase.from('service_requests').delete().in('session_id', inactiveSessionIds)
            await adminSupabase.from('sessions').delete().in('id', inactiveSessionIds)
        }
    }

    const now = new Date().toISOString()

    // Fetch tables and active sessions separately — more reliable than a nested join
    const [{ data: tables }, { data: activeSessions }] = await Promise.all([
        adminSupabase
            .from('tables')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('label', { ascending: true }),
        adminSupabase
            .from('sessions')
            .select('id, table_id, restaurant_id, opened_by, session_token, status, opened_at, closed_at, expires_at, guest_count, max_seats, seat_number, notes')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'active')
            .order('seat_number', { ascending: true }),
    ])

    // A table can now carry more than one concurrent session — one per "seat" —
    // when a waiter splits it for a shared table where each party pays separately.
    // Seat 1 stays the table's primary session (what QR self-ordering targets and
    // what every pre-existing call site that expects a single `activeSession`
    // continues to see); seats 2+ surface as `otherActiveSessions`.
    const sessionsByTable: Record<string, typeof activeSessions extends (infer T)[] | null ? T[] : never> = {}
    for (const s of activeSessions || []) {
        (sessionsByTable[s.table_id] ??= []).push(s)
    }

    const mappedTables = (tables || []).map(table => {
        const sessions = sessionsByTable[table.id] || []
        const primary = sessions.find(s => s.seat_number === 1) || sessions[0] || null
        const others = sessions.filter(s => s.id !== primary?.id)
        return {
            ...table,
            activeSession: primary,
            otherActiveSessions: others,
        }
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const [
        features,
        businessMode,
        { data: serviceRequests },
        { data: paymentClaims },
        { data: activeOrders },
        { data: readyTakeouts },
        { data: unpaidDelivered },
        { data: rooms },
        { data: bookings },
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        getRestaurantMode(restaurantId),
        adminSupabase
            .from('service_requests')
            .select('*, sessions(tables(label)), direct_table:tables(label)')
            .eq('restaurant_id', restaurantId)
            .in('status', ['pending', 'acknowledged'])
            .order('created_at', { ascending: false })
            .limit(20),
        adminSupabase
            .from('payment_verifications')
            .select('*, orders:orders!inner(order_type)')
            .eq('restaurant_id', restaurantId)
            .eq('orders.order_type', 'dine_in')
            .order('created_at', { ascending: false })
            .limit(20),
        adminSupabase
            .from('orders')
            .select(`
                id, status, total_amount, placed_at, ready_at, customer_note, payment_status, session_id,
                claimed_by, claimed_at,
                sessions ( id, tables ( label ) ),
                order_items ( id, quantity, status, menu_items ( name ) )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('order_type', 'dine_in')
            .eq('needs_confirmation', false)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),
        adminSupabase
            .from('orders')
            .select(TAKEOUT_ORDER_SELECT)
            .eq('restaurant_id', restaurantId)
            .eq('order_type', 'takeout')
            .eq('status', 'ready')
            .order('pickup_time', { ascending: true })
            .limit(20),
        adminSupabase
            .from('orders')
            .select(`
                id, total_amount, delivered_at, session_id,
                sessions ( id, tables ( label ) )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('order_type', 'dine_in')
            .eq('status', 'delivered')
            .eq('payment_status', 'unpaid')
            .order('delivered_at', { ascending: true })
            .limit(30),
        adminSupabase
            .from('rooms')
            .select('*, room_types:type_id(*)')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('room_number', { ascending: true }),
        adminSupabase
            .from('bookings')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'checked_in'),
    ])

    // Ready online-delivery orders awaiting a delivery person.
    const readyDeliveries = await getReadyDeliveries(restaurantId)

    // Mode 2 — orders waiting for a waiter to confirm the customer is seated.
    const { data: ordersToConfirm } = await adminSupabase
        .from('orders')
        .select(`
            id, status, total_amount, placed_at, customer_note, needs_confirmation,
            sessions ( tables ( label ) ),
            order_items ( id, quantity, status, menu_items ( name ) )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('order_type', 'dine_in')
        .eq('needs_confirmation', true)
        .neq('status', 'cancelled')
        .order('placed_at', { ascending: true })
        .limit(30)

    // Map of staff id → name so feeds can show who claimed/acknowledged work
    // (realtime payloads only carry the claimer's UUID, not their name).
    const { data: staffRows } = await adminSupabase
        .from('users')
        .select('id, full_name')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
    const staffNames: Record<string, string> = Object.fromEntries(
        (staffRows || []).map(u => [u.id, u.full_name])
    )

    // Floor stats calculations removed because we removed the Stats bar.

    // Unused active session list data removed.

    // Counts for tabs
    const spaceCount = 0 // Not typically badgered
    const ordersCount = (activeOrders || []).filter(o => o.status === 'ready').length + (ordersToConfirm?.length || 0) + (readyTakeouts?.length || 0) + readyDeliveries.length
    
    const pendingRequestsCount = (serviceRequests || []).filter(r => r.status === 'pending' && r.request_type !== 'open_session').length
    const pendingClaimsCount = (paymentClaims || []).filter(c => !c.staff_verified && !c.staff_rejected).length
    const customerCount = pendingRequestsCount + (unpaidDelivered?.length || 0) + pendingClaimsCount

    const spaceContent = (
        <div className="space-y-6 pt-1">
            <TableManager
                initialTables={mappedTables as unknown as TableWithSession[]}
                restaurantId={restaurantId}
                appUrl={appUrl}
                initialOrders={(activeOrders || []).map(o => ({ id: o.id, session_id: o.session_id, status: o.status }))}
                userId={userId}
                staffNames={staffNames}
                isHotel={businessMode === 'hotel'}
                waiterSessionEnabled={features?.waiterSessionEnabled}
            />
        </div>
    )

    const roomsContent = businessMode === 'hotel' ? (
        <div className="space-y-6 pt-1">
            <WaiterRoomManager
                rooms={rooms || []}
                bookings={bookings || []}
                restaurantId={restaurantId}
                tables={mappedTables as unknown as TableWithSession[]}
            />
        </div>
    ) : undefined

    const tablesContent = spaceContent

    // ordersToConfirm (Mode 2) intentionally excluded — QR order confirmation
    // is handled exclusively in the Cashier panel's Order Confirmation card,
    // not surfaced here.
    const dineInCount = (activeOrders || []).filter(o => o.status === 'ready').length
    const takeawayCount = (readyTakeouts || []).length + readyDeliveries.length

    const ordersContent = (
        <div className="space-y-6 pt-1">
            <WaiterOrdersTabs
                dineInCount={dineInCount}
                takeawayCount={takeawayCount}
                dineInFeed={
                    <>
                        {false && (
                            <OrderConfirmFeed
                                initialOrders={(ordersToConfirm || []) as unknown as ConfirmOrder[]}
                                restaurantId={restaurantId}
                                userId={userId}
                                staffNames={staffNames}
                            />
                        )}
                        <WaiterOrderFeed
                            initialOrders={(activeOrders || []) as unknown as WaiterOrder[]}
                            restaurantId={restaurantId}
                            userId={userId}
                            staffNames={staffNames}
                        />
                    </>
                }
                takeoutFeed={
                    features?.takeoutEnabled && (
                        <WaiterTakeoutFeed
                            initialOrders={((readyTakeouts || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout)}
                            restaurantId={restaurantId}
                        />
                    )
                }
                deliveryFeed={
                    features?.takeoutEnabled && (
                        <WaiterDeliveryFeed
                            initialOrders={readyDeliveries}
                            restaurantId={restaurantId}
                            userId={userId}
                            staffNames={staffNames}
                        />
                    )
                }
            />
        </div>
    )

    const customerContent = (
        <div className="space-y-6 pt-1">
            <WaiterCustomerTabs
                initialRequests={(serviceRequests || []) as unknown as ServiceRequestWithTable[]}
                initialUnpaidOrders={(unpaidDelivered || []) as unknown as UnpaidOrder[]}
                initialClaims={(paymentClaims || []) as unknown as PaymentClaim[]}
                restaurantId={restaurantId}
                userId={userId}
                staffNames={staffNames}
                features={features}
            />
        </div>
    )

    return (
        <div className="flex flex-col min-h-[calc(100vh-4rem)] md:min-h-[calc(100vh-5rem)]">
            <div className="flex-1 px-3 md:px-6 pb-3 md:pb-6">
                <WaiterTabs
                    spaceContent={spaceContent}
                    roomsContent={roomsContent}
                    tablesContent={tablesContent}
                    ordersContent={ordersContent}
                    customerContent={customerContent}
                    isHotel={businessMode === 'hotel'}
                    counts={{
                        space: spaceCount,
                        rooms: (rooms || []).filter(r => r.status === 'occupied').length,
                        tables: mappedTables.filter(t => t.table_status === 'occupied').length,
                        orders: ordersCount,
                        customer: customerCount,
                    }}
                />
            </div>
        </div>
    )
}
