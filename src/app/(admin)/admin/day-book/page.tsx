import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import DayBookClient from './DayBookClient'
import type { DayBookEntry } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'
import { resolveActiveDayBookSession } from '@/lib/ledger'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function DayBookPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    const todayDate = getNstDateString()

    // Cash Book and Bank Book share one Day Book session — this page just
    // reads both sides of it side by side, it never opens/closes the session
    // itself (that stays on Cash Book / Bank Book).
    const session = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    let entries: DayBookEntry[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
            .order('created_at', { ascending: false })

        entries = ((entriesData as DayBookEntry[]) || []).filter(e => {
            try {
                if (e.description.startsWith('{')) {
                    const parsed = JSON.parse(e.description)
                    if (parsed.status === 'pending_approval') return false
                }
            } catch {}
            return true
        })
    }

    const sum = (type: DayBookEntry['type']) => entries.filter(e => e.type === type).reduce((s, e) => s + Number(e.amount), 0)
    const totalCashIn  = sum('cash_in')
    const totalCashOut = sum('cash_out')
    const totalBankIn  = sum('bank_in')
    const totalBankOut = sum('bank_out')

    const openingCashBal = Number(session?.opening_balance ?? 0)
    const openingBankBal = Number(session?.opening_bank_balance ?? 0)

    const totals = {
        total_cash_in:  totalCashIn,
        total_cash_out: totalCashOut,
        total_bank_in:  totalBankIn,
        total_bank_out: totalBankOut,
        total_money_in:  totalCashIn + totalBankIn,
        total_money_out: totalCashOut + totalBankOut,
        closing_cash_balance: openingCashBal + totalCashIn - totalCashOut,
        closing_bank_balance: openingBankBal + totalBankIn - totalBankOut,
        opening_cash_balance: openingCashBal,
        opening_bank_balance: openingBankBal,
    }

    return (
        <DayBookClient
            session={session ?? null}
            entries={entries}
            totals={totals}
            todayDate={todayDate}
        />
    )
}
