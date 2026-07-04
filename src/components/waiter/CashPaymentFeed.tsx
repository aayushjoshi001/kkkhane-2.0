'use client'

import { useState, useEffect } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markCashPaid } from '@/app/(staff)/waiter/order-actions'
import { Banknote, CheckCircle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { FeedSection, OrderCard, Button } from '@/components/ui'

export interface UnpaidOrder {
    id: string
    total_amount: number
    delivered_at: string | null
    session_id: string | null
    sessions?: { id: string; tables?: { label?: string } | null } | null
}

export default function CashPaymentFeed({
    initialOrders,
    restaurantId,
    onPendingCountChange,
}: {
    initialOrders: UnpaidOrder[]
    restaurantId: string
    onPendingCountChange?: (count: number) => void
}) {
    const [orders, setOrders] = useState<UnpaidOrder[]>(initialOrders)
    const money = useCurrency()
    const [processingId, setProcessingId] = useState<string | null>(null)

    useEffect(() => {
        onPendingCountChange?.(orders.length)
    }, [orders.length, onPendingCountChange])

    // Remove from local list when an order gets paid via any path (realtime)
    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if (payload.eventType !== 'UPDATE') return
        if (payload.new.payment_status === 'paid') {
            setOrders((prev) => prev.filter((o) => o.id !== payload.new.id))
        }
        // Also pick up newly delivered+unpaid orders
        if (payload.new.status === 'delivered' && payload.new.payment_status === 'unpaid') {
            setOrders((prev) => {
                if (prev.some(o => o.id === payload.new.id)) return prev
                return [...prev, payload.new as unknown as UnpaidOrder]
            })
        }
    })

    const handleCashPaid = async (orderId: string) => {
        setProcessingId(orderId)
        const res = await markCashPaid(orderId)
        if (res.error) {
            toast.error(res.error)
        } else {
            setOrders((prev) => prev.filter((o) => o.id !== orderId))
            toast.success(res.tableClosed ? 'Cash received — table closed ✅' : 'Cash received ✓')
        }
        setProcessingId(null)
    }

    if (orders.length === 0) return null

    return (
        <FeedSection icon={Banknote} title="Pending Cash Payments" count={orders.length} tone="warning">
            {orders.map((order) => {
                const tableLabel = order.sessions?.tables?.label
                const isProcessing = processingId === order.id
                return (
                    <OrderCard
                        key={order.id}
                        tableLabel={tableLabel || 'TO'}
                        title={tableLabel ? `Table ${tableLabel}` : 'Takeout'}
                        meta={order.delivered_at ? <span>Delivered {timeAgo(order.delivered_at)}</span> : undefined}
                        trailing={
                            <div className="flex flex-col items-end gap-2">
                                <span className="text-h3 text-ink tabular">{money(order.total_amount)}</span>
                                <Button variant="primary" size="sm" icon={CheckCircle} loading={isProcessing} onClick={() => handleCashPaid(order.id)}>
                                    I'm Going to Collect
                                </Button>
                            </div>
                        }
                    />
                )
            })}
        </FeedSection>
    )
}
