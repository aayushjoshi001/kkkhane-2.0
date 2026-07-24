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
    const { data: orders } = await adminSupabase
        .from('orders')
        .select(`
            id, status, payment_status, total_amount, refunded_amount, placed_at, customer_note,
            subtotal_amount, service_charge_amount, tax_amount, tip_amount, discount_amount,
            payment_method, confirmed_at, ready_at, delivered_at, paid_at, cancellation_reason,
            order_type, customer_name, customer_phone, delivery_address,
            sessions ( seat_number, tables ( label ) ),
            bookings ( guest_name, rooms ( room_number ) ),
            order_items (
                id, quantity, unit_price, special_request, status,
                menu_items ( name ),
                menu_item_variations:menu_item_variation_id ( name ),
                order_item_modifiers ( modifier_name, price_adjustment )
            )
        `)
        .eq('restaurant_id', restaurantId)
        .order('placed_at', { ascending: false })
        .limit(100) as { data: AdminOrder[] | null }

    return (
        <div className="space-y-4 md:space-y-6">
            <RealtimeRefresh restaurantId={restaurantId} tables={['orders']} />
            <PremiumPageHeader 
                title="Order History" 
                description="View and manage all orders. Managers can void or refund orders." 
                icon={<ShoppingBag size={18} />}
                color="blue"
            />

            <OrdersClient orders={orders || []} canRefund={canRefund} />
        </div>
    )
}
