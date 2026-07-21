import { createAdminClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import PaymentPageClient from '@/components/customer/PaymentPageClient'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { use } from 'react'

export const revalidate = 0 // Don't cache this page - fetch fresh DB state

export default async function PaymentPage(props: {
    params: Promise<{ tableSlug: string; orderId: string }>
}) {
    const params = await props.params
    const adminSupabase = await createAdminClient()

    // Fetch the order with item details
    const { data: order } = await adminSupabase
        .from('orders')
        .select(`
            *,
            invoice_number,
            order_items (
                *,
                menu_items (name),
                menu_item_variations:menu_item_variation_id (id, name),
                order_item_modifiers (*)
            )
        `)
        .eq('id', params.orderId)
        .single()

    if (!order) {
        return notFound()
    }

    // Fetch restaurant info, features, and business mode in parallel
    const [restaurantResult, features, businessMode] = await Promise.all([
        order.restaurant_id
            ? adminSupabase
                .from('restaurants')
                .select('pan_number, vat_registered, name, payment_qr_url, payment_qr_label')
                .eq('id', order.restaurant_id)
                .single()
            : Promise.resolve({ data: null }),
        order.restaurant_id
            ? getRestaurantFeatures(order.restaurant_id)
            : Promise.resolve(null),
        order.restaurant_id
            ? getRestaurantMode(order.restaurant_id)
            : Promise.resolve('dine_in' as const),
    ])

    // Hotels settle bills via the room folio (or in person at checkout), never
    // through this self-service payment form — a direct link (old bookmark,
    // browser back-button) must not reach it even though the UI no longer
    // links here for a hotel-mode order.
    if (order.booking_id || businessMode === 'hotel') {
        redirect(`/t/${params.tableSlug}/order/${params.orderId}`)
    }

    const restaurantInfo = restaurantResult?.data

    return (
        <PaymentPageClient
            order={order}
            restaurantInfo={restaurantInfo}
            features={features}
            tableSlug={params.tableSlug}
        />
    )
}
