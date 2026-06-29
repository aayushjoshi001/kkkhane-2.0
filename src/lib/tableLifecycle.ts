import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mark the table behind a (just-closed) session as dirty so it enters the
 * clean-up flow, and clear any stale cleaning claim so the next waiter starts
 * fresh. Called from every session-close path (cash collected, payment verified,
 * waiter closes manually) — kept in the action layer rather than a DB trigger to
 * match this project's avoidance of empty-search_path trigger pitfalls.
 *
 * Best-effort: never throws, so it can't fail a payment/close.
 */
export async function markTableDirtyForSession(admin: SupabaseClient, sessionId: string) {
    try {
        const { data: session } = await admin
            .from('sessions')
            .select('table_id')
            .eq('id', sessionId)
            .maybeSingle()
        if (!session?.table_id) return
        await admin
            .from('tables')
            .update({ table_status: 'dirty', cleaning_claimed_by: null, cleaning_claimed_at: null })
            .eq('id', session.table_id)
    } catch (err) {
        console.error('[markTableDirtyForSession] failed:', err)
    }
}
