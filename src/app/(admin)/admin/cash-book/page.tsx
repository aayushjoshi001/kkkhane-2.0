import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashBookClient from './CashBookClient'
import type { DayBookEntry, ExpenseCategory } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'
import { resolveActiveDayBookSession } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

export default async function CashBookPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    const todayDate = getNstDateString()

    // The currently active session — open (even if still dated a prior
    // calendar day because it hasn't been closed yet), or auto-opened just
    // now carrying forward the last closed session's balances. Only null the
    // very first time this restaurant ever uses the Day Book.
    const session = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    const { data: expenseCategories } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name', { ascending: true })

    // Fetch today's entries (if session exists)
    let entries: DayBookEntry[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
            .in('type', ['cash_in', 'cash_out'])
            .order('created_at', { ascending: false })
        entries = (entriesData as DayBookEntry[]) || []
    }

    // Calculate cash totals
    const totalCashIn  = entries.filter(e => e.type === 'cash_in').reduce((s: number, e: DayBookEntry) => s + Number(e.amount), 0)
    const totalCashOut = entries.filter(e => e.type === 'cash_out').reduce((s: number, e: DayBookEntry) => s + Number(e.amount), 0)
    const openingBal   = Number(session?.opening_balance ?? 0)

    const initialTotals = {
        total_cash_in:    totalCashIn,
        total_cash_out:   totalCashOut,
        closing_balance:  openingBal + totalCashIn - totalCashOut,
    }

    // `session` is only ever null on the true first-ever use (no session
    // history at all to carry a balance forward from) — resolveActiveDayBookSession
    // already auto-opens from the last closed session's balances otherwise, so
    // there's nothing to prefill here beyond zero.
    const previousClosingBalance: number | null = null
    const previousClosingBankBalance: number = 0

    return (
        <CashBookClient
            initialSession={session ?? null}
            initialEntries={entries}
            initialTotals={initialTotals}
            todayDate={todayDate}
            userRole={currentUser.role}
            previousClosingBalance={previousClosingBalance}
            previousClosingBankBalance={previousClosingBankBalance}
            expenseCategories={(expenseCategories as ExpenseCategory[]) || []}
        />
    )
}
