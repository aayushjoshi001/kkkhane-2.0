'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder, TakeoutStatus } from '@/types/database'
import { ORDER_STATUS_TO_TAKEOUT, type OrderStatus } from '@/lib/takeout'
import {
    Clock, CheckCircle2, Package, ChefHat, ShoppingBag,
    Phone, MapPin, ArrowLeft
} from 'lucide-react'
import Link from 'next/link'

interface Props {
    orderId: string
    initialOrder: TakeoutOrder
    restaurantSlug: string
}

const STEPS: { status: TakeoutStatus; label: string; icon: React.ReactNode }[] = [
    { status: 'placed', label: 'Order Placed', icon: <ShoppingBag size={20} /> },
    { status: 'confirmed', label: 'Confirmed', icon: <CheckCircle2 size={20} /> },
    { status: 'preparing', label: 'Preparing', icon: <ChefHat size={20} /> },
    { status: 'ready_for_pickup', label: 'Ready for Pickup', icon: <Package size={20} /> },
    { status: 'picked_up', label: 'Picked Up', icon: <CheckCircle2 size={20} /> },
]

const STATUS_INDEX: Record<string, number> = {
    placed: 0,
    confirmed: 1,
    preparing: 2,
    ready_for_pickup: 3,
    picked_up: 4,
    cancelled: -1,
}

function CountdownDisplay({ pickupTime }: { pickupTime: string }) {
    const calc = useCallback(() => {
        const diff = new Date(pickupTime).getTime() - Date.now()
        const mins = Math.round(diff / 60_000)
        if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
        if (mins > 0) return `${mins}m`
        if (mins === 0) return 'now'
        return `${Math.abs(mins)}m ago`
    }, [pickupTime])

    const [label, setLabel] = useState(() => calc())

    useEffect(() => {
        const id = setInterval(() => setLabel(calc()), 15_000)
        return () => clearInterval(id)
    }, [calc])

    return (
        <div className="text-center">
            <p className="text-sm text-gray-500">Estimated pickup in</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{label}</p>
            <p className="text-xs text-gray-400 mt-1">
                at {new Date(pickupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
        </div>
    )
}

export default function TakeoutOrderTracker({ orderId, initialOrder, restaurantSlug }: Props) {
    const [order, setOrder] = useState<TakeoutOrder>(initialOrder)
    const money = useCurrency()
    const currentStep = STATUS_INDEX[order.status] ?? -1

    // Realtime subscription for status updates
    useEffect(() => {
        const supabase = createClient()

        const channel = supabase
            .channel(`takeout-${orderId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'orders',
                    filter: `id=eq.${orderId}`,
                },
                (payload) => {
                    // The orders row carries order_status + timestamps; keep the
                    // items snapshot from current state and remap the status.
                    const row = payload.new as {
                        status: OrderStatus
                        confirmed_at: string | null
                        ready_at: string | null
                        delivered_at: string | null
                    }
                    setOrder((prev) => ({
                        ...prev,
                        status: ORDER_STATUS_TO_TAKEOUT[row.status] ?? prev.status,
                        confirmed_at: row.confirmed_at ?? prev.confirmed_at,
                        ready_at: row.ready_at ?? prev.ready_at,
                        picked_up_at: row.delivered_at ?? prev.picked_up_at,
                    }))
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [orderId])

    const items = (order.items as unknown as Array<{ name: string; quantity: number; unit_price?: number; price?: number }>) || []

    if (order.status === 'cancelled') {
        return (
            <div className="text-center py-12">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">✕</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Order Cancelled</h2>
                <p className="text-gray-500 mb-6">
                    Order #{orderId.slice(0, 8).toUpperCase()} has been cancelled.
                </p>
                <Link
                    href={`/takeout/${restaurantSlug}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                >
                    <ArrowLeft size={14} /> Order again
                </Link>
            </div>
        )
    }

    const isDelivery = order.order_type === 'delivery'

    return (
        <div className="space-y-6">
            {/* Order number */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
                <p className="text-sm text-gray-500">{isDelivery ? 'Delivery Order' : 'Order'}</p>
                <p className="text-2xl font-mono font-bold text-gray-900 mt-1">
                    #{orderId.slice(0, 8).toUpperCase()}
                </p>
            </div>

            {/* Delivery verification code — customer reads this to the rider */}
            {isDelivery && order.delivery_verification_code && (
                <div className="bg-[#FB6303] text-white rounded-2xl shadow-sm p-6 text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-white/80">Delivery Code</p>
                    <p className="text-4xl font-black font-mono tracking-[0.3em] mt-2">{order.delivery_verification_code}</p>
                    <p className="text-xs text-white/80 mt-2">Share this code with the delivery person on arrival.</p>
                    {order.delivery_address && (
                        <p className="text-[11px] text-white/70 mt-3 border-t border-white/20 pt-2">{order.delivery_address}</p>
                    )}
                </div>
            )}

            {/* Countdown — pickup orders only */}
            {!isDelivery && order.status !== 'picked_up' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <CountdownDisplay pickupTime={order.pickup_time} />
                </div>
            )}

            {/* Status stepper */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Order Status</h3>
                <div className="space-y-4">
                    {STEPS.map((step, idx) => {
                        const isComplete = currentStep >= idx
                        const isCurrent = currentStep === idx
                        return (
                            <div key={step.status} className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                    isComplete
                                        ? 'bg-green-100 text-green-600'
                                        : 'bg-gray-100 text-gray-400'
                                } ${isCurrent ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
                                    {step.icon}
                                </div>
                                <div className="flex-1">
                                    <p className={`text-sm font-medium ${isComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {step.label}
                                    </p>
                                    {isCurrent && step.status === 'ready_for_pickup' && (
                                        <p className="text-xs text-green-600 font-medium mt-0.5">
                                            Your order is ready! Come pick it up.
                                        </p>
                                    )}
                                </div>
                                {isComplete && (
                                    <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Picked up success */}
            {order.status === 'picked_up' && (
                <div className="bg-green-50 rounded-2xl border border-green-200 p-6 text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={32} className="text-green-600" />
                    </div>
                    <h3 className="text-lg font-bold text-green-800">Order Complete!</h3>
                    <p className="text-sm text-green-600 mt-1">Thank you for your order. Enjoy your meal!</p>
                </div>
            )}

            {/* Order items */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Your Items ({items.reduce((t, i) => t + i.quantity, 0)})
                </h3>
                <ul className="divide-y divide-gray-100">
                    {items.map((item, idx) => (
                        <li key={idx} className="py-2 flex justify-between text-sm">
                            <span className="text-gray-700">{item.quantity}× {item.name}</span>
                            <span className="font-medium text-gray-900">
                                {money((item.unit_price || item.price || 0) * item.quantity)}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                    <div className="flex justify-between text-sm text-gray-500">
                        <span>Subtotal</span>
                        <span>{money(order.subtotal_amount)}</span>
                    </div>
                    {order.discount_amount > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                            <span>Discount</span>
                            <span>-{money(order.discount_amount)}</span>
                        </div>
                    )}
                    {order.tax_amount > 0 && (
                        <div className="flex justify-between text-sm text-gray-500">
                            <span>Tax</span>
                            <span>{money(order.tax_amount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                        <span className="font-medium text-gray-700">Total</span>
                        <span className="text-lg font-bold text-gray-900">{money(order.total_amount)}</span>
                    </div>
                </div>
            </div>

            {/* Customer info */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Pickup Details</h3>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                        <Phone size={14} />
                        <span>{order.customer_phone}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Clock size={14} />
                        <span>Pickup at {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {order.customer_note && (
                        <div className="flex items-start gap-2 text-gray-600">
                            <MapPin size={14} className="mt-0.5" />
                            <span>{order.customer_note}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Order again link */}
            <div className="text-center pb-6">
                <Link
                    href={`/takeout/${restaurantSlug}`}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                >
                    <ArrowLeft size={14} /> Order something else
                </Link>
            </div>
        </div>
    )
}
