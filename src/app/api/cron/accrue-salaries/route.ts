import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { computeMonthlyAccrualPreview, insertAccruals } from '@/lib/payroll'
import { verifyCronRequest, getActiveRestaurants } from '@/lib/cron'
import { NST_OFFSET_MS } from '@/lib/timezone'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/cron/accrue-salaries
 * Runs daily (same NST-midnight slot as generate-eod-reports) but only does work
 * on the 1st of the NST month, when it accrues last month's salary for every
 * active staff member across every restaurant — prorated for anyone hired mid-month.
 * Auth: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
    if (!verifyCronRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only run the accrual on the 1st day of the NST month.
    const nowNst = new Date(Date.now() + NST_OFFSET_MS)
    if (nowNst.getUTCDate() !== 1) {
        return Response.json({ message: 'Not the 1st of the month (NST), skipping', accrued: 0 })
    }

    // Accrue for the month that just ended
    const isJanuary = nowNst.getUTCMonth() === 0
    const year = isJanuary ? nowNst.getUTCFullYear() - 1 : nowNst.getUTCFullYear()
    const month = isJanuary ? 12 : nowNst.getUTCMonth() // getUTCMonth() is 0-indexed, so this is already "previous month" as 1-12

    const supabase = await createAdminClient()

    const { data: restaurants, error: fetchError } = await getActiveRestaurants(supabase)

    if (fetchError) {
        console.error('[cron/accrue-salaries] fetch error:', fetchError)
        return Response.json({ error: fetchError.message }, { status: 500 })
    }

    if (!restaurants || restaurants.length === 0) {
        return Response.json({ message: 'No active restaurants', accrued: 0 })
    }

    const results = await Promise.allSettled(
        restaurants.map(async (restaurant) => {
            const preview = await computeMonthlyAccrualPreview(supabase, restaurant.id, year, month)
            const pending = preview.filter(p => !p.isProcessed && p.computedAmount > 0)
            const { inserted } = await insertAccruals(
                supabase,
                restaurant.id,
                year,
                month,
                pending.map(p => ({ userId: p.userId, amount: p.computedAmount, note: p.note }))
            )
            return { restaurantId: restaurant.id, name: restaurant.name, accrued: inserted }
        })
    )

    const succeeded = results.filter(
        (r): r is PromiseFulfilledResult<{ restaurantId: string; name: string; accrued: number }> => r.status === 'fulfilled'
    )
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    if (failed.length > 0) {
        console.error('[cron/accrue-salaries] failures:', failed.map(f => f.reason?.message || f.reason))
    }

    const totalAccrued = succeeded.reduce((sum, r) => sum + r.value.accrued, 0)

    return Response.json({
        year,
        month,
        restaurantsProcessed: restaurants.length,
        totalAccrued,
        failures: failed.length,
    })
}

// Vercel Cron invokes its schedules with GET. The handler stays POST so a
// manual run reads as the write it is, with GET aliased onto it — without this
// every scheduled run answers 405 and the job silently never happens.
export const GET = POST
