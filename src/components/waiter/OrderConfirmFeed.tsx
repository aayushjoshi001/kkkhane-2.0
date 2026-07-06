'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { confirmOrder, rejectOrder } from '@/app/(staff)/waiter/order-actions'
import { playNewOrder } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import FeedSection from '@/components/ui/FeedSection'
import TableChip from '@/components/ui/TableChip'
import EmptyState from '@/components/ui/EmptyState'
import { ClipboardCheck, Check, X, Clock } from 'lucide-react'
import type { Order, OrderItem } from '@/types/database'

export type ConfirmOrder = Order & {
    sessions?: { tables?: { label?: string } }
    order_items?: (OrderItem & { menu_items?: { name?: string } })[]
}

const ORDER_SELECT = `
  id, status, total_amount, placed_at, customer_note, needs_confirmation,
  sessions ( tables ( label ) ),
  order_items ( id, quantity, status, menu_items ( name ) )
` as const

const REJECT_REASONS = ['Customer not at table', 'Duplicate order', 'Customer left', 'Other']

export default function OrderConfirmFeed({ initialOrders, restaurantId }: {
    initialOrders: ConfirmOrder[]
    restaurantId: string
    userId: string
    staffNames?: Record<string, string>
}) {
    const [orders, setOrders] = useState<ConfirmOrder[]>(initialOrders)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [rejecting, setRejecting] = useState<ConfirmOrder | null>(null)
    const money = useCurrency()
    const supabaseRef = useRef(createClient())

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        if ((payload.new as { order_type?: string } | null)?.order_type === 'takeout') return
        const needsConfirmation = (payload.new as { needs_confirmation?: boolean } | null)?.needs_confirmation === true

        if (payload.eventType === 'INSERT') {
            if (!needsConfirmation) return
            const { data } = await supabaseRef.current.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const order = data as unknown as ConfirmOrder
            let isNew = false
            setOrders(prev => {
                if (prev.some(o => o.id === order.id)) return prev
                isNew = true
                return [order, ...prev]
            })
            if (!isNew) return
            playNewOrder().catch(() => {})
            playVoice('waiter_new_order')
            navigator.vibrate?.(300)
            const tbl = order.sessions?.tables?.label
            toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-xl px-4 py-3 flex items-start gap-3 border-2 border-amber-300`}>
                    <span className="text-xl mt-0.5">📝</span>
                    <div>
                        <p className="font-bold text-sm text-amber-700">Confirm Order?</p>
                        <p className="text-xs text-ink-subtle mt-0.5">{tbl ? `Table ${tbl}` : 'Order'} · {money(order.total_amount)}</p>
                    </div>
                </div>
            ), { duration: 8000, position: 'top-right' })
        } else if (payload.eventType === 'UPDATE') {
            // Confirmed or rejected (here or by another waiter) → it leaves this list.
            if (!needsConfirmation || payload.new.status === 'cancelled') {
                setOrders(prev => prev.filter(o => o.id !== payload.new.id))
            }
        }
    })

    const handleConfirm = async (orderId: string) => {
        setBusyId(orderId)
        setOrders(prev => prev.filter(o => o.id !== orderId))
        const res = await confirmOrder(orderId)
        if (res?.error) {
            toast.error(res.conflict ? 'Already handled by someone else' : 'Could not confirm')
        } else {
            toast.success('Order confirmed → kitchen')
        }
        setBusyId(null)
    }

    const handleReject = async (order: ConfirmOrder, reason: string) => {
        setBusyId(order.id)
        setRejecting(null)
        setOrders(prev => prev.filter(o => o.id !== order.id))
        const res = await rejectOrder(order.id, reason)
        if (res?.error) {
            toast.error(res.conflict ? 'Already handled by someone else' : 'Could not reject')
        } else {
            toast.success('Order rejected')
        }
        setBusyId(null)
    }

    if (orders.length === 0) {
        return (
            <FeedSection icon={ClipboardCheck} title="Orders to Confirm">
                <Card padding={24}>
                    <EmptyState icon={ClipboardCheck} title="Nothing to confirm" description="New orders will appear here for you to confirm before the kitchen starts." />
                </Card>
            </FeedSection>
        )
    }

    return (
        <>
            <FeedSection icon={ClipboardCheck} title="Orders to Confirm" count={orders.length} tone="warning">
                <div className="grid gap-3">
                    {orders.map(order => {
                        const tbl = order.sessions?.tables?.label || '?'
                        return (
                            <Card key={order.id} padding={false} className="border-warning/30">
                                <div className="p-4 md:p-5">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <TableChip label={tbl} size="lg" />
                                            <span className="text-small text-ink-subtle flex items-center gap-1.5">
                                                <Clock size={12} /> {timeAgo(order.placed_at)}
                                            </span>
                                        </div>
                                        <span className="text-display text-ink">{money(order.total_amount)}</span>
                                    </div>

                                    <div className="bg-surface-muted rounded-[var(--r-md)] p-3 mb-4">
                                        <ul className="space-y-1.5 text-body">
                                            {(order.order_items || []).map(item => (
                                                <li key={item.id} className="flex items-center gap-3 text-ink">
                                                    <span className="font-bold text-ink-muted w-6 text-right tabular">{item.quantity}×</span>
                                                    <span className="font-medium">{item.menu_items?.name}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {order.customer_note && (
                                        <p className="text-small text-ink-subtle italic mb-4">&ldquo;{order.customer_note}&rdquo;</p>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            variant="secondary"
                                            icon={X}
                                            onClick={() => setRejecting(order)}
                                            disabled={busyId === order.id}
                                            className="text-danger-fg border-danger/30 hover:bg-danger-bg"
                                        >
                                            Reject
                                        </Button>
                                        <Button
                                            variant="primary"
                                            icon={Check}
                                            loading={busyId === order.id}
                                            onClick={() => handleConfirm(order.id)}
                                        >
                                            Confirm
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            </FeedSection>

            {/* Reject reason picker */}
            {rejecting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setRejecting(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-semibold text-ink">Reject — Table {rejecting.sessions?.tables?.label || '?'}</h3>
                            <button onClick={() => setRejecting(null)} className="text-ink-muted hover:text-ink"><X size={18} /></button>
                        </div>
                        <div className="p-4 space-y-2">
                            <p className="text-small text-ink-subtle mb-1">Why are you rejecting this order?</p>
                            {REJECT_REASONS.map(reason => (
                                <button
                                    key={reason}
                                    onClick={() => handleReject(rejecting, reason)}
                                    className="w-full text-left px-4 py-3 rounded-[var(--r-md)] border border-hairline hover:bg-surface-muted text-body text-ink font-medium transition-colors"
                                >
                                    {reason}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
