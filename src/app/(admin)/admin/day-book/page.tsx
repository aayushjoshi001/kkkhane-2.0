import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import DayBookClient, { DayBookRangeView } from './DayBookClient'
import type { DayBookEntry, DayBookSession } from '@/types/database'
import { getNstDateString } from '@/lib/timezone'
import { resolveActiveDayBookSession, computeDayBookRange, attachCreatorNames, computeCashierBreakdown } from '@/lib/ledger'

import { getRestaurantFeatures } from '@/lib/features'

export const dynamic = 'force-dynamic'

/** `YYYY-MM-DD` and nothing else — this value reaches a date-typed query. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function DayBookPage({
    searchParams,
}: {
    searchParams: Promise<{ date?: string; from?: string; to?: string }>
}) {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    const todayDate = getNstDateString()
    const { date: dateParam, from: fromParam, to: toParam } = await searchParams
    const requestedFrom = fromParam && ISO_DATE.test(fromParam) ? fromParam : null
    const requestedTo = toParam && ISO_DATE.test(toParam) ? toParam : null

    // A genuine multi-day span (from !== to) gets the aggregated statement
    // view instead of one session's detail — everything below this block is
    // unchanged and still drives the single-day view, including for the
    // from=to case a range picker naturally produces when both ends land on
    // the same day.
    if (requestedFrom && requestedTo && requestedFrom !== requestedTo) {
        const range = await computeDayBookRange(supabase, restaurantId, requestedFrom, requestedTo, 'all')
        return <DayBookRangeView range={{ from: requestedFrom, to: requestedTo, ...range }} />
    }

    const requestedDate = requestedFrom ?? requestedTo ?? (dateParam && ISO_DATE.test(dateParam) ? dateParam : null)

    // Cash Book and Bank Book share one Day Book session — this page just
    // reads both sides of it side by side, it never opens/closes the session
    // itself (that stays on Cash Book / Bank Book).
    //
    // Only the default view resolves the *active* session, because that call
    // auto-opens the next day when the last one is closed. Asking for a past
    // date is a read of history and must never have that side effect — it would
    // manufacture a session for a day the restaurant never traded.
    let session: DayBookSession | null
    if (requestedDate) {
        const { data } = await supabase
            .from('day_book_sessions')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('date', requestedDate)
            // Ordered and capped to one row before maybeSingle(), because
            // nothing constrains one session per date — a bare maybeSingle()
            // would throw on a duplicate rather than show the day.
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        session = (data as DayBookSession) ?? null
    } else {
        session = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)
    }

    // The open session can be dated earlier than today if nobody closed it, so
    // the picker follows the session actually on screen rather than the wall
    // clock — otherwise the header names a day whose figures aren't shown.
    const selectedDate = requestedDate ?? session?.date ?? todayDate

    let entries: (DayBookEntry & { created_by_name: string | null })[] = []
    if (session) {
        const { data: entriesData } = await supabase
            .from('day_book_entries')
            .select('*')
            .eq('session_id', session.id)
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

    const byCashier = computeCashierBreakdown(entries)

    return (
        <DayBookClient
            session={session ?? null}
            entries={entries}
            totals={totals}
            byCashier={byCashier}
            todayDate={todayDate}
            selectedDate={selectedDate}
        />
    )
}
