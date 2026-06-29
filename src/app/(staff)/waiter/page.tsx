import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TableManager, { type TableWithSession } from '@/components/waiter/TableManager'
import ServiceRequestFeed, { type ServiceRequestWithTable } from '@/components/waiter/ServiceRequestFeed'
import StaffShiftClock from '@/components/shared/StaffShiftClock'
import PaymentVerificationFeed, { type PaymentClaim } from '@/components/waiter/PaymentVerificationFeed'
import WaiterOrderFeed, { type WaiterOrder } from '@/components/waiter/WaiterOrderFeed'
import OrderConfirmFeed, { type ConfirmOrder } from '@/components/waiter/OrderConfirmFeed'
import WaiterTakeoutFeed from '@/components/waiter/WaiterTakeoutFeed'
import FloorStats from '@/components/waiter/FloorStats'
import CashPaymentFeed, { type UnpaidOrder } from '@/components/waiter/CashPaymentFeed'
import ActiveSessionsList from '@/components/waiter/ActiveSessionsList'
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
        { data: activeShift },
        { data: shiftHistory },
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
            .from('staff_shifts')
            .select('*')
            .eq('user_id', userId)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle(),
        adminSupabase
            .from('staff_shifts')
            .select('*')
            .eq('user_id', userId)
            .not('clock_out', 'is', null)
            .order('clock_in', { ascending: false })
            .limit(5),
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

    // Floor stats for the top bar
    const occupiedTables = mappedTables.filter(t => t.activeSession).length
    const totalTables = mappedTables.length
    const readyOrders = (activeOrders || []).filter(o => o.status === 'ready').length
    const kitchenOrders = (activeOrders || []).filter(o => o.status === 'preparing' || o.status === 'confirmed' || o.status === 'pending').length
    const pendingRequests = (serviceRequests || []).filter(r => r.status === 'pending').length

    // Active sessions list data
    const tablesMap: Record<string, string> = Object.fromEntries(mappedTables.map(t => [t.id, t.label]))
    const activeSessionEntries = mappedTables
        .filter(t => t.activeSession)
        .map(t => {
            const session = t.activeSession!
            const sessionOrders = (activeOrders || []).filter(
                o => o.session_id === session.id && !['delivered', 'cancelled'].includes(o.status)
            )
            return {
                tableId: t.id,
                tableLabel: t.label,
                sessionId: session.id,
                openedAt: session.opened_at ?? now,
                orderCount: sessionOrders.length,
                totalAmount: sessionOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0),
            }
        })
        .sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, undefined, { numeric: true }))

    return (
        <div className="space-y-6 md:space-y-7">

            {/* Floor Stats — always-visible at-a-glance bar */}
            <FloorStats
                occupiedTables={occupiedTables}
                totalTables={totalTables}
                readyOrders={readyOrders}
                kitchenOrders={kitchenOrders}
                pendingRequests={pendingRequests}
                restaurantId={restaurantId}
            />

            {/* Active sessions list — quick overview of occupied tables */}
            <ActiveSessionsList
                initialEntries={activeSessionEntries}
                tablesMap={tablesMap}
                restaurantId={restaurantId}
            />

            {/* 0. Orders to Confirm — Mode 2 gate, must clear before the kitchen cooks */}
            {features?.waiterOrderConfirmation && (
                <OrderConfirmFeed
                    initialOrders={(ordersToConfirm || []) as unknown as ConfirmOrder[]}
                    restaurantId={restaurantId}
                    userId={userId}
                    staffNames={staffNames}
                />
            )}

            {/* 1. Service Requests — most urgent, someone needs help NOW */}
            {features?.serviceRequestsEnabled !== false && (
                <ServiceRequestFeed
                    initialRequests={(serviceRequests || []) as unknown as ServiceRequestWithTable[]}
                    restaurantId={restaurantId}
                    userId={userId}
                    staffNames={staffNames}
                />
            )}

            {/* 2. Active Order Feed — ready orders need immediate delivery */}
            <WaiterOrderFeed
                initialOrders={(activeOrders || []) as unknown as WaiterOrder[]}
                restaurantId={restaurantId}
                userId={userId}
                staffNames={staffNames}
            />

            {/* 3. Cash Payment Quick-Actions — delivered orders awaiting cash collection */}
            {unpaidDelivered && unpaidDelivered.length > 0 && (
                <CashPaymentFeed
                    initialOrders={unpaidDelivered as unknown as UnpaidOrder[]}
                    restaurantId={restaurantId}
                />
            )}

            {/* 4. Nepal Payment Verification */}
            {features?.nepalPayEnabled && (
                <PaymentVerificationFeed
                    initialClaims={(paymentClaims || []) as unknown as PaymentClaim[]}
                    restaurantId={restaurantId}
                    userId={userId}
                />
            )}

            {/* 5. Takeout Pickup Feed */}
            {features?.takeoutEnabled && (
                <WaiterTakeoutFeed
                    initialOrders={((readyTakeouts || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout)}
                    restaurantId={restaurantId}
                />
            )}

            {/* 6. Table Manager — manage floor, open/close sessions */}
            <TableManager
                initialTables={mappedTables as unknown as TableWithSession[]}
                restaurantId={restaurantId}
                appUrl={appUrl}
                initialOrders={(activeOrders || []).map(o => ({ id: o.id, session_id: o.session_id, status: o.status }))}
                userId={userId}
                staffNames={staffNames}
            />

            {/* 7. Shift Clock — used at start/end of shift only */}
            {features?.staffShiftsEnabled && (
                <StaffShiftClock
                    userId={userId}
                    restaurantId={restaurantId}
                    initialShift={activeShift || null}
                    initialHistory={shiftHistory || []}
                />
            )}

        </div>
    )
}
