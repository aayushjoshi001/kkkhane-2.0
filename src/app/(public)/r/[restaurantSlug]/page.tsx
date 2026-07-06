import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import RestaurantMainClient from './RestaurantMainClient'
import { getRestaurantFeatures } from '@/lib/features'

import type { Metadata } from 'next'

// ISR: this public landing page (restaurant info + table/QR list) changes rarely.
// Serve cached HTML and revalidate every 10 min as a safety net; table edits trigger
// immediate on-demand revalidation from admin/tables/actions.ts.
export const revalidate = 600
export const runtime = 'edge'

// Slugs are tenant-defined and unbounded, so we prerender none at build time and let
// each slug be generated + cached on first request (on-demand ISR). Without this,
// the dynamic segment renders per-request and `revalidate` above has no effect.
export function generateStaticParams() {
    return []
}

export async function generateMetadata(props: {
    params: Promise<{ restaurantSlug: string }>
}): Promise<Metadata> {
    const params = await props.params;
    const supabase = await createAdminClient()
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('slug', params.restaurantSlug)
        .single()

    if (restaurant) {
        return {
            title: restaurant.name,
            manifest: `/api/manifest/${restaurant.id}?start_url=${encodeURIComponent(`/r/${params.restaurantSlug}`)}`
        }
    }
    return {}
}

export default async function RestaurantMainPage(props: {
    params: Promise<{ restaurantSlug: string }>
}) {
    const params = await props.params;
    const supabase = await createAdminClient()

    // 1. Fetch Restaurant Info
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, name, logo_url, physical_menu_urls')
        .eq('slug', params.restaurantSlug)
        .single()

    if (!restaurant) return notFound()

    // 2. Fetch Active Tables
    const { data: tables } = await supabase
        .from('tables')
        .select('id, label, qr_token')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .order('label', { ascending: true })

    const features = await getRestaurantFeatures(restaurant.id)

    return (
        <RestaurantMainClient
            restaurant={restaurant}
            tables={tables || []}
            restaurantSlug={params.restaurantSlug}
            dineInEnabled={features?.dineInEnabled ?? true}
        />
    )
}
