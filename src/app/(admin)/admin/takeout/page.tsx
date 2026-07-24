import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import TakeoutDashboard from './TakeoutDashboard'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout, type TakeoutOrderRow } from '@/lib/takeout'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'
import RealtimeRefresh from '@/components/shared/RealtimeRefresh'

export const revalidate = 0

export default async function AdminTakeoutPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const features = await getRestaurantFeatures(rid)
    if (!features?.takeoutEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const { data: restaurant } = await adminSupabase
        .from('restaurants')
        .select('slug, name')
        .eq('id', rid)
        .single()

    const { data: orderRows } = await adminSupabase
        .from('orders')
        .select(TAKEOUT_ORDER_SELECT)
        .eq('restaurant_id', rid)
        .in('order_type', ['takeout', 'delivery'])
        .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
        .order('placed_at', { ascending: false })
        .limit(50)

    const orders = ((orderRows || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout)

    return (
        <div className="space-y-6">
            <RealtimeRefresh restaurantId={rid} tables={['orders']} />
            <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-h2 font-extrabold text-ink">Takeout Orders</h1>
                    <p className="text-ink-subtle font-medium mt-1">Manage pending and active takeout orders</p>
                </div>
            </header>
            <TakeoutDashboard 
                initialOrders={orders} 
                restaurantId={rid} 
                restaurantSlug={restaurant?.slug || ''}
                restaurantName={restaurant?.name || ''}
            />
        </div>
    )
}
