import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createAdminClient()

    // No restaurant id: refreshes every tenant's pairings in one set-based pass.
    const { error } = await supabase.rpc('refresh_menu_item_pairings')

    if (error) {
        console.error('[cron/refresh-item-pairings] error:', error)
        return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ refreshed: true })
}
