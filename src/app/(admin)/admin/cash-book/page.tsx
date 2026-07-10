import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashBookClient from './CashBookClient'
import type { DayBookEntry, ExpenseCategory } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export default async function CashBookPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    const todayDate = getNstDateString()

    // Fetch today's session (if exists)
    const { data: session } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', todayDate)
        .maybeSingle()

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

    // Get yesterday's closing cash balance (for auto carry-over on first open)
    let previousClosingBalance: number | null = null
    if (!session) {
        // Find the most recent closed session
        const { data: prevSession } = await supabase
            .from('day_book_sessions')
            .select('id, opening_balance')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'closed')
            .lt('date', todayDate)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (prevSession) {
            // Calculate its closing balance
            const { data: prevEntries } = await supabase
                .from('day_book_entries')
                .select('type, amount')
                .eq('session_id', prevSession.id)
                .in('type', ['cash_in', 'cash_out'])

            if (prevEntries) {
                const prevIn  = prevEntries.filter(e => e.type === 'cash_in').reduce((s, e) => s + Number(e.amount), 0)
                const prevOut = prevEntries.filter(e => e.type === 'cash_out').reduce((s, e) => s + Number(e.amount), 0)
                previousClosingBalance = Number(prevSession.opening_balance) + prevIn - prevOut
            }
        }
    }

    // Fetch opening bank balance to handle session creation properly (so we don't zero-out the bank when opening cash)
    let previousClosingBankBalance: number = 0
    if (!session) {
        const { data: prevSession } = await supabase
            .from('day_book_sessions')
            .select('id, opening_bank_balance')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'closed')
            .lt('date', todayDate)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (prevSession) {
            const { data: prevEntries } = await supabase
                .from('day_book_entries')
                .select('type, amount')
                .eq('session_id', prevSession.id)
                .in('type', ['bank_in', 'bank_out'])

            if (prevEntries) {
                const prevBankIn  = prevEntries.filter(e => e.type === 'bank_in').reduce((s, e) => s + Number(e.amount), 0)
                const prevBankOut = prevEntries.filter(e => e.type === 'bank_out').reduce((s, e) => s + Number(e.amount), 0)
                previousClosingBankBalance = Number(prevSession.opening_bank_balance ?? 0) + prevBankIn - prevBankOut
            }
        }
    }

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
