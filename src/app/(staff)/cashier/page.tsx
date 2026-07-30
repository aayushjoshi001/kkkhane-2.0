import RealtimeCatchUp from '@/components/shared/RealtimeCatchUp'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashierClient, { type UnpaidOrder, type ActiveOrder } from '@/components/waiter/CashierClient'
import { getRestaurantMode } from '@/lib/features'
import { resolveActiveDayBookSession } from '@/lib/ledger'

export const revalidate = 0

export default async function CashierPage() {
    const { id: userId, restaurantId, role } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const adminSupabase = await createAdminClient()

    const ORDER_SELECT = `
        id, total_amount, placed_at, delivered_at, payment_status, payment_method, session_id, booking_id, order_type, customer_name, customer_phone, delivery_address,
        sessions ( id, booking_id, seat_number, tables ( id, label, room_id ), bookings:booking_id ( id, rooms ( id, room_number ) ) ),
        bookings ( id, rooms ( id, room_number ) ),
        order_items ( id, quantity, status, unit_price, special_request, needs_confirmation, menu_items ( name ), menu_item_variations:menu_item_variation_id ( id, name ) )
    `

    const [
        { data: deliveredUnpaidOrders },
        { data: takeoutUnpaidOrders },
        { data: activeOrders },
        { data: tables },
        { data: activeSessions },
        restaurantData,
        { data: rooms },
        mode,
        { data: bookings },
        { data: bankAccounts },
        { data: suppliers },
        { data: staff },
        { data: expenseCategories },
        { data: ingredients },
        { data: customerAccounts },
        openSession,
        { data: currentUserRow },
    ] = await Promise.all([
        // (1) Delivered but not yet paid — all order types (dine-in, room service, etc.)
        adminSupabase
            .from('orders')
            .select(ORDER_SELECT)
            .eq('restaurant_id', restaurantId)
            .eq('status', 'delivered')
            .eq('payment_status', 'unpaid')
            .order('delivered_at', { ascending: true })
            .limit(50),

        // (2) Unpaid takeout/delivery orders at any kitchen status — so manual
        //     cashier takeaway/delivery bills appear in billing immediately after
        //     creation without waiting for the kitchen to mark them delivered.
        adminSupabase
            .from('orders')
            .select(ORDER_SELECT)
            .eq('restaurant_id', restaurantId)
            .in('order_type', ['takeout', 'delivery'])
            .in('status', ['confirmed', 'preparing', 'ready', 'delivered'])
            .eq('payment_status', 'unpaid')
            .order('placed_at', { ascending: true })
            .limit(50),

        adminSupabase
            .from('orders')
            .select(`
                id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address, payment_status, booking_id,
                sessions ( id, booking_id, seat_number, tables ( id, label, room_id ), bookings:booking_id ( id, rooms ( id, room_number ) ) ),
                bookings ( id, rooms ( id, room_number ) ),
                order_items ( id, quantity, status, unit_price, special_request, needs_confirmation, menu_items ( name ), menu_item_variations:menu_item_variation_id ( id, name ) )
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
            .is('booking_id', null)
            .order('seat_number', { ascending: true }),

        // Restaurant slug (manual takeaway/delivery redirect) + name (print tickets)
        adminSupabase
            .from('restaurants')
            .select('slug, name, address, contact_phone')
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
            .eq('status', 'checked_in'),

        // ── Manual Entry seed data (rendered inline in the dashboard) ──────────
        adminSupabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('suppliers')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('users')
            .select('id, full_name')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('full_name', { ascending: true }),
        adminSupabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('ingredients')
            .select('id, name, unit, stock_quantity')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        adminSupabase
            .from('customer_credit_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('customer_name', { ascending: true }),
        resolveActiveDayBookSession(adminSupabase, restaurantId, userId),

        // Printed on every bill this till issues, so two cashiers sharing a
        // counter produce receipts you can tell apart.
        adminSupabase
            .from('users')
            .select('full_name')
            .eq('id', userId)
            .maybeSingle(),
    ])

    // Merge delivered unpaid + takeout/delivery unpaid, deduplicating by order id
    const unpaidMap = new Map<string, any>()
    for (const o of [...(deliveredUnpaidOrders || []), ...(takeoutUnpaidOrders || [])]) {
        unpaidMap.set(o.id, o)
    }
    const unpaidOrders = [...unpaidMap.values()].sort(
        (a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime()
    )

    // A split table carries one active session per seat — keep them all, not just
    // one, so the cashier can bill each seat (Table 4-1, 4-2, ...) independently.
    // Seat 1 stays `activeSession` (what all single-session code paths expect);
    // seats 2+ surface as `otherActiveSessions`, mirroring the waiter page.
    const sessionsByTable: Record<string, NonNullable<typeof activeSessions>> = {}
    for (const s of activeSessions || []) {
        (sessionsByTable[s.table_id] ??= []).push(s)
    }

    // Auto-cleanup any tables marked 'occupied' or 'active' in DB that have no active non-room sessions
    const activeTableIds = new Set((activeSessions || []).map(s => s.table_id))
    const stuckTableIds = (tables || [])
        .filter(t => (t.table_status === 'occupied' || t.table_status === 'active') && !activeTableIds.has(t.id))
        .map(t => t.id)

    if (stuckTableIds.length > 0) {
        await adminSupabase
            .from('tables')
            .update({ table_status: 'available' })
            .in('id', stuckTableIds)
    }

    const mappedTables = tables?.map(t => {
        const tableSessions = sessionsByTable[t.id] || []
        const primary = tableSessions.find(s => s.seat_number === 1) || tableSessions[0] || null
        const isStuck = stuckTableIds.includes(t.id)
        return {
            ...t,
            table_status: isStuck ? 'available' : t.table_status,
            activeSession: primary,
            otherActiveSessions: tableSessions.filter(s => s.id !== primary?.id),
        }
    }) || []

    const restaurantSlug = restaurantData?.data?.slug || ''
    const restaurantName = restaurantData?.data?.name || 'ROYAL REST HOUSE'
    const restaurantAddress = restaurantData?.data?.address || 'Pulchowk, Chitwan'
    const restaurantPhone = restaurantData?.data?.contact_phone || ''
    const isHotel = mode === 'hotel'

    return (
        <>
        <RealtimeCatchUp restaurantId={restaurantId} />
        <CashierClient
            restaurantId={restaurantId}
            restaurantSlug={restaurantSlug}
            restaurantName={restaurantName}
            restaurantAddress={restaurantAddress}
            restaurantPhone={restaurantPhone}
            userId={userId}
            userName={currentUserRow?.full_name || ''}
            initialUnpaid={(unpaidOrders || []) as unknown as UnpaidOrder[]}
            initialActive={(activeOrders || []) as unknown as ActiveOrder[]}
            tables={mappedTables as any}
            rooms={rooms || []}
            isHotel={isHotel}
            initialBookings={(bookings || [])}
            userRole={role}
            manualEntryBankAccounts={bankAccounts || []}
            manualEntrySuppliers={suppliers || []}
            manualEntryStaffList={staff || []}
            manualEntryExpenseCategories={expenseCategories || []}
            manualEntryIngredients={ingredients || []}
            manualEntryCustomerAccounts={customerAccounts || []}
            manualEntryHasOpenSession={!!openSession}
            manualEntrySessionId={openSession?.id ?? null}
            openSession={openSession}
        />
        </>
    )
}
