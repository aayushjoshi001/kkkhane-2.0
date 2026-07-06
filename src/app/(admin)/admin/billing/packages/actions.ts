'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRoleWithOptions } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

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
                max_staff: 1, // Free plan limits
                max_menu_items: 20
            })
            .eq('id', currentUser.restaurantId)

        if (error) throw error

        revalidatePath('/', 'layout')
        return { success: true }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to select plan' }
    }
}
