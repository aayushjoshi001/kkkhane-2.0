'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { updateTakeoutStatus, getTakeoutOrders } from '@/app/api/takeout/actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder } from '@/types/database'
import { Phone, User, CheckCircle2, XCircle, Timer, Package } from 'lucide-react'
import { playKitchenPing } from '@/lib/audio'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'

interface TakeoutQueueProps {
    restaurantId: string
    initialOrders: TakeoutOrder[]
}

const STATUS_FLOW: Record<string, { next: string; label: string }> = {
    confirmed: { next: 'preparing', label: 'Start Prep' },
    preparing: { next: 'ready_for_pickup', label: 'Mark Ready' },
    ready_for_pickup: { next: 'picked_up', label: 'Picked Up' },
}

/** Returns a live "Due in Xm" / "Overdue Xm" string for a pickup_time */
function useCountdown(pickupTime: string) {
    const calc = useCallback(() => {
        const diff = new Date(pickupTime).getTime() - Date.now()
        const mins = Math.round(diff / 60_000)
        if (mins > 60) return { label: `Due in ${Math.floor(mins / 60)}h ${mins % 60}m`, overdue: false }
        if (mins > 0) return { label: `Due in ${mins}m`, overdue: false }
        if (mins === 0) return { label: 'Due now', overdue: false }
        return { label: `Overdue ${Math.abs(mins)}m`, overdue: true }
    }, [pickupTime])

    const [info, setInfo] = useState(() => calc())

    useEffect(() => {
        const id = setInterval(() => setInfo(calc()), 15_000) // update every 15s
        return () => clearInterval(id)
    }, [calc])

    return info
}

/** Small countdown badge rendered per order card */
function CountdownBadge({ pickupTime }: { pickupTime: string }) {
    const { label, overdue } = useCountdown(pickupTime)
    return (
        <span className={`inline-flex items-center gap-1 text-caption font-semibold px-2 py-1 rounded-full ${overdue ? 'bg-danger-bg text-danger-fg animate-pulse' : 'bg-warning-bg text-warning-fg'}`}>
            <Timer size={12} />
            {label}
        </span>
    )
}

export default function TakeoutQueue({ restaurantId, initialOrders }: TakeoutQueueProps) {
    const [orders, setOrders] = useState<TakeoutOrder[]>(initialOrders)
    const money = useCurrency()
    const [loading, setLoading] = useState<string | null>(null)

    // Takeout now lives in the unified `orders` table. On any takeout-order
    // change, refetch the mapped list (keeps the TakeoutOrder shape intact).
    useRestaurantTable(restaurantId, 'orders', (payload) => {
        // Takeout + delivery share this kitchen queue; ignore only dine-in.
        if ((payload.new as { order_type?: string } | null)?.order_type === 'dine_in') return

        // Only play kitchen ping when a confirmed order is received
        if (payload.eventType === 'INSERT') {
            const status = (payload.new as { status?: string } | null)?.status
            if (status === 'confirmed') playKitchenPing()
        } else if (payload.eventType === 'UPDATE') {
            const oldStatus = (payload.old as { status?: string } | null)?.status
            const newStatus = (payload.new as { status?: string } | null)?.status
            if (oldStatus === 'pending' && newStatus === 'confirmed') playKitchenPing()
        }

        getTakeoutOrders(restaurantId).then(setOrders).catch(() => {})
    })

    async function handleStatusChange(orderId: string, newStatus: string) {
        setLoading(orderId)
        await updateTakeoutStatus(orderId, newStatus as 'confirmed' | 'preparing' | 'ready_for_pickup' | 'picked_up' | 'cancelled')
        setLoading(null)
    }

    const activeOrders = orders.filter((o) => !['picked_up', 'cancelled'].includes(o.status))
    const completedOrders = orders.filter((o) => ['picked_up', 'cancelled'].includes(o.status))

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Package size={16} className="text-dark-muted" />
                <h2 className="text-h3 text-dark-ink">Takeout Orders</h2>
                <span className="rounded-full bg-surface/10 px-2 py-0.5 text-caption font-semibold text-dark-ink tabular">{activeOrders.length}</span>
            </div>

            {activeOrders.length === 0 && (
                <p className="text-dark-muted text-center py-8 text-small">No active takeout orders.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeOrders.map((order) => {
                    const flow = STATUS_FLOW[order.status]
                    const items = (order.items as Array<{ name: string; quantity: number }>) || []

                    return (
                        <div key={order.id} className="bg-dark-surface rounded-card border border-dark-border overflow-hidden">
                            <div className="p-4 space-y-3">
                                {/* Header */}
                                <div className="flex items-center justify-between">
                                    <span className="font-mono text-small font-bold text-dark-ink">
                                        #{order.id.slice(0, 8).toUpperCase()}
                                    </span>
                                    <StatusBadge status={order.status} />
                                </div>

                                {/* Countdown Timer */}
                                <div className="flex items-center justify-between">
                                    <CountdownBadge pickupTime={order.pickup_time} />
                                    <span className="text-caption text-dark-muted tabular">
                                        Pickup: {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>

                                {/* Customer */}
                                <div className="space-y-1 text-small">
                                    <div className="flex items-center gap-1.5 text-dark-ink">
                                        <User size={14} className="text-dark-muted" />
                                        <span>{order.customer_name}</span>
                                    </div>
                                </div>


                                {/* Items */}
                                <ul className="text-small text-dark-muted space-y-0.5 border-t border-dark-border pt-2">
                                    {items.map((item, idx) => (
                                        <li key={idx}><span className="tabular text-dark-ink">{item.quantity}×</span> {item.name}</li>
                                    ))}
                                </ul>

                                <div className="text-right text-h3 text-dark-ink tabular">
                                    {money(order.total_amount)}
                                </div>
                            </div>

                            {/* Actions */}
                            {flow && (
                                <div className="flex border-t border-dark-border">
                                    <button
                                        onClick={() => handleStatusChange(order.id, 'cancelled')}
                                        disabled={loading === order.id}
                                        className="flex-1 py-3 text-small font-medium text-danger hover:bg-danger/10 flex items-center justify-center gap-1 border-r border-dark-border transition-colors disabled:opacity-50"
                                    >
                                        <XCircle size={16} /> Cancel
                                    </button>
                                    <Button
                                        variant="primary"
                                        size="md"
                                        icon={CheckCircle2}
                                        loading={loading === order.id}
                                        onClick={() => handleStatusChange(order.id, flow.next)}
                                        className="flex-1 rounded-none"
                                    >
                                        {flow.label}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Completed */}
            {completedOrders.length > 0 && (
                <details className="mt-6">
                    <summary className="text-small font-medium text-dark-muted cursor-pointer hover:text-dark-ink">
                        Completed / Cancelled ({completedOrders.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                        {completedOrders.slice(0, 20).map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 bg-surface/5 rounded-[var(--r-md)] px-4 py-2 text-small">
                                <span className="font-mono text-dark-muted">#{order.id.slice(0, 8)}</span>
                                <span className="text-dark-ink truncate flex-1">{order.customer_name}</span>
                                <StatusBadge status={order.status} dot={false} />
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    )
}
