'use client'

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
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [userId, router])

    return null
}
