import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import ThemeCustomizer from '@/components/admin/ThemeCustomizer'

export const revalidate = 0

export default async function AdminThemePage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    // Fetch settings + restaurant branding scoped to this restaurant only
    const [{ data: settings }, { data: restaurant }] = await Promise.all([
        supabase.from('settings').select('*').eq('restaurant_id', restaurantId).limit(1).single(),
        supabase.from('restaurants').select('name, slug, logo_url').eq('id', restaurantId).single(),
    ])

    if (!settings) {
        // In production we'd create a default row here if it didn't exist
        return <div className="p-8 text-center text-ink-subtle">No settings configuration found in database.</div>
    }

    return (
        <ThemeCustomizer
            initialSettings={settings}
            restaurantName={restaurant?.name}
            restaurantSlug={restaurant?.slug ?? null}
            initialLogoUrl={restaurant?.logo_url ?? null}
        />
    )
}
