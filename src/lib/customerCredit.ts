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
    input: { name?: string; phone?: string }
): Promise<{ id: string } | { error: string }> {
    const rawName = input.name?.trim()
    const rawPhone = input.phone?.trim()

    const name = rawName || (rawPhone ? `Customer (${rawPhone})` : 'Walk-in Credit Customer')
    const phone = rawPhone || `credit-${name.toLowerCase().replace(/[^a-z0-9]/g, '') || '0000000000'}`

    // Fetch partner linking info
    const { data: currentRest } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id, linked_hotel_id, link_allow_loyalty_sharing, link_allow_credit_sharing')
        .eq('id', restaurantId)
        .maybeSingle()

    const partnerId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
    const allowLoyalty = currentRest?.link_allow_loyalty_sharing !== false
    const allowCredit = currentRest?.link_allow_credit_sharing !== false

    let existingAccount: { id: string } | null = null

    // 1. Look up by phone in current tenant
    const { data: curAcc } = await supabase
        .from('customer_credit_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('customer_phone', phone)
        .maybeSingle()

    existingAccount = curAcc

    // 2. If not found by phone, look up by exact customer name in current tenant
    if (!existingAccount && rawName) {
        const { data: curAccByName } = await supabase
            .from('customer_credit_accounts')
            .select('id')
            .eq('restaurant_id', restaurantId)
            .eq('customer_name', rawName)
            .maybeSingle()

        existingAccount = curAccByName
    }

    // 3. If not found in current tenant, check partner tenant if loyalty/credit sharing is enabled
    if (!existingAccount && partnerId && (allowLoyalty || allowCredit)) {
        const { data: partAcc } = await supabase
            .from('customer_credit_accounts')
            .select('id')
            .eq('restaurant_id', partnerId)
            .eq('customer_phone', phone)
            .maybeSingle()

        existingAccount = partAcc
    }

    if (existingAccount) return { id: existingAccount.id }

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

export async function postLoyaltyEarn(
    supabase: SupabaseClient,
    restaurantId: string,
    customerCreditAccountId: string,
    points: number,
    description: string
): Promise<{ success: boolean; error?: string }> {
    if (points <= 0) return { success: true }

    try {
        // 1. Increment points in account
        const { data: account, error: getErr } = await supabase
            .from('customer_credit_accounts')
            .select('loyalty_points')
            .eq('id', customerCreditAccountId)
            .single()

        if (getErr) throw getErr

        const currentPoints = Number(account?.loyalty_points || 0)
        const newPoints = currentPoints + points

        const { error: updateErr } = await supabase
            .from('customer_credit_accounts')
            .update({ loyalty_points: newPoints })
            .eq('id', customerCreditAccountId)

        if (updateErr) throw updateErr

        // 2. Insert into loyalty ledger
        const { error: ledgerErr } = await supabase.from('loyalty_ledger').insert({
            restaurant_id: restaurantId,
            account_id: customerCreditAccountId,
            points_changed: points,
            type: 'earn',
            description
        })

        if (ledgerErr) throw ledgerErr
        return { success: true }
    } catch (err) {
        console.error('Failed to award loyalty points:', err)
        return { success: false, error: err instanceof Error ? err.message : 'Failed to award points' }
    }
}

export async function postLoyaltyRedeem(
    supabase: SupabaseClient,
    restaurantId: string,
    customerCreditAccountId: string,
    points: number,
    description: string
): Promise<{ success: boolean; error?: string }> {
    if (points <= 0) return { success: true }

    try {
        // 1. Decrement points in account
        const { data: account, error: getErr } = await supabase
            .from('customer_credit_accounts')
            .select('loyalty_points')
            .eq('id', customerCreditAccountId)
            .single()

        if (getErr) throw getErr

        const currentPoints = Number(account?.loyalty_points || 0)
        if (currentPoints < points) {
            return { success: false, error: 'Insufficient loyalty points' }
        }

        const newPoints = currentPoints - points

        const { error: updateErr } = await supabase
            .from('customer_credit_accounts')
            .update({ loyalty_points: newPoints })
            .eq('id', customerCreditAccountId)

        if (updateErr) throw updateErr

        // 2. Insert into loyalty ledger
        const { error: ledgerErr } = await supabase.from('loyalty_ledger').insert({
            restaurant_id: restaurantId,
            account_id: customerCreditAccountId,
            points_changed: -points,
            type: 'redeem',
            description
        })

        if (ledgerErr) throw ledgerErr
        return { success: true }
    } catch (err) {
        console.error('Failed to redeem loyalty points:', err)
        return { success: false, error: err instanceof Error ? err.message : 'Failed to redeem points' }
    }
}
