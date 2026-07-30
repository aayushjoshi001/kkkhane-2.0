'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { getStaffActivity, type StaffActivity } from '@/lib/staffActivity'
import { NEPAL_TZ } from '@/lib/utils'

/**
 * Per-staff activity for a business day range, for the manager's report.
 *
 * Dates come in as plain `YYYY-MM-DD` because that is what the picker deals in,
 * and are resolved against Kathmandu rather than the server's zone — this runs
 * in UTC, so reading them literally would shift every boundary 5h45m and put
 * the tail of each evening's trade on the wrong day.
 */

/** Kathmandu midnight at the start of `day`, as an ISO instant. */
function nepalDayStart(day: string): string {
    // Offset is fixed year-round (+05:45), so this needs no zone library.
    return new Date(`${day}T00:00:00+05:45`).toISOString()
}

function todayInNepal(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: NEPAL_TZ })
}

export async function fetchStaffActivity(
    fromDay?: string,
    toDay?: string,
): Promise<{ activity?: StaffActivity[]; from?: string; to?: string; error?: string }> {
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.restaurantId) return { error: 'Unauthorized' }

    // Staff performance is a management view: it names individuals and reports
    // what each of them took in money. A waiter must not be able to read their
    // colleagues' figures, so this is gated regardless of what the UI shows.
    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'Only a manager can view staff activity' }
    }

    const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

    const today = todayInNepal()
    const start = isDay(fromDay) ? fromDay : today
    const end = isDay(toDay) ? toDay : start
    if (end < start) return { error: 'The end of the range cannot be before the start' }

    // `to` is the start of the day AFTER the last one asked for, so the range is
    // half-open and a single day covers its whole 24 hours.
    const endNext = new Date(`${end}T00:00:00+05:45`)
    endNext.setDate(endNext.getDate() + 1)

    try {
        const supabase = await createAdminClient()
        const activity = await getStaffActivity(supabase, currentUser.restaurantId, {
            from: nepalDayStart(start),
            to: endNext.toISOString(),
        })
        return { activity, from: start, to: end }
    } catch (e) {
        console.error('[fetchStaffActivity] failed:', e)
        return { error: e instanceof Error ? e.message : 'Could not load staff activity' }
    }
}
