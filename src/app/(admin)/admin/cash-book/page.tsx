import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashBookClient from './CashBookClient'
import type { BankAccount, DayBookEntry, ExpenseCategory, Supplier } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'
import { resolveActiveDayBookSession, attachCreatorNames } from '@/lib/ledger'

import { getRestaurantFeatures } from '@/lib/features'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Wallet } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CashBookPage() {
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
    // very first time this restaurant ever uses the Day Book.
    const session = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    const { data: expenseCategories } = await supabase
        .from('expense_categories')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name', { ascending: true })

    const { data: bankAccounts } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('name', { ascending: true })

    const { data: staff } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('full_name', { ascending: true })

    const { data: suppliers } = await supabase
        .from('suppliers')
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
            .in('type', ['cash_in', 'cash_out'])
            .order('created_at', { ascending: false })
        entries = await attachCreatorNames(supabase, (entriesData as DayBookEntry[]) || [])
    }

    // Stamped onto a newly-added entry client-side the instant it's created —
    // the API response only carries created_by (a uuid) and it's always the
    // acting user, so this is cheaper than a round-trip through
    // attachCreatorNames just to show one name. staff already carries it.
    const currentUserName = (staff || []).find(u => u.id === currentUser.id)?.full_name ?? null

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
        <div className="space-y-6">
            <PremiumPageHeader title="Cash Book" description="Record and review cash register movements and daily cash flow." icon={<Wallet size={18} />} color="orange" />
            <CashBookClient
                initialSession={session ?? null}
                initialEntries={entries}
                initialTotals={initialTotals}
                todayDate={todayDate}
                userRole={currentUser.role}
                currentUserName={currentUserName}
                previousClosingBalance={previousClosingBalance}
                previousClosingBankBalance={previousClosingBankBalance}
                expenseCategories={(expenseCategories as ExpenseCategory[]) || []}
                bankAccounts={(bankAccounts as BankAccount[]) || []}
                staffList={staff || []}
                suppliers={(suppliers as Supplier[]) || []}
            />
        </div>
    )
}
