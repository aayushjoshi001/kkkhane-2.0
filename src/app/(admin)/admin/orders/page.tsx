import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import OrdersClient, { type AdminOrder } from './OrdersClient'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { ShoppingBag } from 'lucide-react'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage() {
    const { restaurantId, role } = await getCurrentUser()
    const canRefund = role === 'manager' || role === 'super_admin'

    const adminSupabase = await createAdminClient()

    // Selects the whole order, not just what the row renders: the detail dialog
    // opens from this data, so drilling into an order costs no extra round trip.
    let { data: orders, error } = await adminSupabase
        .from('orders')
        .select(`
            id, status, payment_status, total_amount, refunded_amount, placed_at, customer_note,
            subtotal_amount, service_charge_amount, tax_amount, tip_amount, discount_amount,
            payment_method, confirmed_at, ready_at, delivered_at, paid_at, cancellation_reason,
            cancellation_kind, cancellation_reason_code, refund_reason, refund_reason_code,
            order_type, customer_name, customer_phone, delivery_address, cashier_id, booking_id,
            sessions ( seat_number, opened_by, tables ( label ), bookings:booking_id ( guest_name, rooms ( room_number ) ) ),
            order_items (
                id, quantity, unit_price, special_request, status,
                menu_items ( name ),
                menu_item_variations:menu_item_variation_id ( name )
            )
        `)
        .eq('restaurant_id', restaurantId)
        .order('placed_at', { ascending: false })
        .limit(100) as { data: AdminOrder[] | null; error: any }

    if (error) {
        console.error('[AdminOrdersPage] Primary query error:', error.message || error.details || error)
        const { data: fallbackOrders } = await adminSupabase
            .from('orders')
            .select(`
                id, status, payment_status, total_amount, refunded_amount, placed_at, customer_note,
                subtotal_amount, service_charge_amount, tax_amount, tip_amount, discount_amount,
                payment_method, confirmed_at, ready_at, delivered_at, paid_at, cancellation_reason,
            cancellation_kind, cancellation_reason_code, refund_reason, refund_reason_code,
                order_type, customer_name, customer_phone, delivery_address, cashier_id, booking_id,
                sessions ( seat_number, opened_by, tables ( label ) ),
                order_items (
                    id, quantity, unit_price, special_request, status,
                    menu_items ( name )
                )
            `)
            .eq('restaurant_id', restaurantId)
            .order('placed_at', { ascending: false })
            .limit(100) as { data: AdminOrder[] | null }
        orders = fallbackOrders
    }

    // Resolve staff names for who opened the session / placed the order
    const staffIds = new Set<string>()
    for (const o of orders || []) {
        if (o.sessions?.opened_by) staffIds.add(o.sessions.opened_by)
        if (o.cashier_id) staffIds.add(o.cashier_id)
    }
    const staffNameMap = new Map<string, string>()
    if (staffIds.size > 0) {
        const { data: staffUsers } = await adminSupabase
            .from('users')
            .select('id, full_name')
            .in('id', Array.from(staffIds))
        for (const u of staffUsers || []) {
            if (u.id && u.full_name) staffNameMap.set(u.id, u.full_name)
        }
    }

    // How each order was actually settled — checkout draws cash first then QR
    // (see /api/orders/checkout and /api/tables/checkout), writing one
    // payment_verifications row per order for whichever pool covered it in
    // full; a paid order with no row here was settled on customer credit.
    const orderIds = (orders || []).map(o => o.id)
    const verificationMap = new Map<string, { payment_method: string; amount: number; staff_verified_at: string | null }>()
    if (orderIds.length > 0) {
        const { data: verifications } = await adminSupabase
            .from('payment_verifications')
            .select('order_id, amount, payment_method, staff_verified_at')
            .in('order_id', orderIds)
            .eq('staff_verified', true)
        for (const v of verifications || []) {
            if (v.order_id) verificationMap.set(v.order_id, { payment_method: v.payment_method, amount: v.amount, staff_verified_at: v.staff_verified_at })
        }
    }

    const ordersWithStaffNames = (orders || []).map(o => ({
        ...o,
        staff_name: (o.sessions?.opened_by ? staffNameMap.get(o.sessions.opened_by) : null) || (o.cashier_id ? staffNameMap.get(o.cashier_id) : null) || null,
        cashier_name: (o.cashier_id ? staffNameMap.get(o.cashier_id) : null) || null,
        payment_verification: verificationMap.get(o.id) || null,
    }))

    return (
        <div className="space-y-4 md:space-y-6">
            <RealtimeRefresh restaurantId={restaurantId} tables={['orders']} />
            <PremiumPageHeader 
                title="Order History" 
                description="View and manage all orders. Managers can void or refund orders." 
                icon={<ShoppingBag size={18} />}
                color="blue"
            />

            <OrdersClient orders={ordersWithStaffNames} canRefund={canRefund} />
        </div>
    )
}
