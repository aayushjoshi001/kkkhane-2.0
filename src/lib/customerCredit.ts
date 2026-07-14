// Shared "customer wants credit, not paying now" helpers — reuses the
// existing customer_credit_accounts / receivable_transactions tables and
// insert shape already established by
// src/app/(admin)/admin/finance/receivables/actions.ts (the Receivables and
// Customers Ledger admin pages read/write the exact same rows). This just
// makes that ledger reachable from an actual checkout, not only from the
// standalone admin screen.

import { SupabaseClient } from '@supabase/supabase-js'

// No DB-level unique constraint on customer_phone (a live table may already
// contain duplicates for the same phone), so dedup is done here at the
// application level: look up first, only create if nothing matches.
export async function findOrCreateCustomerCreditAccount(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string | null,
    input: { name: string; phone: string }
): Promise<{ id: string } | { error: string }> {
    const name = input.name?.trim()
    const phone = input.phone?.trim()
    if (!name) return { error: 'Customer name is required for credit.' }
    if (!phone) return { error: 'Customer phone is required for credit.' }

    const { data: existing } = await supabase
        .from('customer_credit_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('customer_phone', phone)
        .maybeSingle()

    if (existing) return { id: existing.id }

    const { data: created, error } = await supabase
        .from('customer_credit_accounts')
        .insert({
            restaurant_id: restaurantId,
            customer_name: name,
            customer_phone: phone,
            credit_limit: 0,
            created_by: userId,
        })
        .select('id')
        .single()

    if (error || !created) return { error: error?.message || 'Failed to create customer credit account' }
    return { id: created.id }
}

export async function postCreditCharge(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string | null,
    input: { customerCreditAccountId: string; amount: number; description: string }
): Promise<{ success: boolean; error?: string }> {
    if (input.amount <= 0) return { success: true }

    const { error } = await supabase.from('receivable_transactions').insert({
        restaurant_id: restaurantId,
        customer_credit_account_id: input.customerCreditAccountId,
        type: 'charge',
        amount: input.amount,
        description: input.description,
        created_by: userId,
    })

    if (error) {
        console.error('Failed to post credit charge:', error)
        return { success: false, error: error.message }
    }
    return { success: true }
}
