'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/cash'

// ── Cash Drawers ──────────────────────────────────────────────
export async function createCashDrawerAction(input: { name: string; location?: string; opening_balance?: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash drawers.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Drawer name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('cash_drawers')
        .insert({
            name,
            location: input.location?.trim() || null,
            opening_balance: input.opening_balance ?? 0,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateCashDrawerAction(id: string, updates: { name?: string; location?: string; opening_balance?: number; is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash drawers.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('cash_drawers')
        .update(updates, { count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Cash drawer not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteCashDrawerAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash drawers.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('cash_drawers')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Cash drawer not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Cash Transactions ─────────────────────────────────────────
export async function createCashTransactionAction(input: {
    drawer_id: string
    type: string
    amount: number
    description: string
    counterparty_drawer_id?: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash transactions.' } }
    if (!input.drawer_id) return { error: 'A drawer is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('cash_transactions')
        .insert({
            drawer_id: input.drawer_id,
            type: input.type,
            amount: input.amount,
            description: input.description.trim(),
            counterparty_drawer_id: input.counterparty_drawer_id || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, cash_drawers(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateCashTransactionStatusAction(id: string, status: 'draft' | 'posted' | 'void') {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash transactions.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('cash_transactions')
        .update({ status }, { count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Transaction not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteCashTransactionAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash transactions.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('cash_transactions')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Transaction not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Cash Counts (Counting / Reconciliation) ─────────────────────
export async function createCashCountAction(input: {
    drawer_id: string
    counted_total: number
    expected_total?: number
    notes?: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash counts.' } }
    if (!input.drawer_id) return { error: 'A drawer is required.' }
    if (!Number.isFinite(input.counted_total) || input.counted_total < 0) return { error: 'Counted total must be a non-negative number.' }

    const variance = input.expected_total != null ? input.counted_total - input.expected_total : null

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('cash_counts')
        .insert({
            drawer_id: input.drawer_id,
            counted_total: input.counted_total,
            expected_total: input.expected_total ?? null,
            variance,
            notes: input.notes?.trim() || null,
            status: variance === null || variance === 0 ? 'reconciled' : 'flagged',
            restaurant_id: user.restaurantId,
            counted_by: user.id,
        })
        .select('*, cash_drawers(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteCashCountAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage cash counts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('cash_counts')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Cash count not found.' }
    revalidatePath(PATH)
    return { success: true }
}
