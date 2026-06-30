import { createAdminClient } from '@/lib/supabase/server'
import { getRestaurantFeatures } from '@/lib/features'
import { notFound } from 'next/navigation'
import TakeoutPageClient from './TakeoutPageClient'

import type { Metadata } from 'next'

export const revalidate = 0

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

    // Get menu categories, items, translations, and currency features in parallel
    const [{ data: categories }, { data: items }, { data: rawTranslations }, { data: rawLangs }, features] = await Promise.all([
        supabase
            .from('menu_categories')
            .select('id, name, sort_order')
            .eq('restaurant_id', restaurant.id)
            .eq('is_visible', true)
            .order('sort_order'),
        supabase
            .from('menu_items')
            .select('id, name, description, price, image_url, category_id, is_available')
            .eq('restaurant_id', restaurant.id)
            .eq('is_available', true)
            .order('name'),
        supabase
            .from('translations')
            .select('language_code, entity_type, entity_id, translated_text')
            .eq('restaurant_id', restaurant.id),
        supabase
            .from('supported_languages')
            .select('language_code, language_name')
            .eq('restaurant_id', restaurant.id)
            .eq('is_active', true)
            .order('sort_order'),
        getRestaurantFeatures(restaurant.id),
    ])

    const translations = (rawTranslations || []) as { language_code: string; entity_type: string; entity_id: string; translated_text: string }[]
    const supportedLanguages = (rawLangs || []).map(l => ({ code: l.language_code, name: l.language_name }))
    const langs = supportedLanguages.length > 0
        ? [{ code: 'en', name: 'EN' }, ...supportedLanguages.filter(l => l.code !== 'en')]
        : []

    return (
        <TakeoutPageClient
            restaurant={{ ...restaurant, description: null }}
            categories={categories || []}
            menuItems={items || []}
            translations={translations}
            supportedLanguages={langs}
            features={features}
        />
    )
}
