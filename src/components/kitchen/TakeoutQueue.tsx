'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { updateTakeoutStatus, getTakeoutOrders } from '@/app/api/takeout/actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder } from '@/types/database'
import { Phone, User, CheckCircle2, XCircle, Timer, Package, Bike, MapPin, Loader2 } from 'lucide-react'
import { playKitchenPing } from '@/lib/audio'
import { StatusBadge } from '@/components/ui'

interface TakeoutQueueProps {
    restaurantId: string
    initialOrders: TakeoutOrder[]
}

const STATUS_FLOW: Record<string, { next: string; label: string }> = {
    confirmed: { next: 'preparing', label: 'Start Prep' },
    preparing: { next: 'ready_for_pickup', label: 'Mark Ready' },
    ready_for_pickup: { next: 'picked_up', label: 'Picked Up' },
}

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
        const id = setInterval(() => setInfo(calc()), 15_000)
        return () => clearInterval(id)
    }, [calc])
    return info
}

function CountdownBadge({ pickupTime }: { pickupTime: string }) {
    const { label, overdue } = useCountdown(pickupTime)
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${overdue ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-amber-50 text-amber-600'}`}>
            <Timer size={12} />
            {label}
        </span>
    )
}

export default function TakeoutQueue({ restaurantId, initialOrders }: TakeoutQueueProps) {
    const [orders, setOrders] = useState<TakeoutOrder[]>(initialOrders)
    const money = useCurrency()
    const [loading, setLoading] = useState<string | null>(null)

    useRestaurantTable(restaurantId, 'orders', (payload) => {
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
                <span className="w-7 h-7 rounded-lg bg-[#FFEAD9] flex items-center justify-center">
                    <Package size={15} className="text-[#FB6303]" />
                </span>
                <h2 className="font-extrabold text-gray-900">Takeout &amp; Delivery</h2>
                <span className="text-xs font-extrabold text-white bg-[#FB6303] px-2 py-0.5 rounded-full">{activeOrders.length}</span>
            </div>

            {activeOrders.length === 0 && (
                <p className="text-gray-400 text-center py-8 text-sm">No active takeout or delivery orders.</p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {activeOrders.map((order) => {
                    const flow = STATUS_FLOW[order.status]
                    const items = (order.items as Array<{ name: string; quantity: number }>) || []
                    const isDelivery = order.order_type === 'delivery'
                    const accent = isDelivery ? '#FB6303' : '#6366f1'
                    // The kitchen never marks a delivery "picked up" — that's the delivery feed.
                    const showFlow = flow && !(isDelivery && order.status === 'ready_for_pickup')

                    return (
                        <div key={order.id} className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ borderLeft: `4px solid ${accent}` }}>
                            <div className="p-4 space-y-3 flex-1">
                                {/* Header */}
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-extrabold text-gray-900">#{order.id.slice(0, 4).toUpperCase()}</span>
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                              style={{ background: `${accent}1A`, color: accent }}>
                                            {isDelivery ? <Bike size={10} /> : <Package size={10} />}
                                            {isDelivery ? 'Delivery' : 'Takeout'}
                                        </span>
                                    </div>
                                    <StatusBadge status={order.status} />
                                </div>

                                {/* Pickup countdown (takeout) or address (delivery) */}
                                {isDelivery ? (
                                    order.delivery_address && (
                                        <div className="flex items-start gap-1.5 text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5">
                                            <MapPin size={12} className="text-[#FB6303] shrink-0 mt-0.5" />
                                            <span className="line-clamp-2">{order.delivery_address}</span>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <CountdownBadge pickupTime={order.pickup_time} />
                                        <span className="text-[11px] text-gray-400">
                                            {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                )}

                                {/* Customer */}
                                <div className="space-y-0.5 text-sm">
                                    <div className="flex items-center gap-1.5 text-gray-900 font-semibold">
                                        <User size={14} className="text-gray-400" />
                                        <span className="truncate">{order.customer_name}</span>
                                    </div>
                                    {order.customer_phone && (
                                        <a href={`tel:${order.customer_phone}`} className="flex items-center gap-1.5 text-gray-400 text-xs">
                                            <Phone size={12} /> {order.customer_phone}
                                        </a>
                                    )}
                                </div>


                                {/* Items */}
                                <ul className="text-sm text-gray-500 space-y-0.5 border-t border-gray-100 pt-2">
                                    {items.map((item, idx) => (
                                        <li key={idx}><span className="font-bold text-gray-700">{item.quantity}×</span> {item.name}</li>
                                    ))}
                                </ul>

                                <div className="text-right font-extrabold text-gray-900">{money(order.total_amount)}</div>
                            </div>

                            {/* Actions */}
                            {showFlow && flow && (
                                <div className="flex border-t border-gray-100">
                                    <button
                                        onClick={() => handleStatusChange(order.id, 'cancelled')}
                                        disabled={loading === order.id}
                                        className="flex-1 py-3 text-xs font-bold text-red-500 hover:bg-red-50 flex items-center justify-center gap-1 border-r border-gray-100 transition-colors disabled:opacity-50"
                                    >
                                        <XCircle size={15} /> Cancel
                                    </button>
                                    <button
                                        onClick={() => handleStatusChange(order.id, flow.next)}
                                        disabled={loading === order.id}
                                        className="flex-1 py-3 text-xs font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-50 transition active:scale-[0.99]"
                                        style={{ background: '#FB6303' }}
                                    >
                                        {loading === order.id ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                        {flow.label}
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Completed */}
            {completedOrders.length > 0 && (
                <details className="mt-4">
                    <summary className="text-sm font-semibold text-gray-400 cursor-pointer hover:text-gray-600">
                        Completed / Cancelled ({completedOrders.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                        {completedOrders.slice(0, 20).map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 bg-white rounded-xl border border-gray-100 px-4 py-2 text-sm">
                                <span className="font-mono text-gray-400">#{order.id.slice(0, 8)}</span>
                                <span className="text-gray-700 truncate flex-1">{order.customer_name}</span>
                                <StatusBadge status={order.status} dot={false} />
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    )
}
