import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BankBookClient from './BankBookClient'

export const dynamic = 'force-dynamic'

export default async function BankBookPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Today's date in YYYY-MM-DD
    const todayDate = new Date().toISOString().split('T')[0]

    // Fetch today's session (if exists)
    const { data: session } = await supabase
        .from('day_book_sessions')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('date', todayDate)
        .single()

    // Fetch today's entries (if session exists)
    let entries: any[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
            .in('type', ['bank_in', 'bank_out'])
            .order('created_at', { ascending: false })
        entries = entriesData || []
    }

    // Calculate bank totals
    const totalBankIn  = entries.filter(e => e.type === 'bank_in').reduce((s: number, e: any) => s + Number(e.amount), 0)
    const totalBankOut = entries.filter(e => e.type === 'bank_out').reduce((s: number, e: any) => s + Number(e.amount), 0)
    const openingBankBal = Number(session?.opening_bank_balance ?? 0)

    const initialTotals = {
        total_bank_in:    totalBankIn,
        total_bank_out:   totalBankOut,
        closing_bank_balance: openingBankBal + totalBankIn - totalBankOut,
    }

    // Get yesterday's closing bank balance (for auto carry-over on first open)
    let previousClosingBankBalance: number | null = null
    if (!session) {
        // Find the most recent closed session
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
            // Calculate its closing bank balance
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

    // Fetch opening cash balance to handle session creation properly (so we don't zero-out the cash when opening bank)
    let previousClosingCashBalance: number = 0
    if (!session) {
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
            const { data: prevEntries } = await supabase
                .from('day_book_entries')
                .select('type, amount')
                .eq('session_id', prevSession.id)
                .in('type', ['cash_in', 'cash_out'])

            if (prevEntries) {
                const prevIn  = prevEntries.filter(e => e.type === 'cash_in').reduce((s, e) => s + Number(e.amount), 0)
                const prevOut = prevEntries.filter(e => e.type === 'cash_out').reduce((s, e) => s + Number(e.amount), 0)
                previousClosingCashBalance = Number(prevSession.opening_balance) + prevIn - prevOut
            }
        }
    }

    return (
        <BankBookClient
            initialSession={session ?? null}
            initialEntries={entries}
            initialTotals={initialTotals}
            todayDate={todayDate}
            userRole={currentUser.role}
            previousClosingBankBalance={previousClosingBankBalance}
            previousClosingCashBalance={previousClosingCashBalance}
        />
    )
}
