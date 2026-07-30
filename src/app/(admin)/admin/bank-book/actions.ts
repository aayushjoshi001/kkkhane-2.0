'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

export async function createBankAccountAction(input: {
    bank_name: string
    account_number: string
    display_name: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const bankName = input.bank_name?.trim()
    const accountNumber = input.account_number?.trim()
    const name = input.display_name?.trim() || bankName

    if (!bankName) return { error: 'Bank Name is required.' }
    if (!accountNumber) return { error: 'Account Number is required.' }

    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('bank_accounts')
        .insert({
            restaurant_id: user.restaurantId,
            name,
            account_type: 'bank',
            bank_name: bankName,
            account_number: accountNumber,
            opening_balance: 0,
            is_active: true,
            created_by: user.id
        })
        .select()
        .single()

    if (error) return { error: error.message }

    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/income-expenses')
    revalidatePath('/admin/suppliers')

    return { data }
}

export async function saveBankOpeningBalanceAction(input: {
    bank_account_id: string
    opening_balance: number
    reason: string
    is_edit: boolean
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    if (!input.bank_account_id) return { error: 'Bank account ID is required.' }
    if (!Number.isFinite(input.opening_balance)) return { error: 'Opening balance must be a valid number.' }
    const reason = input.reason?.trim()
    if (input.is_edit && !reason) return { error: 'Reason for editing opening balance is required.' }

    const supabase = await createAdminClient()

    const { data: bank, error: fetchErr } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('id', input.bank_account_id)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (fetchErr || !bank) return { error: 'Bank account not found.' }

    const oldBalance = Number(bank.opening_balance || 0)

    const { data, error } = await supabase
        .from('bank_accounts')
        .update({
            opening_balance: input.opening_balance,
            updated_at: new Date().toISOString(),
        })
        .eq('id', input.bank_account_id)
        .eq('restaurant_id', user.restaurantId)
        .select()
        .single()

    if (error) return { error: error.message }

    const { logAudit } = await import('@/lib/audit')
    await logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: input.is_edit ? 'opening_balance_edited' : 'opening_balance_added',
        entityType: 'bank_account',
        entityId: input.bank_account_id,
        oldValue: { name: bank.name, opening_balance: oldBalance },
        newValue: { name: bank.name, opening_balance: input.opening_balance, reason: reason || 'Initial opening balance set' },
    })

    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')
    return { data }
}
