import { createAdminClient } from '@/lib/supabase/server'
import type { MenuItem } from '@/types/database'
import { fetchWithCache } from '@/lib/redis'

async function fetchMenuDataFromDb(restaurantId: string) {
        const supabase = await createAdminClient()

        const [
            categoriesRes,
            menuItemsRes,
            translationsRes,
            langsRes,
            comboItemsRes,
            pairingsRes
        ] = await Promise.allSettled([
            supabase
                .from('menu_categories')
                .select('*')
                .eq('restaurant_id', restaurantId)
                .eq('is_visible', true)
                .order('sort_order', { ascending: true }),

            supabase
                .from('menu_items')
                .select('*, menu_item_modifier_groups(*, menu_item_modifiers(*)), variations:menu_item_variations(*)')
                .eq('restaurant_id', restaurantId)
                .eq('is_available', true),

            supabase
                .from('translations')
                .select('language_code, entity_type, entity_id, translated_text')
                .eq('restaurant_id', restaurantId),

            supabase
                .from('supported_languages')
                .select('language_code, language_name')
                .eq('restaurant_id', restaurantId)
                .eq('is_active', true)
                .order('sort_order'),

            supabase
                .from('combo_items')
                .select('id, combo_id, item_id, quantity, combo:menu_items!combo_id!inner(restaurant_id)')
                .eq('combo.restaurant_id', restaurantId),

            supabase
                .from('menu_item_pairings')
                .select('item_id, paired_item_id, co_order_count')
                .eq('restaurant_id', restaurantId)
                .order('co_order_count', { ascending: false })
        ])

        const categories = categoriesRes.status === 'fulfilled' ? categoriesRes.value.data || [] : []
        const rawMenuItems = menuItemsRes.status === 'fulfilled' ? menuItemsRes.value.data || [] : []
        const rawTranslations = translationsRes.status === 'fulfilled' ? translationsRes.value.data || [] : []
        const rawLangs = langsRes.status === 'fulfilled' ? langsRes.value.data || [] : []
        const rawComboItems = comboItemsRes.status === 'fulfilled' ? comboItemsRes.value.data || [] : []
        const rawPairings = pairingsRes.status === 'fulfilled' ? pairingsRes.value.data || [] : []

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const menuItems = (rawMenuItems || []).map((item: Record<string, any>) => ({
            ...item,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            modifier_groups: (item.menu_item_modifier_groups || []).map((g: Record<string, any>) => ({
                ...g,
                modifiers: g.menu_item_modifiers || [],
            })),
        })) as MenuItem[]

        const translations = (rawTranslations || []) as { language_code: string; entity_type: string; entity_id: string; translated_text: string }[]
        const supportedLanguages = (rawLangs || []).map(l => ({ code: l.language_code, name: l.language_name }))
        const comboItems = rawComboItems

        // itemId -> ranked list of paired item ids, for the "pairs well with" UI.
        const pairings: Record<string, string[]> = {}
        for (const row of rawPairings || []) {
            if (!pairings[row.item_id]) pairings[row.item_id] = []
            pairings[row.item_id].push(row.paired_item_id)
        }

        return {
            categories,
            menuItems,
            translations,
            supportedLanguages,
            comboItems,
            pairings
        }
}

import { unstable_cache } from 'next/cache'

export async function getCachedMenuData(restaurantId: string) {
    const fetcher = unstable_cache(
        async () => {
            return fetchWithCache(
                `menu-data:${restaurantId}`,
                () => fetchMenuDataFromDb(restaurantId),
                86400 // 1 day in Redis
            )
        },
        [`menu-data-${restaurantId}`],
        { tags: [`menu-data-${restaurantId}`], revalidate: 3600 } // 1 hour Next.js cache
    )
    return fetcher()
}
