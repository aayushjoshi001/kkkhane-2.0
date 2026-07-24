'use client'

import { useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { completeTakeoutOrder, getTakeoutOrders } from '@/app/api/takeout/actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder } from '@/types/database'
import { Phone, User, Clock, CreditCard, Package } from 'lucide-react'
import { playOrderReady } from '@/lib/audio'
import FeedSection from '@/components/ui/FeedSection'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { useServerState } from '@/lib/hooks/useServerState'

interface Props {
    initialOrders: TakeoutOrder[]
    restaurantId: string
}

export default function WaiterTakeoutFeed({ initialOrders, restaurantId }: Props) {
    const [orders, setOrders] = useServerState<TakeoutOrder[]>(initialOrders)
    const money = useCurrency()
    const [loading, setLoading] = useState<string | null>(null)

    // Takeout lives in the unified `orders` table. Refetch the ready-for-pickup
    // list on any takeout change; ping when a new one becomes ready.
    useRestaurantTable(restaurantId, 'orders', (payload) => {
        const row = payload.new as { order_type?: string; status?: string } | null
        if (row?.order_type !== 'takeout') return
        const becameReady = row.status === 'ready'
        getTakeoutOrders(restaurantId, 'ready_for_pickup')
            // Delivery orders share the takeout pipeline but are handled in the
            // delivery feed, not this pickup feed — keep takeaway only here.
            .then((all) => all.filter((o) => o.order_type !== 'delivery'))
            .then((ready) => {
                setOrders((prev) => {
                    if (becameReady && ready.length > prev.length) playOrderReady().catch(() => {})
                    return ready
                })
            })
            .catch(() => {})
    })

    async function handleComplete(orderId: string) {
        setLoading(orderId)
        const result = await completeTakeoutOrder(orderId)
        if (!result.error) {
            setOrders((prev) => prev.filter((o) => o.id !== orderId))
        }
        setLoading(null)
    }

    if (orders.length === 0) {
        return null // Don't show section if no ready takeout orders
    }

    return (
        <FeedSection icon={Package} title="Takeout Pickups" count={orders.length} tone="success">
            <div className="grid gap-2.5 sm:grid-cols-2">
                {orders.map((order) => {
                    const items = (order.items as Array<{ name: string; quantity: number }>) || []
                    return (
                        <Card key={order.id} padding={false} className="p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-mono text-small font-bold text-ink">
                                    #{order.id.slice(0, 8).toUpperCase()}
                                </span>
                                <StatusBadge status="ready_for_pickup" />
                            </div>

                            <div className="space-y-1 text-small mb-3">
                                <div className="flex items-center gap-1.5 text-ink">
                                    <User size={14} className="text-ink-subtle" />
                                    <span className="font-medium">{order.customer_name}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-ink-muted">
                                    <Phone size={14} className="text-ink-subtle" />
                                    <span>{order.customer_phone}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-ink-muted">
                                    <Clock size={14} className="text-ink-subtle" />
                                    <span>Pickup: {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                            </div>

                            <ul className="text-small text-ink-muted space-y-0.5 mb-3 border-t border-hairline pt-2">
                                {items.map((item, idx) => (
                                    <li key={idx}><span className="tabular">{item.quantity}×</span> {item.name}</li>
                                ))}
                            </ul>

                            <div className="flex items-center justify-between gap-3">
                                <span className="text-h3 text-ink tabular">
                                    {money(order.total_amount)}
                                </span>
                                <Button
                                    size="sm"
                                    icon={CreditCard}
                                    loading={loading === order.id}
                                    onClick={() => handleComplete(order.id)}
                                >
                                    Paid &amp; Collected
                                </Button>
                            </div>
                        </Card>
                    )
                })}
            </div>
        </FeedSection>
    )
}
