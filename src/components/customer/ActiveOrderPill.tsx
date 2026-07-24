'use client'

import { catchUpOnResubscribe } from '@/lib/realtime/channelCatchUp'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChefHat, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useActiveOrders, trackHref, type ActiveOrder } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { getTrackedOrderStatuses } from '@/lib/actions/orderStatus'

const TERMINAL = new Set(['delivered', 'cancelled'])

const STATUS_LABEL: Record<string, string> = {
    pending: 'Order received',
    confirmed: 'Confirmed',
    preparing: 'Cooking now',
    ready: 'Ready!',
}

/**
 * Floating pill that returns the guest to their active order's tracking page.
 * Shows on customer menu/home pages for both dine-in and takeout; self-clears
 * when the order reaches a terminal status. Hidden on the tracking page itself.
 */
export default function ActiveOrderPill() {
    const orders = useHydratedStore(useActiveOrders, (s) => s.orders) || []
    const removeActiveOrder = useActiveOrders((s) => s.removeActiveOrder)
    const pathname = usePathname()
    const [statusById, setStatusById] = useState<Record<string, string>>({})

    const ids = orders.map((o) => o.id)
    const idsKey = ids.join(',')

    useEffect(() => {
        if (ids.length === 0) return
        let cancelled = false

        // One-shot fetch — covers orders that changed status (or were deleted)
        // while this pill wasn't mounted. Live changes after this are covered by
        // the realtime subscription below, not by re-polling.
        getTrackedOrderStatuses(ids).then((rows) => {
            if (cancelled) return
            const map: Record<string, string> = {}
            for (const r of rows) {
                map[r.id] = r.status
                if (TERMINAL.has(r.status)) removeActiveOrder(r.id)
            }
            // An id with no row anymore (deleted) → stop tracking it.
            for (const id of ids) if (!(id in map)) removeActiveOrder(id)
            setStatusById(map)
        }).catch(() => {
            /* transient — the realtime subscription below still covers live changes */
        })

        // Realtime filters only support a single equality check, so each tracked
        // order (capped at 5 by getTrackedOrderStatuses) gets its own binding on
        // one shared channel — same postgres_changes pattern OrderTracker.tsx
        // uses for the full-page order tracker, just fanned out across ids.
        const supabase = createClient()
        const channel = supabase.channel(`active-order-pill:${idsKey}`)
        for (const id of ids) {
            channel.on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
                (payload) => {
                    if (cancelled) return
                    const row = payload.new as { id: string; status: string }
                    if (TERMINAL.has(row.status)) {
                        removeActiveOrder(row.id)
                        setStatusById((prev) => {
                            const next = { ...prev }
                            delete next[row.id]
                            return next
                        })
                        return
                    }
                    setStatusById((prev) => ({ ...prev, [row.id]: row.status }))
                }
            )
        }
        channel.subscribe(catchUpOnResubscribe(`active-order-pill:${idsKey}`, async () => {
            const { data } = await supabase.from('orders').select('id, status').in('id', ids)
            if (cancelled || !data) return
            for (const row of data as Array<{ id: string; status: string }>) {
                if (TERMINAL.has(row.status)) removeActiveOrder(row.id)
            }
            setStatusById(Object.fromEntries(
                (data as Array<{ id: string; status: string }>)
                    .filter((row) => !TERMINAL.has(row.status))
                    .map((row) => [row.id, row.status])
            ))
        }))

        return () => { cancelled = true; supabase.removeChannel(channel) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey])

    // Most recent non-terminal order that we're not already viewing.
    const active: ActiveOrder | undefined = orders.find((o) => {
        const s = statusById[o.id]
        const onItsPage = pathname?.includes(`/order/${o.id}`)
        return !onItsPage && (s === undefined || !TERMINAL.has(s))
    })

    if (!active) return null
    const label = STATUS_LABEL[statusById[active.id] ?? ''] ?? 'Order in progress'

    return (
        <Link
            href={trackHref(active)}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 bg-[var(--color-secondary)] text-white pl-3.5 pr-3 py-2.5 rounded-full shadow-lg shadow-black/20 active:scale-95 transition animate-scale-in max-w-[92vw]"
        >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-400" />
            </span>
            <ChefHat size={16} className="shrink-0" />
            <span className="text-sm font-bold truncate min-w-0">{label} · View order</span>
            <ChevronRight size={16} className="shrink-0 opacity-80" />
        </Link>
    )
}
