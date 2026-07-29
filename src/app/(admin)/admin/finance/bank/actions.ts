'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/finance/bank'

// ── Bank Accounts / Wallets ─────────────────────────────────────
export async function createBankAccountAction(input: {
    name: string
    account_type: 'bank' | 'wallet'
    wallet_provider?: string
    bank_name?: string
    account_number?: string
    opening_balance?: number
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank accounts.' } }
    const name = input.name?.trim()
    if (!name) return { error: 'Account name is required.' }
    if (input.account_type === 'wallet' && !input.wallet_provider) return { error: 'Select a wallet provider.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('bank_accounts')
        .insert({
            name,
            account_type: input.account_type,
            wallet_provider: input.account_type === 'wallet' ? input.wallet_provider : null,
            bank_name: input.bank_name?.trim() || null,
            account_number: input.account_number?.trim() || null,
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

export async function updateBankAccountAction(id: string, updates: Record<string, unknown>) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank accounts.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('bank_accounts')
        .update(updates, { count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Bank account not found.' }
    revalidatePath(PATH)
    return { success: true }
}

export async function deleteBankAccountAction(id: string, reason: string): Promise<{ success?: boolean; error?: string; updatedBankName?: string }> {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank accounts.' } }
    const trimmedReason = reason?.trim()
    if (!trimmedReason) return { error: 'A description/reason for deletion is required.' }

    const supabase = await createAdminClient()

    // 1. Try to update using deactivation_reason first
    const { error: primaryError, count } = await supabase
        .from('bank_accounts')
        .update({
            is_active: false,
            deactivation_reason: trimmedReason
        })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .select()

    // 2. If it fails because the column does not exist, fallback to appending reason to bank_name
    if (primaryError) {
        if (primaryError.message.includes('deactivation_reason') || primaryError.code === '42703') {
            const { data: account } = await supabase
                .from('bank_accounts')
                .select('bank_name')
                .eq('id', id)
                .eq('restaurant_id', user.restaurantId)
                .single()
            
            const currentBankName = account?.bank_name || ''
            const fallbackBankName = currentBankName.includes(' (Deleted:')
                ? currentBankName
                : `${currentBankName} (Deleted: ${trimmedReason})`.trim()

            const { error: fallbackError } = await supabase
                .from('bank_accounts')
                .update({
                    is_active: false,
                    bank_name: fallbackBankName
                })
                .eq('id', id)
                .eq('restaurant_id', user.restaurantId)

            if (fallbackError) return { error: fallbackError.message }
        } else {
            return { error: primaryError.message }
        }
    }

    revalidatePath(PATH)
    return { success: true }
}

// ── Bank Transactions ────────────────────────────────────────────
export async function createBankTransactionAction(input: {
    bank_account_id: string
    type: string
    amount: number
    description: string
    counterparty_account_id?: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank transactions.' } }
    if (!input.bank_account_id) return { error: 'A bank account is required.' }
    if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: 'Amount must be a positive number.' }
    if (!input.description?.trim()) return { error: 'Description is required.' }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('bank_transactions')
        .insert({
            bank_account_id: input.bank_account_id,
            type: input.type,
            amount: input.amount,
            description: input.description.trim(),
            counterparty_account_id: input.counterparty_account_id || null,
            restaurant_id: user.restaurantId,
            created_by: user.id,
        })
        .select('*, bank_accounts(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteBankTransactionAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank transactions.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('bank_transactions')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Transaction not found.' }
    revalidatePath(PATH)
    return { success: true }
}

// ── Bank Reconciliations ─────────────────────────────────────────
export async function createBankReconciliationAction(input: {
    bank_account_id: string
    statement_date: string
    statement_balance: number
    book_balance?: number
    notes?: string
}) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank reconciliations.' } }
    if (!input.bank_account_id) return { error: 'A bank account is required.' }
    if (!input.statement_date) return { error: 'Statement date is required.' }
    if (!Number.isFinite(input.statement_balance)) return { error: 'Statement balance must be a number.' }

    const variance = input.book_balance != null ? input.statement_balance - input.book_balance : null

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('bank_reconciliations')
        .insert({
            bank_account_id: input.bank_account_id,
            statement_date: input.statement_date,
            statement_balance: input.statement_balance,
            book_balance: input.book_balance ?? null,
            variance,
            notes: input.notes?.trim() || null,
            status: variance === null || variance === 0 ? 'reconciled' : 'flagged',
            restaurant_id: user.restaurantId,
            reconciled_by: user.id,
        })
        .select('*, bank_accounts(*)')
        .single()
    if (error) return { error: error.message }
    revalidatePath(PATH)
    return { data }
}

export async function deleteBankReconciliationAction(id: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'You are not authorized to manage bank reconciliations.' } }
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('bank_reconciliations')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Reconciliation not found.' }
    revalidatePath(PATH)
    return { success: true }
}
