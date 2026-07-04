import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TableManager, { type TableWithSession } from '@/components/waiter/TableManager'
import ServiceRequestFeed, { type ServiceRequestWithTable } from '@/components/waiter/ServiceRequestFeed'
import PaymentVerificationFeed, { type PaymentClaim } from '@/components/waiter/PaymentVerificationFeed'
import WaiterOrderFeed, { type WaiterOrder } from '@/components/waiter/WaiterOrderFeed'
import OrderConfirmFeed, { type ConfirmOrder } from '@/components/waiter/OrderConfirmFeed'
import WaiterTakeoutFeed from '@/components/waiter/WaiterTakeoutFeed'
import WaiterDeliveryFeed from '@/components/waiter/WaiterDeliveryFeed'
import { getReadyDeliveries } from '@/app/api/takeout/actions'
import CashPaymentFeed, { type UnpaidOrder } from '@/components/waiter/CashPaymentFeed'
import WaiterTabs from '@/components/waiter/WaiterTabs'
import WaiterOrdersTabs from '@/components/waiter/WaiterOrdersTabs'
import { getRestaurantFeatures } from '@/lib/features'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout, type TakeoutOrderRow } from '@/lib/takeout'
import type { TakeoutOrder } from '@/types/database'
import { Users, Package, Bell, ChefHat } from 'lucide-react'

export const revalidate = 0

export default async function WaiterPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

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
            .select('id, table_id, restaurant_id, opened_by, session_token, status, opened_at, closed_at, expires_at, guest_count, max_seats, notes')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'active')
            .gt('expires_at', now),
    ])

    const activeSessionByTable = Object.fromEntries(
        (activeSessions || []).map(s => [s.table_id, s])
    )

    const mappedTables = (tables || []).map(table => ({
        ...table,
        activeSession: activeSessionByTable[table.id] || null,
    }))

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const [
        features,
        { data: serviceRequests },
        { data: paymentClaims },
        { data: activeOrders },
        { data: readyTakeouts },
        { data: unpaidDelivered },
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        adminSupabase
            .from('service_requests')
            .select('*, sessions(tables(label)), direct_table:tables(label)')
            .eq('restaurant_id', restaurantId)
            .in('status', ['pending', 'acknowledged'])
            .order('created_at', { ascending: false })
            .limit(20),
        adminSupabase
            .from('payment_verifications')
            .select('*')
            .eq('restaurant_id', restaurantId)
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
    const customerCount = ((serviceRequests || []).filter(r => r.status === 'pending').length) + (unpaidDelivered?.length || 0) + (paymentClaims?.length || 0)

    const spaceContent = (
        <div className="space-y-6 pt-1">
            <TableManager
                initialTables={mappedTables as unknown as TableWithSession[]}
                restaurantId={restaurantId}
                appUrl={appUrl}
                initialOrders={(activeOrders || []).map(o => ({ id: o.id, session_id: o.session_id, status: o.status }))}
                userId={userId}
                staffNames={staffNames}
            />
        </div>
    )

    const dineInCount = (activeOrders || []).filter(o => o.status === 'ready').length + (ordersToConfirm?.length || 0)
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
            {features?.serviceRequestsEnabled !== false && (
                <ServiceRequestFeed
                    initialRequests={(serviceRequests || []) as unknown as ServiceRequestWithTable[]}
                    restaurantId={restaurantId}
                    userId={userId}
                    staffNames={staffNames}
                />
            )}
            {unpaidDelivered && unpaidDelivered.length > 0 && (
                <CashPaymentFeed
                    initialOrders={unpaidDelivered as unknown as UnpaidOrder[]}
                    restaurantId={restaurantId}
                />
            )}
            {features?.nepalPayEnabled && (
                <PaymentVerificationFeed
                    initialClaims={(paymentClaims || []) as unknown as PaymentClaim[]}
                    restaurantId={restaurantId}
                    userId={userId}
                />
            )}
        </div>
    )

    return (
        <div className="flex flex-col min-h-[calc(100vh-4rem)] md:min-h-[calc(100vh-5rem)]">
            <div className="flex-1 px-3 md:px-6 pb-3 md:pb-6">
                <WaiterTabs
                    spaceContent={spaceContent}
                    ordersContent={ordersContent}
                    customerContent={customerContent}
                    counts={{
                        space: spaceCount,
                        orders: ordersCount,
                        customer: customerCount,
                    }}
                />
            </div>
        </div>
    )
}
