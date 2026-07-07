'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/receivables'

// ── Customer Credit Accounts ─────────────────────────────────
export async function createCustomerCreditAccountAction(input: { customer_name: string; customer_phone?: string; credit_limit?: number }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const customer_name = input.customer_name?.trim()
    if (!customer_name) return { error: 'Customer name is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('customer_credit_accounts')
        .insert({
            customer_name,
            customer_phone: input.customer_phone?.trim() || null,
            credit_limit: input.credit_limit ?? 0,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select()
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function updateCustomerCreditAccountAction(id: string, updates: { customer_name?: string; customer_phone?: string; credit_limit?: number; is_active?: boolean }) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('customer_credit_accounts').update(updates, { count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteCustomerCreditAccountAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage customer credit accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('customer_credit_accounts').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Receivable Transactions (Payment Collection / Charges) ────
export async function createReceivableTransactionAction(input: {
    customer_credit_account_id: string
    type: 'charge' | 'payment'
    amount: number
    description: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage receivable transactions.' } }
    if (!input.customer_credit_account_id) return { error: 'A customer credit account is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('receivable_transactions')
        .insert({
            customer_credit_account_id: input.customer_credit_account_id,
            type: input.type,
            amount: input.amount,
            description: input.description.trim(),
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, customer_credit_accounts(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteReceivableTransactionAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage receivable transactions.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase.from('receivable_transactions').delete({ count: 'exact' }).eq('id', id).eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Transaction not found.' }
    revalidatePath(PATH)
    return { success: true }
}
