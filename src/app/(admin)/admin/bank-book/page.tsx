import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BankBookClient from './BankBookClient'
import type { DayBookEntry, ExpenseCategory } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'
import { resolveActiveDayBookSession, attachCreatorNames } from '@/lib/ledger'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function BankBookPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    const todayDate = getNstDateString()

    // The currently active session — open (even if still dated a prior
    // calendar day because it hasn't been closed yet), or auto-opened just
    // now carrying forward the last closed session's balances. Only null the
    // very first time this restaurant ever uses the Day Book. Shared with
    // Cash Book — one session governs both cash and bank together.
    const session = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    // For stamping new entries with a name client-side the instant they're
    // added — the row that comes back from POST /api/day-book/entries only
    // has created_by (a uuid), and it's always the acting user, so this
    // avoids a round-trip through attachCreatorNames just to show one name.
    const { data: currentUserRow } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', currentUser.id)
        .maybeSingle()
    const currentUserName = currentUserRow?.full_name ?? null

    // Fetch active bank accounts
    const { data: bankAccounts } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name', { ascending: true })

    const { data: expenseCategories } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name', { ascending: true })

    // Fetch today's entries (if session exists)
    let entries: (DayBookEntry & { created_by_name: string | null })[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
            .in('type', ['bank_in', 'bank_out'])
            .order('created_at', { ascending: false })

        const filtered = ((entriesData as DayBookEntry[]) || []).filter(e => {
            try {
                if (e.description.startsWith('{')) {
                    const parsed = JSON.parse(e.description)
                    if (parsed.status === 'pending_approval') return false
                }
            } catch {}
            return true
        })
        entries = await attachCreatorNames(supabase, filtered)
    }

    // Calculate bank totals
    const totalBankIn  = entries.filter(e => e.type === 'bank_in').reduce((s: number, e: DayBookEntry) => s + Number(e.amount), 0)
    const totalBankOut = entries.filter(e => e.type === 'bank_out').reduce((s: number, e: DayBookEntry) => s + Number(e.amount), 0)
    const openingBankBal = Number(session?.opening_bank_balance ?? 0)

    const initialTotals = {
        total_bank_in:    totalBankIn,
        total_bank_out:   totalBankOut,
        closing_bank_balance: openingBankBal + totalBankIn - totalBankOut,
    }

    // `session` is only ever null on the true first-ever use (no session
    // history at all to carry a balance forward from) — resolveActiveDayBookSession
    // already auto-opens from the last closed session's balances otherwise, so
    // there's nothing to prefill here beyond zero.
    const previousClosingBankBalance: number | null = null
    const previousClosingCashBalance: number = 0

    return (
        <BankBookClient
            initialSession={session ?? null}
            initialEntries={entries}
            initialTotals={initialTotals}
            todayDate={todayDate}
            userRole={currentUser.role}
            currentUserName={currentUserName}
            previousClosingBankBalance={previousClosingBankBalance}
            previousClosingCashBalance={previousClosingCashBalance}
            bankAccounts={bankAccounts || []}
            expenseCategories={(expenseCategories as ExpenseCategory[]) || []}
        />
    )
}
