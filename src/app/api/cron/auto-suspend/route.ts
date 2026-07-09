import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { verifyCronRequest } from '@/lib/cron'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/cron/auto-suspend
 * Called daily by Vercel Cron. Suspends restaurants whose subscription has expired.
 * Auth: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
    if (!verifyCronRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()

    // Find restaurants that are:
    //   - active and not yet suspended
    //   - have an expiry date that is now in the past
    //   - not on enterprise (enterprise may have manual billing)
    const now = new Date().toISOString()

    const { data: expired, error: fetchError } = await supabase
        .from('restaurants')
        .select('id, name, subscription_tier, subscription_expires_at')
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
        return Response.json({ message: 'No expired subscriptions', suspended: 0 })
    }

    const ids = expired.map((r) => r.id)

    const { error: updateError } = await supabase
        .from('restaurants')
        .update({
            is_suspended: true,
            subscription_status: 'suspended',
        })
        .in('id', ids)

    if (updateError) {
        console.error('[cron/auto-suspend] update error:', updateError)
        return Response.json({ error: updateError.message }, { status: 500 })
    }

    console.log('[cron/auto-suspend] suspended:', expired.map(r => r.name))

    return Response.json({
        suspended: expired.length,
        restaurants: expired.map(r => ({ id: r.id, name: r.name, expired: r.subscription_expires_at })),
    })
}
