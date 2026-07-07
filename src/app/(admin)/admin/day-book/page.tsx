import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import DayBookClient from './DayBookClient'

export const dynamic = 'force-dynamic'

export default async function DayBookPage() {
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
            .order('created_at', { ascending: false })
        entries = entriesData || []
    }

    // Calculate totals
    const totalCashIn  = entries.filter(e => e.type === 'cash_in').reduce((s: number, e: any) => s + Number(e.amount), 0)
    const totalCashOut = entries.filter(e => e.type === 'cash_out').reduce((s: number, e: any) => s + Number(e.amount), 0)
    const openingBal   = Number(session?.opening_balance ?? 0)
    const initialTotals = {
        total_cash_in:    totalCashIn,
        total_cash_out:   totalCashOut,
        closing_balance:  openingBal + totalCashIn - totalCashOut,
    }

    // Get yesterday's closing balance (for auto carry-over on first open)
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
            .single()

        if (prevSession) {
            // Calculate its closing balance
            const { data: prevEntries } = await supabase
                .from('day_book_entries')
                .select('type, amount')
                .eq('session_id', prevSession.id)

            if (prevEntries) {
                const prevIn  = prevEntries.filter(e => e.type === 'cash_in').reduce((s, e) => s + Number(e.amount), 0)
                const prevOut = prevEntries.filter(e => e.type === 'cash_out').reduce((s, e) => s + Number(e.amount), 0)
                previousClosingBalance = Number(prevSession.opening_balance) + prevIn - prevOut
            }
        }
    }

    return (
        <DayBookClient
            initialSession={session ?? null}
            initialEntries={entries}
            initialTotals={initialTotals}
            todayDate={todayDate}
            userRole={currentUser.role}
            previousClosingBalance={previousClosingBalance}
        />
    )
}
