'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/income'

// ── Income Categories ────────────────────────────────────────
export async function createIncomeCategoryAction(input: { name: string; description?: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage income categories.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Category name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('income_categories')
        .insert({ name, description: input.description?.trim() || null, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateIncomeCategoryAction(id: string, updates: { name?: string; description?: string; is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage income categories.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('income_categories').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteIncomeCategoryAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage income categories.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('income_categories').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Income Entries ───────────────────────────────────────────
export async function createIncomeEntryAction(input: { category_id: string; amount: number; description: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage income entries.' } }
    if (!input.category_id) return { error: 'A category is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('income_entries')
        .insert({
            category_id: input.category_id,
            amount: input.amount,
            description: input.description.trim(),
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, income_categories(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteIncomeEntryAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage income entries.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('income_entries').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Income entry not found.' }
    revalidatePath(PATH)
    return { success: true }
}
