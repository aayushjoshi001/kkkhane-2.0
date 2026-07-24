'use client'

import type { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'

type SubscribeStatus = `${REALTIME_SUBSCRIBE_STATES}`

/**
 * Status handler for a standalone `supabase.channel(...)` that refetches
 * whenever the socket comes back.
 *
 * The customer-facing trackers each open their own channel and called a bare
 * `.subscribe()` — no status callback at all, so nothing logged a failed
 * connection and nothing recovered from one. Realtime replays no history, so a
 * guest whose phone slept through the kitchen marking their order ready saw
 * "Preparing" until they reloaded, which on a table QR page is not something
 * they would think to do.
 *
 * The first SUBSCRIBED is the initial connect and is skipped — the server
 * render that seeded the component just happened. Every later one means the
 * channel dropped and came back, so state is refetched from the DB.
 *
 * Catch-up should apply state silently: replaying the toast and sound for a
 * status the guest was already shown is worse than saying nothing.
 */
export function catchUpOnResubscribe(
    label: string,
    onCatchUp: () => void,
): (status: SubscribeStatus, err?: Error) => void {
    let seenFirstConnect = false

    return (status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[realtime] ${label} ${status}`, err)
            return
        }
        if (status !== 'SUBSCRIBED') return
        if (!seenFirstConnect) {
            seenFirstConnect = true
            return
        }
        onCatchUp()
    }
}
