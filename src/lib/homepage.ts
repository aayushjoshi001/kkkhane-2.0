import { createAdminClient } from '@/lib/supabase/server'
import type { HomepageConfig } from '@/types/database'
import { fetchWithCache } from '@/lib/redis'

/**
 * Resolve a restaurant's homepage config, or null when none is configured
 * (or on any lookup error — the customer QR flow treats null as "skip
 * straight to the menu", the same behavior /api/homepage/get's 404 case
 * produces client-side).
 *
 * Uses the admin client, not the cookie-backed server client: this runs inside
 * the ISR-rendered /t/[tableSlug] page, where touching `cookies()` throws
 * DYNAMIC_SERVER_USAGE. The config is public, per-restaurant data with no
 * per-user rows, so bypassing RLS is safe here.
 */
export async function getHomepageConfig(restaurantId: string): Promise<HomepageConfig | null> {
    return fetchWithCache(`homepage-config:${restaurantId}`, async () => {
        const supabase = await createAdminClient()
        const [{ data: config, error }, { data: restaurant }] = await Promise.all([
            supabase.from('homepage_configs').select('*').eq('restaurant_id', restaurantId).single(),
            supabase.from('restaurants').select('name, logo_url').eq('id', restaurantId).single(),
        ])

        if (error || !config) return null

        // Defensive: features/gallery must be arrays for the templates & manager.
        // Tolerates legacy rows where features was stored as { enabled, items: [] }.
        const row = config as Record<string, unknown>
        if (!Array.isArray(row.features)) {
            const f = row.features as { items?: unknown } | null
            row.features = Array.isArray(f?.items) ? f!.items : []
        }
        if (!Array.isArray(row.gallery)) row.gallery = []

        row.restaurant_name = restaurant?.name
        if (!row.logo_url) row.logo_url = restaurant?.logo_url ?? null

        return row as unknown as HomepageConfig
    }, 300) // 5 minutes TTL
}
