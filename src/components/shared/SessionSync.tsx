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
                const { data } = await supabase
                    .from('users')
                    .select('is_active')
                    .eq('id', userId)
                    .maybeSingle()

                if (!data) {
                    await supabase.auth.signOut()
                    router.replace('/login')
                    return
                }
                if (data.is_active === false) {
                    await supabase.auth.signOut()
                    router.replace('/login?deactivated=1')
                    return
                }
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
