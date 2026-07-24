'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'

/**
 * Make a server-rendered panel live by refreshing it when the tables it renders
 * change.
 *
 * The admin panels are server components that query and aggregate on the
 * server; none of them subscribed to anything, so a manager watching the rooms
 * grid or the orders list saw nothing until they navigated or reloaded. Porting
 * each one to a delta-patching client component would mean duplicating those
 * queries client-side and re-deriving every total - a lot of surface area for
 * screens a handful of managers look at.
 *
 * Instead this subscribes to the relevant tables and calls `router.refresh()`,
 * which re-runs the server component and streams down new markup. One source of
 * truth, no duplicated query logic.
 *
 * Changes are coalesced: a busy dinner service emits order events continuously
 * and each refresh re-runs the panel's whole query set, so `debounceMs` bounds
 * how often that can happen. Raise it for expensive panels (the dashboard runs
 * a dozen aggregates), lower it for cheap ones that should feel immediate.
 */
export default function RealtimeRefresh({
    restaurantId,
    tables,
    debounceMs = 1000,
}: {
    restaurantId: string | undefined | null
    tables: string[]
    debounceMs?: number
}) {
    const router = useRouter()
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const schedule = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            timer.current = null
            router.refresh()
        }, debounceMs)
    }

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current)
    }, [])

    return (
        <>
            {tables.map((table) => (
                <TableWatcher key={table} restaurantId={restaurantId} table={table} onChange={schedule} />
            ))}
        </>
    )
}

/**
 * One subscription per table. Split into its own component because
 * `useRestaurantTable` is a hook and the table list is dynamic - calling it in a
 * loop would break the rules of hooks if the list ever changed length.
 */
function TableWatcher({
    restaurantId,
    table,
    onChange,
}: {
    restaurantId: string | undefined | null
    table: string
    onChange: () => void
}) {
    useRestaurantTable(restaurantId, table, onChange)
    return null
}
