'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRoleWithOptions } from '@/lib/auth'
import { TIER_LIMITS } from '@/lib/tiers'
import { revalidatePath, revalidateTag } from 'next/cache'

export async function selectFreePlanAction() {
    try {
        const currentUser = await requireRoleWithOptions(['super_admin', 'manager', 'owner'], { allowSuspended: true })
        if (!currentUser.restaurantId) throw new Error('No restaurant context')

        const adminSupabase = await createAdminClient()

        // Apply Free Plan logic
        // We set it as active, free tier, no expiration (null), and reset suspension
        const { error } = await adminSupabase
            .from('restaurants')
            .update({
                subscription_tier: 'free',
                subscription_status: 'active',
                subscription_expires_at: null,
                is_suspended: false,
                max_staff: TIER_LIMITS.free.max_staff,
                max_menu_items: TIER_LIMITS.free.max_menu_items,
                max_tables: TIER_LIMITS.free.max_tables,
            })
            .eq('id', currentUser.restaurantId)

        if (error) throw error

        // The plan gates read through getRestaurantFeatures, which caches per
        // tenant for an hour under its own tag. revalidatePath does not reach
        // that, so without this a tenant dropping to Free (including one ending
        // their trial early) would keep the paid features for up to an hour.
        try {
            revalidateTag(`features-${currentUser.restaurantId}`, 'max')
        } catch (e) {
            console.warn('[selectFreePlan] revalidate failed', e)
        }
        revalidatePath('/', 'layout')
        return { success: true }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to select plan' }
    }
}
