import { createAdminClient } from '@/lib/supabase/server'
import { getRestaurantFeatures } from '@/lib/features'
import { getCachedMenuData } from '@/lib/menu-cache'
import { notFound } from 'next/navigation'
import TakeoutPageClient from './TakeoutPageClient'

import type { Metadata } from 'next'

export const revalidate = 600

export function generateStaticParams() {
    return []
}

export async function generateMetadata({ params }: { params: Promise<{ restaurantSlug: string }> }): Promise<Metadata> {
    const { restaurantSlug } = await params
    const supabase = await createAdminClient()
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', restaurantSlug)
        .single()

    if (restaurant?.id) {
        return {
            manifest: `/api/manifest/${restaurant.id}?start_url=${encodeURIComponent(`/takeout/${restaurantSlug}`)}`
        }
    }
    return {}
}

export default async function TakeoutPage({ params }: { params: Promise<{ restaurantSlug: string }> }) {
    const { restaurantSlug } = await params
    const supabase = await createAdminClient()

    // Find restaurant by slug
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, name, slug, logo_url')
        .eq('slug', restaurantSlug)
        .single()

    if (!restaurant) notFound()

    // Get menu categories, items, translations, combo items and features in parallel from cache
    const [menuData, features] = await Promise.all([
        getCachedMenuData(restaurant.id),
        getRestaurantFeatures(restaurant.id),
    ])

    const { categories, menuItems, translations, supportedLanguages, comboItems } = menuData
    const langs = supportedLanguages.length > 0
        ? [{ code: 'en', name: 'EN' }, ...supportedLanguages.filter(l => l.code !== 'en')]
        : []

    return (
        <TakeoutPageClient
            restaurant={{ ...restaurant, description: null }}
            categories={categories || []}
            menuItems={menuItems}
            comboItems={comboItems || []}
            translations={translations}
            supportedLanguages={langs}
            features={features}
        />
    )
}
