'use client'

import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { Clock, ShoppingBag, UtensilsCrossed } from 'lucide-react'
import OrderCard from '@/components/ui/OrderCard'
import FeedSection from '@/components/ui/FeedSection'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { useServerState } from '@/lib/hooks/useServerState'

export interface ActiveTableEntry {
    tableId: string
    tableLabel: string
    sessionId: string
    openedAt: string
    orderCount: number
    totalAmount: number
}

interface Props {
    initialEntries: ActiveTableEntry[]
    tablesMap: Record<string, string>
    restaurantId: string
}

export default function ActiveSessionsList({ initialEntries, tablesMap, restaurantId }: Props) {
    const [entries, setEntries] = useServerState<ActiveTableEntry[]>(initialEntries)
    const money = useCurrency()

    useRestaurantTable(restaurantId, 'sessions', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new as { id: string; table_id: string; opened_at: string; status: string }
            if (s.status !== 'active') return
            const tableLabel = tablesMap[s.table_id] ?? '?'
            setEntries(prev => [
                { tableId: s.table_id, tableLabel, sessionId: s.id, openedAt: s.opened_at, orderCount: 0, totalAmount: 0 },
                ...prev,
            ])
        } else if (payload.eventType === 'UPDATE') {
            const s = payload.new as { id: string; status: string }
            if (s.status === 'closed' || s.status === 'expired') {
                setEntries(prev => prev.filter(e => e.sessionId !== s.id))
            }
        }
    })

    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if (payload.eventType === 'INSERT') {
            const o = payload.new as { session_id: string; total_amount: number; status: string }
            if (!['pending', 'confirmed', 'preparing', 'ready'].includes(o.status)) return
            setEntries(prev => prev.map(e =>
                e.sessionId === o.session_id
                    ? { ...e, orderCount: e.orderCount + 1, totalAmount: e.totalAmount + Number(o.total_amount) }
                    : e
            ))
        } else if (payload.eventType === 'UPDATE') {
            const next = payload.new as { session_id: string; total_amount: number; status: string }
            const prev = payload.old as { status: string; total_amount: number }
            if (['delivered', 'cancelled'].includes(next.status) && !['delivered', 'cancelled'].includes(prev.status)) {
                setEntries(es => es.map(e =>
                    e.sessionId === next.session_id
                        ? { ...e, orderCount: Math.max(0, e.orderCount - 1), totalAmount: Math.max(0, e.totalAmount - Number(prev.total_amount)) }
                        : e
                ))
            }
        }
    })

    if (entries.length === 0) return null

    return (
        <FeedSection icon={UtensilsCrossed} title="Active Sessions" count={entries.length} tone="brand">
            {entries.map(entry => (
                <OrderCard
                    key={entry.sessionId}
                    tableLabel={entry.tableLabel}
                    title={`Table ${entry.tableLabel}`}
                    meta={
                        <>
                            <span className="flex items-center gap-1">
                                <Clock size={11} />
                                {timeAgo(entry.openedAt)}
                            </span>
                            {entry.orderCount > 0 && (
                                <span className="flex items-center gap-1">
                                    <ShoppingBag size={11} />
                                    {entry.orderCount} {entry.orderCount === 1 ? 'order' : 'orders'}
                                </span>
                            )}
                        </>
                    }
                    trailing={
                        entry.totalAmount > 0 ? (
                            <span className="text-h3 text-ink tabular">{money(entry.totalAmount)}</span>
                        ) : (
                            <span className="text-caption text-ink-subtle">No orders</span>
                        )
                    }
                />
            ))}
        </FeedSection>
    )
}
