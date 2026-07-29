'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'

export async function getPricingRulesAction(restaurantId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('pricing_rules')
        .select('*, menu_items(name)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
    return { data: data || [] }
}

export async function createPricingRuleAction(input: {
    restaurant_id: string
    name: string
    description?: string | null
    rule_type: string
    value: number
    applies_to_item_id?: string | null
    applies_to_category_id?: string | null
    applies_to_all?: boolean
    days_of_week?: number[]
    start_time?: string
    end_time?: string
    valid_from?: string | null
    valid_until?: string | null
    priority?: number
    is_active?: boolean
}) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('pricing_rules')
        .insert(input)
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath('/admin/pricing')
    return { data }
}

export async function updatePricingRuleAction(id: string, updates: Record<string, unknown>) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error } = await supabase.from('pricing_rules').update(updates).eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/admin/pricing')
    return { success: true }
}

export async function deletePricingRuleAction(id: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error } = await supabase.from('pricing_rules').delete().eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/admin/pricing')
    return { success: true }
}
