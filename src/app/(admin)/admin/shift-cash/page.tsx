import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { getRestaurantFeatures } from '@/lib/features'
import { getNstDateString, isValidDateString, addDays } from '@/lib/timezone'
import { computeShiftCashBreakdown } from '@/lib/shiftCash'
import ShiftCashClient, { ShiftCashRow } from './ShiftCashClient'

export const dynamic = 'force-dynamic'

export default async function ShiftCashPage({
    searchParams,
}: {
    searchParams: Promise<{ from?: string; to?: string }>
}) {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.staffShiftsEnabled) redirect('/admin/dashboard')

    const todayDate = getNstDateString()
    const { from: fromParam, to: toParam } = await searchParams
    const from = fromParam && isValidDateString(fromParam) ? fromParam : todayDate
    const to = toParam && isValidDateString(toParam) ? toParam : from

    // Convert local NST calendar dates into UTC range
    const rangeStart = new Date(`${from}T00:00:00+05:45`).toISOString()
    const rangeEnd = new Date(`${addDays(to, 1)}T00:00:00+05:45`).toISOString()

    const supabase = await createAdminClient()

    // 1. Fetch official shifts in date range OR currently active shifts
    const { data: shiftsData } = await supabase
        .from('staff_shifts')
        .select('*, users!staff_shifts_user_id_fkey(full_name), reconciledBy:users!cash_reconciled_by(full_name)')
        .eq('restaurant_id', restaurantId)
        .or(`and(clock_in.gte.${rangeStart},clock_in.lt.${rangeEnd}),clock_out.is.null`)
        .order('clock_in', { ascending: false })

    const rawShifts = shiftsData || []
    const seenShiftKeys = new Set<string>()
    const shifts: typeof rawShifts = []

    for (const s of rawShifts) {
        const key = `${s.user_id}_${s.clock_in}_${s.clock_out}`
        if (seenShiftKeys.has(key)) continue
        seenShiftKeys.add(key)
        shifts.push(s)
    }

    const coveredUserIds = new Set(shifts.map(s => s.user_id))

    // 2. Fetch any day_book_entries for this restaurant in date range to catch
    // payments created by staff members who did not have an active staff_shifts row
    const { data: unmappedEntries } = await supabase
        .from('day_book_entries')
        .select('created_by, created_at, users:users!created_by(full_name)')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', rangeStart)
        .lt('created_at', rangeEnd)
        .order('created_at', { ascending: true })

    // Group unmapped entries into distinct shift sessions for each user.
    // A gap of > 30 minutes between billing transactions starts a NEW virtual shift box!
    interface UnmappedSession {
        id: string
        userId: string
        staffName: string
        minTime: string
        maxTime: string
    }

    const unmappedSessions: UnmappedSession[] = []
    const userActiveSessionMap = new Map<string, UnmappedSession>()

    for (const e of unmappedEntries || []) {
        if (!e.created_by || coveredUserIds.has(e.created_by)) continue
        const staffName = (e.users as { full_name?: string } | null)?.full_name || 'Staff'
        const existing = userActiveSessionMap.get(e.created_by)
        const entryTime = new Date(e.created_at).getTime()

        if (!existing) {
            const sess: UnmappedSession = {
                id: `unmapped-${e.created_by}-${unmappedSessions.length}`,
                userId: e.created_by,
                staffName,
                minTime: e.created_at,
                maxTime: e.created_at,
            }
            unmappedSessions.push(sess)
            userActiveSessionMap.set(e.created_by, sess)
        } else {
            const lastTime = new Date(existing.maxTime).getTime()
            const diffMinutes = (entryTime - lastTime) / (1000 * 60)

            if (diffMinutes > 30) {
                // Gap is > 30 minutes -> Start a NEW separate shift box for this login/billing session!
                const newSess: UnmappedSession = {
                    id: `unmapped-${e.created_by}-${unmappedSessions.length}`,
                    userId: e.created_by,
                    staffName,
                    minTime: e.created_at,
                    maxTime: e.created_at,
                }
                unmappedSessions.push(newSess)
                userActiveSessionMap.set(e.created_by, newSess)
            } else {
                existing.maxTime = e.created_at
            }
        }
    }

    // Build list of all shift records (official + virtual for unclocked staff)
    const combinedShifts = [
        ...shifts.map(s => ({
            id: s.id,
            user_id: s.user_id,
            staffName: (s.users as { full_name?: string } | null)?.full_name || 'Unknown',
            clock_in: s.clock_in,
            clock_out: s.clock_out,
            cash_reconciled_at: s.cash_reconciled_at,
            reconciledByName: (s.reconciledBy as { full_name?: string } | null)?.full_name || null,
            expected_cash_amount: s.expected_cash_amount,
            counted_cash_amount: s.counted_cash_amount,
            cash_variance: s.cash_variance,
        })),
        ...unmappedSessions.map((sess) => ({
            id: sess.id,
            user_id: sess.userId,
            staffName: sess.staffName,
            clock_in: sess.minTime,
            clock_out: sess.maxTime !== sess.minTime ? sess.maxTime : null as string | null,
            cash_reconciled_at: null as string | null,
            reconciledByName: null as string | null,
            expected_cash_amount: null as number | null,
            counted_cash_amount: null as number | null,
            cash_variance: null as number | null,
        })),
    ].sort((a, b) => new Date(b.clock_in).getTime() - new Date(a.clock_in).getTime())

    const rows: ShiftCashRow[] = await Promise.all(
        combinedShifts.map(async (s) => {
            const windowEnd = s.clock_out ?? (to === todayDate ? new Date().toISOString() : rangeEnd)
            const breakdown = await computeShiftCashBreakdown(
                supabase,
                restaurantId,
                s.user_id,
                s.clock_in,
                windowEnd
            )

            const expected = breakdown.totalExpected
            const counted = s.cash_reconciled_at ? Number(s.counted_cash_amount) || 0 : null
            const variance = counted != null ? Math.round((counted - expected) * 100) / 100 : null

            return {
                id: s.id,
                staffName: s.staffName,
                clockIn: s.clock_in,
                clockOut: s.clock_out,
                expected,
                counted,
                variance,
                reconciledAt: s.cash_reconciled_at,
                reconciledByName: s.reconciledByName,
                breakdown,
            }
        })
    )

    // Filter to ONLY show shift boxes with activity (transactions, check-ins, check-outs, sales, reconciliation, or active ongoing shift)
    const activeRows = rows.filter(r => {
        const b = r.breakdown
        if (!b) return true

        const hasTransactions = (b.items?.length || 0) > 0
        const hasCheckIns = (b.metrics?.roomCheckIns?.length || 0) > 0
        const hasCheckOuts = (b.metrics?.roomCheckOuts?.length || 0) > 0
        const hasRestaurantSales = (b.metrics?.restaurantSalesTotal || 0) > 0
        const hasRoomSales = (b.metrics?.roomSalesTotal || 0) > 0
        const isReconciled = r.reconciledAt != null
        const isCurrentlyActive = r.clockOut == null

        return hasTransactions || hasCheckIns || hasCheckOuts || hasRestaurantSales || hasRoomSales || isReconciled || isCurrentlyActive
    })

    return (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-xl border border-hairline-strong shadow-sm">
                <h1 className="text-2xl font-bold text-ink">Shift Cash Collection</h1>
                <p className="text-ink-subtle mt-1">
                    Expected cash+QR to collect for each shift — count what was actually handed over, and review all advance, room, and dine-in billing payments received.
                </p>
            </div>
            {/* Keyed by the date range so a range change remounts the client
                component with fresh state — its rows/expanded-row state are
                seeded from props via useState, which React would otherwise
                keep stale across a same-instance re-render after navigating
                to a new ?from=&to=. */}
            <ShiftCashClient key={`${from}_${to}`} rows={activeRows} from={from} to={to} />
        </div>
    )
}
