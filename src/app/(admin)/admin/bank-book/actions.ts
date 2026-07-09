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
