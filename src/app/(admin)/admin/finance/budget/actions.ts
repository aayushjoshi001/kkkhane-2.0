'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/budget'

// ── Budget Categories ────────────────────────────────────────
export async function createBudgetCategoryAction(input: { name: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budget categories.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Category name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('budget_categories')
        .insert({ name, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteBudgetCategoryAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budget categories.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('budget_categories').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Budgets ───────────────────────────────────────────────────
export async function createBudgetAction(input: { name: string; period_type: string; start_date: string; end_date: string }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budgets.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Budget name is required.' }
    if (!input.start_date || !input.end_date) return { error: 'Start and end dates are required.' }
    if (input.end_date < input.start_date) return { error: 'End date must be on or after the start date.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('budgets')
        .insert({ name, period_type: input.period_type, start_date: input.start_date, end_date: input.end_date, restaurant_id: user.restaurantId, created_by: user.id })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateBudgetStatusAction(id: string, status: 'draft' | 'active' | 'closed') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budgets.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('budgets').update({ status }, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Budget not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteBudgetAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budgets.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('budgets').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Budget not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Budget Lines ──────────────────────────────────────────────
export async function createBudgetLineAction(input: { budget_id: string; category_id: string; planned_amount: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budget lines.' } }
    if (!input.budget_id || !input.category_id) return { error: 'A budget and category are required.' }
    if (!Number.isFinite(input.planned_amount) || input.planned_amount < 0) return { error: 'Planned amount must be a non-negative number.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('budget_lines')
        .insert({ budget_id: input.budget_id, category_id: input.category_id, planned_amount: input.planned_amount, restaurant_id: user.restaurantId })
        .select('*, budget_categories(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteBudgetLineAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage budget lines.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('budget_lines').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Budget line not found.' }
    revalidatePath(PATH)
    return { success: true }
}
