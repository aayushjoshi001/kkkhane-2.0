'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'

export interface FinanceSearchResult {
    type: string
    label: string
    href: string
}

// Lightweight lookup across finance master data — not a general transaction
// search (no aggregation/calculation), just a name/code match.
export async function financeSearchAction(query: string): Promise<{ data?: FinanceSearchResult[]; error?: string }> {
    let user
    try { user = await requireRole('super_admin', 'manager') } catch { return { error: 'You are not authorized to search finance records.' } }

    const q = query.trim()
    if (q.length < 2) return { data: [] }

    const supabase = await createAdminClient()
    const like = `%${q}%`

    const [drawers, banks, suppliers, accounts, expenseCategories, incomeCategories] = await Promise.all([
        supabase.from('cash_drawers').select('id, name').eq('restaurant_id', user.restaurantId).ilike('name', like).limit(5),
        supabase.from('bank_accounts').select('id, name').eq('restaurant_id', user.restaurantId).ilike('name', like).limit(5),
        supabase.from('suppliers').select('id, name').eq('restaurant_id', user.restaurantId).ilike('name', like).limit(5),
        supabase.from('chart_of_accounts').select('id, name, code').eq('restaurant_id', user.restaurantId).or(`name.ilike.${like},code.ilike.${like}`).limit(5),
        supabase.from('expense_categories').select('id, name').eq('restaurant_id', user.restaurantId).ilike('name', like).limit(5),
        supabase.from('income_categories').select('id, name').eq('restaurant_id', user.restaurantId).ilike('name', like).limit(5),
    ])

    const results: FinanceSearchResult[] = [
        ...(drawers.data ?? []).map((d) => ({ type: 'Cash Drawer', label: d.name, href: '/admin/finance/cash' })),
        ...(banks.data ?? []).map((b) => ({ type: 'Bank Account', label: b.name, href: '/admin/finance/bank' })),
        ...(suppliers.data ?? []).map((s) => ({ type: 'Supplier', label: s.name, href: '/admin/finance/payables' })),
        ...(accounts.data ?? []).map((a) => ({ type: 'Chart of Accounts', label: `${a.code} — ${a.name}`, href: '/admin/finance/administration' })),
        ...(expenseCategories.data ?? []).map((c) => ({ type: 'Expense Category', label: c.name, href: '/admin/finance/expenses' })),
        ...(incomeCategories.data ?? []).map((c) => ({ type: 'Income Category', label: c.name, href: '/admin/finance/income' })),
    ]

    return { data: results }
}
