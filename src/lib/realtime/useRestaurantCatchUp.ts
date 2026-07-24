'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeRestaurantReconnect } from './restaurantChannel'

/** Coalesce bursts of reconnects (panel mount subscribes several tables in a row). */
const REFRESH_DEBOUNCE_MS = 300

/**
 * Resync a whole panel from the server whenever the realtime channel
 * (re)connects.
 *
 * Realtime is not a durable log: any event emitted while the socket is down is
 * gone. The shared channel also rebuilds when a component subscribes to a table
 * not yet bound, and every binding is dead for that round trip. Live components
 * that only ever apply deltas therefore drift, and nothing corrects them - the
 * floor counters are literally `setOccupied(n => n + 1)`, so one missed session
 * INSERT is wrong until the page is reloaded by hand.
 *
 * Firing on those rebuilds as well as on true reconnects is deliberate: both
 * lose events, and the channel manager no longer rebuilds when a subscriber
 * goes away, so a rebuild now only happens the first time a panel reaches a
 * given table. That bounds this to a handful of refreshes per session instead
 * of one per tab switch.
 *
 * `router.refresh()` re-runs the route's server components and pushes fresh
 * props down without remounting the client tree, so one call resyncs every live
 * component on the panel at once. Components seed their state with
 * `useState(initialX)`, which ignores later prop values, so each one also needs
 * an effect syncing that prop into state for this to land - see the components
 * that take `initial*` props.
 *
 * Mount once per panel. The very first connect is skipped: the server render
 * that produced the current props just happened, so there is nothing to catch
 * up on.
 */
export function useRestaurantCatchUp(restaurantId: string | undefined | null): void {
    const router = useRouter()
    const seenFirstConnect = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!restaurantId) return

        const unsubscribe = subscribeRestaurantReconnect(restaurantId, () => {
            if (!seenFirstConnect.current) {
                seenFirstConnect.current = true
                return
            }
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
                timer.current = null
                router.refresh()
            }, REFRESH_DEBOUNCE_MS)
        })

        return () => {
            if (timer.current) {
                clearTimeout(timer.current)
                timer.current = null
            }
            unsubscribe()
        }
    }, [restaurantId, router])
}
