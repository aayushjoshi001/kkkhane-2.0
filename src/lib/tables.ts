import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'

export interface TableByToken {
    id: string
    restaurant_id: string
    room_id: string | null
    label: string
    restaurants: { name: string; slug: string | null; logo_url: string | null; physical_menu_urls: string[] | null } | null
}

/**
 * Resolves a table by its QR token, memoized per request via React.cache().
 *
 * The same qr_token was previously looked up separately (and uncached) in
 * layout.tsx, page.tsx's generateMetadata, page.tsx's main render, and
 * checkout/page.tsx — up to 4 identical round-trips for one page load.
 * React.cache() dedupes calls with the same argument within a single render
 * pass, so every caller below now shares one query.
 */
export const getTableByToken = cache(async (qrToken: string): Promise<TableByToken | null> => {
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('tables')
        .select('id, restaurant_id, room_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
        .eq('qr_token', qrToken)
        .single()

    if (!data) return null

    return {
        id: data.id,
        restaurant_id: data.restaurant_id,
        room_id: data.room_id,
        label: data.label,
        restaurants: Array.isArray(data.restaurants) ? data.restaurants[0] || null : (data.restaurants as unknown as TableByToken['restaurants']),
    }
})
