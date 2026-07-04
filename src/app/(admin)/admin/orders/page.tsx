import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import OrdersClient, { type AdminOrder } from './OrdersClient'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { ShoppingBag } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage() {
    const { restaurantId, role } = await getCurrentUser()
    const canRefund = role === 'manager' || role === 'super_admin'

    const adminSupabase = await createAdminClient()

    const { data: orders } = await adminSupabase
        .from('orders')
        .select(`
            id, status, payment_status, total_amount, refunded_amount, placed_at, customer_note,
            sessions ( tables ( label ) ),
            order_items ( id, quantity, menu_items ( name ) )
        `)
        .eq('restaurant_id', restaurantId)
        .order('placed_at', { ascending: false })
        .limit(100) as { data: AdminOrder[] | null }

    return (
        <div className="space-y-4 md:space-y-6">
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
