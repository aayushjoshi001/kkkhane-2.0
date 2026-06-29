import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import TakeoutOrderTracker from '@/components/customer/TakeoutOrderTracker'
import { TAKEOUT_ORDER_SELECT, mapOrderRowToTakeout, type TakeoutOrderRow } from '@/lib/takeout'

export const revalidate = 0

export default async function TakeoutOrderPage({
    params,
}: {
    params: Promise<{ restaurantSlug: string; orderId: string }>
}) {
    const { restaurantSlug, orderId } = await params
    const supabase = await createAdminClient()

    const { data: orderRow } = await supabase
        .from('orders')
        .select(TAKEOUT_ORDER_SELECT)
        .eq('id', orderId)
        .in('order_type', ['takeout', 'delivery'])
        .single()

    if (!orderRow) return notFound()
    const order = mapOrderRowToTakeout(orderRow as unknown as TakeoutOrderRow)

    // Fetch restaurant name for display
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name, slug')
        .eq('id', order.restaurant_id)
        .single()

    return (
        <div className="min-h-screen bg-gray-50 pb-12">
            <header className="bg-white px-4 py-4 shadow-sm sticky top-0 z-20">
                <h1 className="text-xl font-semibold text-gray-900 text-center">
                    Track Takeout Order
                </h1>
                {restaurant && (
                    <p className="text-xs text-gray-500 text-center mt-0.5">{restaurant.name}</p>
                )}
            </header>

            <main className="max-w-xl mx-auto px-4 mt-6">
                <TakeoutOrderTracker
                    orderId={orderId}
                    initialOrder={order}
                    restaurantSlug={restaurantSlug}
                />
            </main>
        </div>
    )
}
