import { requireRole } from '@/lib/auth'
import { getAllOrdersAcrossRestaurants, getAllRestaurants } from '../actions'
import OrdersClient, { type Order } from './OrdersClient'

export const dynamic = 'force-dynamic'

export default async function OrdersPage() {
    await requireRole('super_admin')

    const [ordersResult, restaurantsResult] = await Promise.all([
        getAllOrdersAcrossRestaurants(300),
        getAllRestaurants(),
    ])

    const restaurants = (restaurantsResult.data || []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }))

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="All Orders" 
                description="Platform-wide order history across all restaurant tenants." 
                icon={<Settings size={18} />}
                color="purple"
            />
            <OrdersClient orders={(ordersResult.data || []) as unknown as Order[]} restaurants={restaurants} />
        </div>
    )
}
