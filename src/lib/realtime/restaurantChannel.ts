'use client'

/**
 * Shared, ref-counted Realtime channel manager (one channel per restaurant).
 *
 * Previously every live component opened its own `supabase.channel(...)` — e.g. the
 * kitchen screen alone ran THREE: OrderQueue + KitchenStats both subscribed to the
 * same `orders` rows, and TakeoutQueue to `takeout_orders`. Each binding is a
 * separate server-side `postgres_changes` filter, so order events were evaluated and
 * delivered twice per kitchen tab.
 *
 * This manager keeps a single channel per restaurant with one catch-all binding per
 * table, and fans each payload out to the registered component callbacks. Components
 * subscribe via `useRestaurantTable`; the channel is created on first subscriber and
 * torn down when the last one unmounts.
 */

import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChangePayload = RealtimePostgresChangesPayload<{ [key: string]: any }>
export type RealtimeCallback = (payload: ChangePayload) => void

interface RestaurantEntry {
    channel: RealtimeChannel | null
    tables: Map<string, Set<RealtimeCallback>>
    /** Callbacks fired whenever the channel (re)connects — used for catch-up fetches. */
    reconnectCallbacks: Set<() => void>
    refCount: number
    rebuildTimeout: NodeJS.Timeout | null
}

const registry = new Map<string, RestaurantEntry>()
const supabase = createClient()

/** Build (or rebuild) the channel with a catch-all binding for every active table. */
function buildChannel(restaurantId: string, entry: RestaurantEntry): RealtimeChannel {
    let channel = supabase.channel(`restaurant-rt-${restaurantId}`)

    for (const [table, callbacks] of entry.tables) {
        channel = channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table, filter: `restaurant_id=eq.${restaurantId}` },
            (payload) => {
                // Snapshot to tolerate (un)subscribe during dispatch. Each callback
                // belongs to a different subscribing component, so this loop can
                // easily call setState on component B while component A happens to
                // be mid-render — React flags that as "Cannot update a component
                // while rendering a different component." Deferring each callback
                // to its own microtask guarantees it always runs after whatever
                // synchronous render triggered this event has finished, so no
                // subscriber's update can land inside another's render.
                for (const cb of Array.from(callbacks)) {
                    queueMicrotask(() => {
                        try { cb(payload) } catch { /* one bad listener must not break the rest */ }
                    })
                }
            }
        )
    }

    channel.subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Log actual connection failures/timeouts.
            // CLOSED is normal teardown when a component unmounts or unsubscribes.
            console.error(`[restaurantChannel] restaurant-rt-${restaurantId} ${status}`, err)
        }
        if (status === 'SUBSCRIBED') {
            // Channel connected or reconnected — fire all catch-up callbacks so
            // components can refetch from the DB and recover any missed events.
            // Several waiter-panel components can mount around the same time and
            // each rebuild/resubscribe triggers this once for everyone, so — same
            // reasoning as the postgres_changes dispatch above — each callback is
            // deferred to its own microtask to avoid setState-during-render.
            const e = registry.get(restaurantId)
            if (!e) return
            for (const cb of Array.from(e.reconnectCallbacks)) {
                queueMicrotask(() => {
                    try { cb() } catch { /* one bad callback must not block the rest */ }
                })
            }
        }
    })
    return channel
}

/**
 * Register a callback for INSERT/UPDATE/DELETE on `table`, scoped to the restaurant.
 * Returns an unsubscribe function. Bindings are keyed by table; the standard
 * `restaurant_id=eq.<id>` filter is applied automatically.
 *
 * Pass `onReconnect` to be called whenever the realtime channel (re)connects — use
 * this to do a fresh DB fetch and catch up on events missed during a disconnect.
 */
export function subscribeRestaurantTable(
    restaurantId: string,
    table: string,
    callback: RealtimeCallback,
    onReconnect?: () => void,
): () => void {
    let entry = registry.get(restaurantId)
    if (!entry) {
        entry = { channel: null, tables: new Map(), reconnectCallbacks: new Set(), refCount: 0, rebuildTimeout: null }
        registry.set(restaurantId, entry)
    }

    const isNewTable = !entry.tables.has(table)
    if (isNewTable) entry.tables.set(table, new Set())
    entry.tables.get(table)!.add(callback)
    entry.refCount++

    if (onReconnect) entry.reconnectCallbacks.add(onReconnect)

    if (isNewTable || !entry.channel) {
        if (entry.rebuildTimeout) clearTimeout(entry.rebuildTimeout)
        entry.rebuildTimeout = setTimeout(() => {
            const e = registry.get(restaurantId)
            if (!e) return
            e.rebuildTimeout = null

            const setupChannel = () => {
                e.channel = buildChannel(restaurantId, e)
            }

            if (e.channel) {
                const oldChannel = e.channel
                e.channel = null
                Promise.resolve(supabase.removeChannel(oldChannel))
                    .then(setupChannel)
                    .catch((err) => {
                        console.error('[restaurantChannel] Failed to remove channel:', err)
                        setupChannel()
                    })
            } else {
                setupChannel()
            }
        }, 50)
    }

    return () => {
        const e = registry.get(restaurantId)
        if (!e) return
        const set = e.tables.get(table)
        if (set) {
            set.delete(callback)
            if (set.size === 0) {
                e.tables.delete(table)
                // If a table is removed, we also need to rebuild the channel to remove the listener
                if (e.rebuildTimeout) clearTimeout(e.rebuildTimeout)
                e.rebuildTimeout = setTimeout(() => {
                    const currentEntry = registry.get(restaurantId)
                    if (!currentEntry) return
                    currentEntry.rebuildTimeout = null
                    
                    const setupChannel = () => {
                        if (currentEntry.tables.size > 0) {
                            currentEntry.channel = buildChannel(restaurantId, currentEntry)
                        } else {
                            currentEntry.channel = null
                        }
                    }

                    if (currentEntry.channel) {
                        const oldChannel = currentEntry.channel
                        currentEntry.channel = null
                        Promise.resolve(supabase.removeChannel(oldChannel))
                            .then(setupChannel)
                            .catch((err) => {
                                console.error('[restaurantChannel] Failed to remove channel on unsubscribe:', err)
                                setupChannel()
                            })
                    } else {
                        setupChannel()
                    }
                }, 50)
            }
        }
        if (onReconnect) e.reconnectCallbacks.delete(onReconnect)
        e.refCount = Math.max(0, e.refCount - 1)
        if (e.refCount === 0) {
            if (e.rebuildTimeout) {
                clearTimeout(e.rebuildTimeout)
                e.rebuildTimeout = null
            }
            if (e.channel) {
                supabase.removeChannel(e.channel)
                e.channel = null
            }
            registry.delete(restaurantId)
        }
    }
}
