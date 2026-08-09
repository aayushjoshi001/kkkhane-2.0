import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { verifyCronRequest } from '@/lib/cron'
import { TRIAL_STATUS, POST_TRIAL_TIER } from '@/lib/trial'
import { TIER_LIMITS, applyTierEntitlements, applyTierModuleDefaults, resolveFeatureDefaults } from '@/lib/tiers'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/cron/auto-suspend
 * Called daily by Vercel Cron. Ends subscriptions whose expiry date has passed.
 * Auth: Bearer <CRON_SECRET>
 *
 * Two different endings, and conflating them is the bug this guards against:
 *
 *   - A *paid* subscription that expires is a billing failure. The tenant owes
 *     money, so the venue is suspended until it is settled.
 *   - A *trial* that expires is not. The tenant never owed anything; they simply
 *     stopped being on the trial. Suspending them would lock a prospect out of
 *     their own data on day 15, which is the opposite of what a trial is for.
 *     They drop to Free and carry on.
 *
 * Enterprise is skipped in both cases — it may be billed by hand.
 */
export async function POST(request: NextRequest) {
    if (!verifyCronRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()
    const now = new Date().toISOString()

    // Everything past its expiry date, whichever kind of ending it is owed.
    const { data: expired, error: fetchError } = await supabase
        .from('restaurants')
        .select('id, name, subscription_tier, subscription_status, subscription_expires_at')
        .eq('is_active', true)
        .eq('is_suspended', false)
        .not('subscription_expires_at', 'is', null)
        .lt('subscription_expires_at', now)
        .neq('subscription_tier', 'enterprise')

    if (fetchError) {
        console.error('[cron/auto-suspend] fetch error:', fetchError)
        return Response.json({ error: fetchError.message }, { status: 500 })
    }

    if (!expired || expired.length === 0) {
        return Response.json({ message: 'No expired subscriptions', suspended: 0, downgraded: 0 })
    }

    const lapsedTrials = expired.filter(r => r.subscription_status === TRIAL_STATUS)
    const unpaid = expired.filter(r => r.subscription_status !== TRIAL_STATUS)

    // ── Lapsed trials → Free ────────────────────────────────────────────────
    const downgraded: string[] = []
    if (lapsedTrials.length > 0) {
        const limits = TIER_LIMITS[POST_TRIAL_TIER]

        const { error: downgradeError } = await supabase
            .from('restaurants')
            .update({
                subscription_tier: POST_TRIAL_TIER,
                // Free is a real, active plan ("free forever"), not a lapsed
                // one — leaving the status as 'trialing' would make this row
                // match this same query again tomorrow, forever.
                subscription_status: 'active',
                subscription_expires_at: null,
                max_staff: limits.max_staff,
                max_menu_items: limits.max_menu_items,
                max_tables: limits.max_tables,
            })
            .in('id', lapsedTrials.map(r => r.id))

        if (downgradeError) {
            console.error('[cron/auto-suspend] downgrade error:', downgradeError)
            return Response.json({ error: downgradeError.message }, { status: 500 })
        }

        // The caps above are enforced on write, but the paid *features* live in
        // settings.features_v2 and stay switched on until they are revoked
        // here. Without this a lapsed trial keeps loyalty, accounting and the
        // rest — the plan column would say Free while the app still behaved
        // like Platinum.
        for (const r of lapsedTrials) {
            const { data: settings } = await supabase
                .from('settings')
                .select('features_v2')
                .eq('restaurant_id', r.id)
                .maybeSingle()

            if (settings?.features_v2) {
                const stripped = applyTierModuleDefaults(
                    applyTierEntitlements(
                        resolveFeatureDefaults(settings.features_v2 as Record<string, unknown>),
                        POST_TRIAL_TIER,
                        r.subscription_tier,
                    ),
                    POST_TRIAL_TIER,
                )
                await supabase
                    .from('settings')
                    .update({ features_v2: stripped })
                    .eq('restaurant_id', r.id)
            }

            // getRestaurantFeatures caches per tenant for an hour; without this
            // the downgrade would not be visible until that expired.
            try {
                revalidateTag(`features-${r.id}`, 'max')
            } catch (e) {
                console.warn(`[cron/auto-suspend] revalidate failed for ${r.id}`, e)
            }
            downgraded.push(r.name)
        }
    }

    // ── Unpaid subscriptions → suspended ────────────────────────────────────
    if (unpaid.length > 0) {
        const { error: updateError } = await supabase
            .from('restaurants')
            .update({
                is_suspended: true,
                subscription_status: 'suspended',
            })
            .in('id', unpaid.map(r => r.id))

        if (updateError) {
            console.error('[cron/auto-suspend] update error:', updateError)
            return Response.json({ error: updateError.message }, { status: 500 })
        }
    }

    console.log('[cron/auto-suspend] suspended:', unpaid.map(r => r.name), 'downgraded:', downgraded)

    return Response.json({
        suspended: unpaid.length,
        downgraded: downgraded.length,
        restaurants: unpaid.map(r => ({ id: r.id, name: r.name, expired: r.subscription_expires_at })),
        trialsEnded: lapsedTrials.map(r => ({ id: r.id, name: r.name, expired: r.subscription_expires_at })),
    })
}

// Vercel Cron invokes its schedules with GET. The handler stays POST so a
// manual run reads as the write it is, with GET aliased onto it — without this
// every scheduled run answers 405 and the job silently never happens.
export const GET = POST
