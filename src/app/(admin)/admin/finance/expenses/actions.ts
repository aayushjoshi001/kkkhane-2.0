'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/expenses'

// ── Expense Categories ───────────────────────────────────────
export async function createExpenseCategoryAction(input: { name: string; description?: string; parent_id?: string | null }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expense categories.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Category name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('expense_categories')
        .insert({
            name,
            description: input.description?.trim() || null,
            parent_id: input.parent_id || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateExpenseCategoryAction(id: string, updates: { name?: string; description?: string; is_active?: boolean; parent_id?: string | null }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expense categories.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('expense_categories').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteExpenseCategoryAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expense categories.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('expense_categories').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Category not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Expenses ──────────────────────────────────────────────────
export async function createExpenseAction(input: {
    category_id: string
    amount: number
    description: string
    vendor_name?: string
    is_recurring?: boolean
    recurrence_interval?: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expenses.' } }
    if (!input.category_id) return { error: 'A category is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('expenses')
        .insert({
            category_id: input.category_id,
            amount: input.amount,
            description: input.description.trim(),
            vendor_name: input.vendor_name?.trim() || null,
            is_recurring: input.is_recurring ?? false,
            recurrence_interval: input.is_recurring ? (input.recurrence_interval || null) : null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, expense_categories(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateExpenseStatusAction(id: string, status: 'pending' | 'approved' | 'rejected' | 'paid') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expenses.' } }
    const supabase = await createAdminClient()
    const updates: Record<string, unknown> = { status }
    if (status === 'approved') { updates.approved_by = user.id; updates.approved_at = new Date().toISOString() }
    const { error, count } = await supabase.from('expenses').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Expense not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteExpenseAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage expenses.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('expenses').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Expense not found.' }
    revalidatePath(PATH)
    return { success: true }
}
