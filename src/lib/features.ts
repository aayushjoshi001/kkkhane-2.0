'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import type { Settings, Restaurant } from '@/types/database'
import { getBusinessMode, type BusinessMode } from '@/lib/businessMode'
import { fetchWithCache, invalidateCache } from '@/lib/redis'
import { unstable_cache, revalidateTag, revalidatePath } from 'next/cache'

/**
 * Fetch features_v2 flags for a restaurant.
 * Cached for 30 seconds across requests — features change rarely and this
 * was previously hitting the DB on every kitchen/waiter/admin page load.
 */
export async function getRestaurantFeatures(restaurantId: string): Promise<Settings['features_v2'] | null> {
    const fetcher = unstable_cache(
        async () => {
            return fetchWithCache(`features:${restaurantId}`, async () => {
                const supabase = await createAdminClient()
                const { data } = await supabase
                    .from('settings')
                    .select('features_v2')
                    .eq('restaurant_id', restaurantId)
                    .single()
                return data?.features_v2 ?? null
            }, 86400)
        },
        [`features-${restaurantId}`],
        { tags: [`features-${restaurantId}`], revalidate: 3600 }
    )
    const features = await fetcher()
    if (!features) return null

    const isIrd = !!features.irdSyncEnabled
    return {
        ...features,
        financeEnabled: isIrd ? true : (features.financeEnabled ?? false),
        generateInvoiceEnabled: isIrd ? true : (features.generateInvoiceEnabled ?? true),
        printInvoiceEnabled: isIrd ? true : (features.printInvoiceEnabled ?? true),
        vatEnabled: isIrd ? features.vatEnabled : false
    }
}

/**
 * Fetch the restaurant's operational mode (derived from business_type).
 * Cached for 30 seconds — same rationale as getRestaurantFeatures.
 */
export async function getRestaurantMode(restaurantId: string): Promise<BusinessMode> {
    const fetcher = unstable_cache(
        async () => {
            return fetchWithCache(`mode:${restaurantId}`, async () => {
                const supabase = await createAdminClient()
                const { data } = await supabase
                    .from('restaurants')
                    .select('business_type')
                    .eq('id', restaurantId)
                    .single()
                return getBusinessMode(data?.business_type)
            }, 86400)
        },
        [`mode-${restaurantId}`],
        { tags: [`mode-${restaurantId}`], revalidate: 3600 }
    )
    return fetcher()
}

/**
 * Fetch the customer-facing menu layout ('grid' | 'list') from settings.theme.
 * Cached for 30 seconds — changes rarely and rides a hot customer page path.
 */
export async function getMenuLayout(restaurantId: string): Promise<'grid' | 'list'> {
    const fetcher = unstable_cache(
        async () => {
            return fetchWithCache(`menu-layout:${restaurantId}`, async () => {
                const supabase = await createAdminClient()
                const { data } = await supabase
                    .from('settings')
                    .select('theme')
                    .eq('restaurant_id', restaurantId)
                    .single()
                return (data?.theme as { menuLayout?: string } | null)?.menuLayout === 'list' ? 'list' : 'grid'
            }, 86400)
        },
        [`menu-layout-${restaurantId}`],
        { tags: [`menu-layout-${restaurantId}`], revalidate: 3600 }
    )
    return fetcher()
}

/**
 * Fetch restaurant with SaaS/Nepal fields for settings pages.
 */
export async function getRestaurantFull(restaurantId: string): Promise<Restaurant | null> {
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', restaurantId)
        .single()
    return data
}

/**
 * Check plan limit before creating a resource.
 */
export async function checkPlanLimit(restaurantId: string, resource: 'menu_items' | 'staff' | 'tables') {
    const supabase = await createAdminClient()
    const { data, error } = await supabase.rpc('check_plan_limit', {
        p_restaurant_id: restaurantId,
        p_resource: resource,
    })
    if (error) return { allowed: true, reason: 'Could not check limit' }
    return data as { allowed: boolean; current?: number; max?: number; tier?: string; reason: string }
}

/**
 * Update features_v2 flags (admin only).
 */
export async function updateFeaturesAction(restaurantId: string, features: Partial<Settings['features_v2']>) {
    // 'use server' makes this a public endpoint — it must enforce its own auth:
    // super admins can update any restaurant; managers only their own.
    const currentUser = await getCurrentUser()
    const isSuperAdmin = currentUser.role === 'super_admin'
    if (!isSuperAdmin && !(currentUser.role === 'manager' && currentUser.restaurantId === restaurantId)) {
        return { error: 'Unauthorized' }
    }
    // financeEnabled gates the accounting module (Premium and above); only super
    // admins may flip it.
    if (!isSuperAdmin && 'financeEnabled' in features) {
        return { error: 'Unauthorized' }
    }

    const supabase = await createAdminClient()

    // Merge with existing features
    const { data: existing } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single()

    const merged = { ...(existing?.features_v2 || {}), ...features }

    const { error } = await supabase
        .from('settings')
        .update({ features_v2: merged })
        .eq('restaurant_id', restaurantId)

    if (error) return { error: error.message }
    
    await invalidateCache(`features:${restaurantId}`)
    revalidateTag(`features-${restaurantId}`, 'max')
    revalidatePath('/waiter')
    revalidatePath('/admin/settings')
    
    return { success: true }
}
