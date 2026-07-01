'use client'

import { useEffect, useRef } from 'react'
import { subscribeRestaurantTable, type RealtimeCallback } from './restaurantChannel'

/**
 * Subscribe a component to live changes on a table, scoped to the restaurant, via the
 * shared per-restaurant channel. Branch on `payload.eventType` ('INSERT' | 'UPDATE' |
 * 'DELETE') inside the handler.
 *
 * The handler may close over fresh state each render without re-subscribing — only
 * `restaurantId`/`table` drive the subscription lifecycle.
 *
 * Pass `onReconnect` to trigger a catch-up DB fetch whenever the realtime channel
 * (re)connects — essential for recovering orders missed during a disconnect.
 */
export function useRestaurantTable(
    restaurantId: string | undefined | null,
    table: string,
    handler: RealtimeCallback,
    onReconnect?: () => void,
): void {
    const handlerRef = useRef(handler)
    const reconnectRef = useRef(onReconnect)
    // Keep the latest handler in a ref (updated after render) so the subscription
    // doesn't need to re-subscribe when the handler identity changes each render.
    useEffect(() => {
        handlerRef.current = handler
        reconnectRef.current = onReconnect
    })

    useEffect(() => {
        if (!restaurantId) return
        const unsubscribe = subscribeRestaurantTable(
            restaurantId,
            table,
            (payload) => { handlerRef.current(payload) },
            reconnectRef.current ? () => reconnectRef.current?.() : undefined,
        )
        return unsubscribe
    }, [restaurantId, table])
}

