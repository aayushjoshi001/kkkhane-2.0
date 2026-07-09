import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

type SupabaseAdminClient = Awaited<ReturnType<typeof createAdminClient>>

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when
// CRON_SECRET is set as an env var. Shared by every /api/cron/* route.
export function verifyCronRequest(request: NextRequest): boolean {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    return !!cronSecret && authHeader === `Bearer ${cronSecret}`
}

// Restaurants eligible for automated cron work: active and not suspended.
export async function getActiveRestaurants(supabase: SupabaseAdminClient) {
    return supabase
        .from('restaurants')
        .select('id, name')
        .eq('is_active', true)
        .eq('is_suspended', false)
}
