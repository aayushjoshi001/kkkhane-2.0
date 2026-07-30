'use server'

// Data for the automatic end-of-day export: everything a cashier or manager
// needs bundled into a zip the moment they close the business day. Reuses the
// same aggregations the Reports and Day Book pages already show on screen so
// the zipped PDFs can never disagree with what's on those pages.

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { generateEodReport } from '@/lib/reports'
import { getFinanceDaySummary, type FinanceDaySummary } from '@/lib/financeReports'
import { attachCreatorNames } from '@/lib/ledger'
import type { DayBookEntry, DayBookSession, EodReport } from '@/types/database'

// Whoever can close the business day (BusinessSessionContext's `canManage`)
// can also export it — the export isn't a separate finance permission.
const EXPORT_ROLES = ['manager', 'super_admin', 'cashier']

export interface DetailedFinancialItem {
    id: string
    created_at: string
    category_name: string
    description: string | null
    amount: number
    created_by_name: string | null
}

export interface EodExportBundle {
    restaurantName: string
    currency: string
    currencySymbol: string | null
    date: string
    eodReport: EodReport
    financeSummary: FinanceDaySummary
    session: DayBookSession | null
    entries: (DayBookEntry & { created_by_name: string | null })[]
    incomeItems: DetailedFinancialItem[]
    expenseItems: DetailedFinancialItem[]
}

export async function getEodExportBundleAction(
    date: string
): Promise<{ data?: EodExportBundle; error?: string }> {
    const currentUser = await getCurrentUser()
    if (!EXPORT_ROLES.includes(currentUser.role)) {
        return { error: 'Not authorized to export end-of-day reports.' }
    }

    const restaurantId = currentUser.restaurantId
    const supabase = await createAdminClient()

    const [restaurantRes, settingsRes, sessionRes] = await Promise.all([
        supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle(),
        supabase.from('settings').select('features_v2').eq('restaurant_id', restaurantId).maybeSingle(),
        supabase
            .from('day_book_sessions')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('date', date)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ])

    const session = (sessionRes.data as DayBookSession) ?? null

    let entries: (DayBookEntry & { created_by_name: string | null })[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
            .order('created_at', { ascending: true })
        entries = await attachCreatorNames(supabase, (entriesData as DayBookEntry[]) || [])
    }

    const start = new Date(`${date}T00:00:00+05:45`).toISOString()
    const end = new Date(`${date}T23:59:59.999+05:45`).toISOString()

    const [{ data: rawIncome }, { data: rawExpense }] = await Promise.all([
        supabase
            .from('income_entries')
            .select('id, created_at, amount, description, created_by, income_categories(name)')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: true }),
        supabase
            .from('expenses')
            .select('id, created_at, amount, description, created_by, expense_categories(name)')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', start)
            .lte('created_at', end)
            .order('created_at', { ascending: true }),
    ])

    const incomeWithNames = await attachCreatorNames(supabase, (rawIncome || []) as any[])
    const expenseWithNames = await attachCreatorNames(supabase, (rawExpense || []) as any[])

    const incomeItems: DetailedFinancialItem[] = incomeWithNames.map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        category_name: Array.isArray(r.income_categories) ? r.income_categories[0]?.name : r.income_categories?.name || 'Uncategorized',
        description: r.description || null,
        amount: Number(r.amount) || 0,
        created_by_name: r.created_by_name || 'Unknown',
    }))

    const expenseItems: DetailedFinancialItem[] = expenseWithNames.map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        category_name: Array.isArray(r.expense_categories) ? r.expense_categories[0]?.name : r.expense_categories?.name || 'Uncategorized',
        description: r.description || null,
        amount: Number(r.amount) || 0,
        created_by_name: r.created_by_name || 'Unknown',
    }))

    let eodReport: EodReport
    let financeSummary: FinanceDaySummary
    try {
        ;[eodReport, financeSummary] = await Promise.all([
            generateEodReport(restaurantId, date) as Promise<EodReport>,
            getFinanceDaySummary(supabase, restaurantId, date),
        ])
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to build end-of-day export.' }
    }

    const currencyFeatures = settingsRes.data?.features_v2 as { currency?: string; currencySymbol?: string | null } | null

    return {
        data: {
            restaurantName: restaurantRes.data?.name || 'Restaurant',
            currency: currencyFeatures?.currency || 'NPR',
            currencySymbol: currencyFeatures?.currencySymbol ?? null,
            date,
            eodReport,
            financeSummary,
            session,
            entries,
            incomeItems,
            expenseItems,
        },
    }
}
