// Shared staff due-tracking logic — the complete running-balance formula
// already used by StaffManager.tsx's per-row/footer totals (opening balance
// plus accruals, minus deductions and payouts). Deliberately NOT the
// abbreviated formula the ledger modal's summary card uses, which omits
// deductions and would under-report what's actually owed.

import { SupabaseClient } from '@supabase/supabase-js'

export type StaffLedgerEntryType = 'salary_payout' | 'advance_payment' | 'bonus' | 'deduction' | 'accrual'

export const STAFF_PAY_ENTRY_TYPES: StaffLedgerEntryType[] = ['salary_payout', 'advance_payment', 'bonus']

export function computeStaffCurrentDue(
    entries: { entry_type: string; amount: number }[],
    openingBalance: number
): number {
    return entries.reduce((balance, e) => {
        if (e.entry_type === 'accrual') return balance + Number(e.amount)
        if (e.entry_type === 'deduction') return balance - Number(e.amount)
        if (STAFF_PAY_ENTRY_TYPES.includes(e.entry_type as StaffLedgerEntryType)) return balance - Number(e.amount)
        return balance
    }, openingBalance)
}

export async function fetchStaffCurrentDue(
    supabase: SupabaseClient,
    restaurantId: string,
    userId: string
): Promise<number> {
    const [{ data: user }, { data: entries }] = await Promise.all([
        supabase.from('users').select('opening_balance').eq('id', userId).eq('restaurant_id', restaurantId).maybeSingle(),
        supabase.from('staff_ledger').select('entry_type, amount').eq('user_id', userId).eq('restaurant_id', restaurantId),
    ])

    const openingBalance = Number((user as { opening_balance?: number } | null)?.opening_balance ?? 0)
    return computeStaffCurrentDue(entries ?? [], openingBalance)
}
