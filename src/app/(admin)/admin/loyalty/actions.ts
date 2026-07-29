'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'

export async function getLoyaltyConfigAction(restaurantId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('loyalty_config')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .single()
    return { data }
}

export async function upsertLoyaltyConfigAction(input: {
    restaurant_id: string
    points_per_dollar: number
    redemption_threshold: number
    redemption_value: number
    signup_bonus_points: number
    birthday_bonus_points: number | null
    silver_threshold: number
    gold_threshold: number
    platinum_threshold: number
    is_active: boolean
}) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    // Check if config exists
    const { data: existing } = await supabase
        .from('loyalty_config')
        .select('id')
        .eq('restaurant_id', input.restaurant_id)
        .single()

    if (existing) {
        const { error } = await supabase
            .from('loyalty_config')
            .update(input)
            .eq('id', existing.id)
        if (error) return { error: error.message }
    } else {
        const { error } = await supabase
            .from('loyalty_config')
            .insert(input)
        if (error) return { error: error.message }
    }

    revalidatePath('/admin/loyalty')
    return { success: true }
}

export async function getLoyaltyMembersAction(restaurantId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('loyalty_members')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('lifetime_points', { ascending: false })
        .limit(100)
    return { data: data || [] }
}
