// Computes a live financial end-of-day summary for one restaurant/date,
// combining Day Book session movement (Cash Book / Bank Book / Vouchers)
// with the Income & Expenses category breakdowns. Nothing here is persisted
// — day_book_sessions/day_book_entries are already the permanent record for
// a closed day, so recomputing on demand guarantees agreement with what
// Cash Book and Bank Book show for the same date.

import { SupabaseClient } from '@supabase/supabase-js'
import { computeBalance, parseEntryDescription } from './ledger'
import { DayBookEntry, DayBookSessionStatus } from '@/types/database'

export interface CategoryBreakdownItem {
    name: string
    amount: number
}

export interface FinanceDaySummary {
    date: string
    sessionStatus: DayBookSessionStatus | null
    openingCash: number
    cashIn: number
    cashOut: number
    closingCash: number
    openingBank: number
    bankIn: number
    bankOut: number
    closingBank: number
    // Real cheque amounts, parsed out of the voucher's JSON description —
    // day_book_entries.amount sits at a 0.01 placeholder for these until
    // manager approval, so it can't be summed directly.
    pendingChequeCount: number
    pendingChequeAmount: number
    totalIncome: number
    totalExpense: number
    expenseByCategory: CategoryBreakdownItem[]
    incomeByCategory: CategoryBreakdownItem[]
}

type CategoryRef = { name: string } | { name: string }[] | null | undefined
type CategoryRow = { amount: number; expense_categories?: CategoryRef; income_categories?: CategoryRef }

function categoryName(ref: CategoryRef): string {
    const row = Array.isArray(ref) ? ref[0] : ref
    return row?.name || 'Uncategorized'
}

function groupByCategory(rows: CategoryRow[], categoryKey: 'expense_categories' | 'income_categories'): CategoryBreakdownItem[] {
    const totals = new Map<string, number>()
    for (const row of rows) {
        const name = categoryName(row[categoryKey])
        totals.set(name, (totals.get(name) ?? 0) + Number(row.amount))
    }
    return Array.from(totals.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
}

export async function getFinanceDaySummary(
    supabase: SupabaseClient,
    restaurantId: string,
    dateStr: string
): Promise<FinanceDaySummary> {
    const { data: session } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', dateStr)
        .maybeSingle()

    let openingCash = 0, cashIn = 0, cashOut = 0, closingCash = 0
    let openingBank = 0, bankIn = 0, bankOut = 0, closingBank = 0
    let pendingChequeCount = 0
    let pendingChequeAmount = 0

    if (session) {
        openingCash = Number(session.opening_balance)
        openingBank = Number(session.opening_bank_balance)

        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('type, amount, description')
            .eq('session_id', session.id)

        const entries = (entriesData || []) as Pick<DayBookEntry, 'type' | 'amount' | 'description'>[]

        const cash = computeBalance(entries, openingCash, 'cash_in', 'cash_out')
        cashIn = cash.inTotal
        cashOut = cash.outTotal
        closingCash = cash.closing

        const bank = computeBalance(entries, openingBank, 'bank_in', 'bank_out')
        bankIn = bank.inTotal
        bankOut = bank.outTotal
        closingBank = bank.closing

        for (const entry of entries) {
            const parsed = parseEntryDescription(entry.description)
            if (parsed?.status === 'pending_approval') {
                pendingChequeCount += 1
                pendingChequeAmount += Number(parsed.amount ?? 0)
            }
        }
    }

    // expenses/income_entries carry no session_id, so they have to be scoped by
    // time — but they must be scoped by the SAME stretch of time the Day Book
    // figures above cover, or the two halves of one report describe different
    // periods. A session deliberately stays open across midnight (see
    // lib/ledger.ts: a restaurant serving until 2am keeps posting against the
    // session opened the previous day), so on any day the business trades past
    // midnight the NST calendar window disagreed with it: a supplier payment
    // made at 00:40 showed up in this day's cashOut but in tomorrow's
    // totalExpense, and neither page added up.
    //
    // With a session, use its own span; without one, fall back to the calendar
    // day, which is all there is to go on.
    const dayStart = new Date(`${dateStr}T00:00:00+05:45`).toISOString()
    const dayEnd = new Date(`${dateStr}T23:59:59.999+05:45`).toISOString()
    const start = session ? new Date(session.created_at as string).toISOString() : dayStart
    const end = session
        ? new Date((session.closed_at as string | null) ?? Date.now()).toISOString()
        : dayEnd

    const [{ data: expenseRows }, { data: incomeRows }, { data: staffPayoutRows }] = await Promise.all([
        supabase
            .from('expenses')
            .select('amount, expense_categories(name)')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', start)
            .lte('created_at', end),
        supabase
            .from('income_entries')
            .select('amount, income_categories(name)')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', start)
            .lte('created_at', end),
        // Salary/advance payouts live in staff_ledger, not expenses — without
        // this they'd silently vanish from the day's true outflow, since
        // that's the only other table real cash leaves the business through.
        supabase
            .from('staff_ledger')
            .select('amount')
            .eq('restaurant_id', restaurantId)
            .in('entry_type', ['salary_payout', 'advance_payment'])
            .gte('created_at', start)
            .lte('created_at', end)
    ])

    const expenseByCategory = groupByCategory((expenseRows as unknown as CategoryRow[]) || [], 'expense_categories')
    const incomeByCategory = groupByCategory((incomeRows as unknown as CategoryRow[]) || [], 'income_categories')

    const staffPayoutTotal = (staffPayoutRows || []).reduce((sum, r) => sum + Number(r.amount), 0)
    if (staffPayoutTotal > 0) {
        expenseByCategory.push({ name: 'Staff Payroll', amount: staffPayoutTotal })
        expenseByCategory.sort((a, b) => b.amount - a.amount)
    }

    return {
        date: dateStr,
        sessionStatus: session?.status ?? null,
        openingCash, cashIn, cashOut, closingCash,
        openingBank, bankIn, bankOut, closingBank,
        pendingChequeCount, pendingChequeAmount,
        totalIncome: incomeByCategory.reduce((sum, c) => sum + c.amount, 0),
        totalExpense: expenseByCategory.reduce((sum, c) => sum + c.amount, 0),
        expenseByCategory, incomeByCategory
    }
}
