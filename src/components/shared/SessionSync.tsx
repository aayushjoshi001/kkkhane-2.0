'use client'

import { catchUpOnResubscribe } from '@/lib/realtime/channelCatchUp'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Notifies this tab within seconds when an admin changes THIS user's role,
 * restaurant, or active status, or deletes the account — closing the gap
 * where such changes were otherwise invisible until the JWT naturally
 * expired (~1hr) or the user manually logged out/in. Relies on public.users
 * being in the supabase_realtime publication with REPLICA IDENTITY FULL
 * (see migration 20260702120000_realtime_users_session_sync.sql) so
 * `payload.old` is populated and we can tell a role/restaurant change from
 * an unrelated column update (e.g. a name edit).
 */
export default function SessionSync({ userId }: { userId: string }) {
    const router = useRouter()

    useEffect(() => {
        const supabase = createClient()

        const channel = supabase
            .channel(`user-sync-${userId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
                async (payload) => {
                    const oldRow = payload.old as { role_id?: number; restaurant_id?: string | null }
                    const newRow = payload.new as { is_active?: boolean; role_id?: number; restaurant_id?: string | null }

                    if (newRow.is_active === false) {
                        await supabase.auth.signOut()
                        router.replace('/login?deactivated=1')
                        return
                    }

                    if (newRow.role_id !== oldRow.role_id || newRow.restaurant_id !== oldRow.restaurant_id) {
                        // Re-mint the JWT so the new role/restaurant claims land, then
                        // let getOptionalUser()/ROLE_LANDING route to the correct page
                        // rather than hardcoding a role_id → path map here.
                        await supabase.auth.refreshSession()
                        router.refresh()
                        router.replace('/')
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
                async () => {
                    await supabase.auth.signOut()
                    router.replace('/login')
                }
            )
            .subscribe(catchUpOnResubscribe(`user-sync-${userId}`, async () => {
                // A deactivation or role change that landed while the socket was
                // down would otherwise never be noticed — the account stays
                // signed in with stale claims until the tab is closed.
                const { data, error } = await supabase
                    .from('users')
                    .select('is_active')
                    .eq('id', userId)
                    .maybeSingle()

                // Only ever sign out on a definite "this account is disabled".
                // A failed query and a missing row both leave the session alone:
                // this runs right after a reconnect, when a transient failure is
                // most likely, and forcing a sign-out on one would kick every
                // logged-in member of staff out over a momentary blip. A row
                // that has genuinely been deleted is still caught by the DELETE
                // handler above and by server-side auth on the next request.
                if (error) {
                    console.error(`[realtime] user-sync-${userId} catch-up failed`, error)
                    return
                }
                if (data?.is_active === false) {
                    await supabase.auth.signOut()
                    router.replace('/login?deactivated=1')
                    return
                }
                if (!data) return

                // Role/restaurant may have moved; re-mint the claims and let the
                // server decide where this user now belongs.
                await supabase.auth.refreshSession()
                router.refresh()
            }))

        return () => {
            supabase.removeChannel(channel)
        }
    }, [userId, router])

    return null
}
