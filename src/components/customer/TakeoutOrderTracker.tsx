'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder, TakeoutStatus } from '@/types/database'
import { ORDER_STATUS_TO_TAKEOUT, type OrderStatus } from '@/lib/takeout'
import {
    Clock, CheckCircle2, Package, ChefHat, ShoppingBag,
    Phone, MapPin, ArrowLeft, Truck, ShieldCheck
} from 'lucide-react'
import Link from 'next/link'

interface Props {
    orderId: string
    initialOrder: TakeoutOrder
    restaurantSlug: string
}

const STATUS_INDEX: Record<string, number> = {
    placed: 0,
    confirmed: 1,
    preparing: 2,
    ready_for_pickup: 3,
    picked_up: 4,
    cancelled: -1,
}

function CountdownDisplay({ time, isDelivery }: { time: string; isDelivery: boolean }) {
    const calc = useCallback(() => {
        const diff = new Date(time).getTime() - Date.now()
        const mins = Math.round(diff / 60_000)
        if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
        if (mins > 0) return `${mins}m`
        if (mins === 0) return 'now'
        return `${Math.abs(mins)}m ago`
    }, [time])

    const [label, setLabel] = useState(() => calc())

    useEffect(() => {
        const id = setInterval(() => setLabel(calc()), 15_000)
        return () => clearInterval(id)
    }, [calc])

    return (
        <div className="text-center animate-fade-in">
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                {isDelivery ? 'Estimated Delivery in' : 'Estimated Pickup in'}
            </p>
            <p className="text-3xl font-black text-gray-900 mt-1">{label}</p>
            <p className="text-xs text-gray-400 mt-1">
                around {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
        </div>
    )
}

export default function TakeoutOrderTracker({ orderId, initialOrder, restaurantSlug }: Props) {
    const [order, setOrder] = useState<TakeoutOrder>(initialOrder)
    const money = useCurrency()
    const currentStep = STATUS_INDEX[order.status] ?? -1

    const isDelivery = (order as any).order_type === 'delivery'

    const steps = isDelivery ? [
        { status: 'placed' as const, label: 'Order Placed', icon: <ShoppingBag size={18} /> },
        { status: 'confirmed' as const, label: 'Confirmed', icon: <CheckCircle2 size={18} /> },
        { status: 'preparing' as const, label: 'Preparing', icon: <ChefHat size={18} /> },
        { status: 'ready_for_pickup' as const, label: 'Out for Delivery', icon: <Truck size={18} /> },
        { status: 'picked_up' as const, label: 'Delivered', icon: <CheckCircle2 size={18} /> },
    ] : [
        { status: 'placed' as const, label: 'Order Placed', icon: <ShoppingBag size={18} /> },
        { status: 'confirmed' as const, label: 'Confirmed', icon: <CheckCircle2 size={18} /> },
        { status: 'preparing' as const, label: 'Preparing', icon: <ChefHat size={18} /> },
        { status: 'ready_for_pickup' as const, label: 'Ready for Pickup', icon: <Package size={18} /> },
        { status: 'picked_up' as const, label: 'Picked Up', icon: <CheckCircle2 size={18} /> },
    ]

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
                    const row = payload.new as any
                    setOrder((prev) => ({
                        ...prev,
                        status: ORDER_STATUS_TO_TAKEOUT[row.status as OrderStatus] ?? prev.status,
                        confirmed_at: row.confirmed_at ?? prev.confirmed_at,
                        ready_at: row.ready_at ?? prev.ready_at,
                        picked_up_at: row.delivered_at ?? prev.picked_up_at,
                        delivery_verification_code: row.delivery_verification_code ?? (prev as any).delivery_verification_code,
                        delivery_staff_id: row.delivery_staff_id ?? (prev as any).delivery_staff_id,
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
                    <span className="text-3xl text-red-600">✕</span>
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

    return (
        <div className="space-y-5 max-w-xl mx-auto px-4 py-6">
            {/* Order number */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Order Reference</p>
                <p className="text-xl font-mono font-black text-gray-900 mt-1">
                    #{orderId.slice(0, 8).toUpperCase()}
                </p>
            </div>

            {/* Verification Code for Delivery */}
            {isDelivery && (order as any).delivery_verification_code && order.status !== 'picked_up' && (
                <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-5 text-center space-y-1.5 animate-pulse">
                    <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
                        <ShieldCheck size={12} /> Secure Delivery Code
                    </p>
                    <p className="text-3xl font-black font-mono tracking-widest text-blue-700">
                        {(order as any).delivery_verification_code}
                    </p>
                    <p className="text-[10px] text-blue-500 px-4">
                        Please tell this code to the delivery driver to receive your food.
                    </p>
                </div>
            )}

            {/* Countdown */}
            {order.status !== 'picked_up' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                    <CountdownDisplay time={order.pickup_time} isDelivery={isDelivery} />
                </div>
            )}

            {/* Status stepper */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Tracking</h3>
                <div className="space-y-4">
                    {steps.map((step, idx) => {
                        const isComplete = currentStep >= idx
                        const isCurrent = currentStep === idx
                        return (
                            <div key={step.status} className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                    isComplete
                                        ? 'bg-green-55 text-green-600 bg-green-50'
                                        : 'bg-gray-100 text-gray-400'
                                } ${isCurrent ? 'ring-2 ring-green-500 ring-offset-2' : ''}`}>
                                    {step.icon}
                                </div>
                                <div className="flex-1">
                                    <p className={`text-xs font-bold ${isComplete ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {step.label}
                                    </p>
                                    {isCurrent && step.status === 'ready_for_pickup' && (
                                        <p className="text-[10px] text-green-600 font-bold mt-0.5 animate-pulse">
                                            {isDelivery ? 'Driver has collected your food and is on the way!' : 'Your order is ready! Please collect at counter.'}
                                        </p>
                                    )}
                                </div>
                                {isComplete && (
                                    <CheckCircle2 size={15} className="text-green-500 shrink-0" />
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Picked up / Delivered success */}
            {order.status === 'picked_up' && (
                <div className="bg-green-50 rounded-2xl border border-green-200 p-6 text-center">
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 size={24} className="text-green-600" />
                    </div>
                    <h3 className="text-base font-extrabold text-green-800">Order Completed!</h3>
                    <p className="text-xs text-green-600 mt-1">Thank you for ordering with us. Enjoy your meal!</p>
                </div>
            )}

            {/* Order items */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Items</h3>
                <ul className="divide-y divide-gray-100">
                    {items.map((item, idx) => (
                        <li key={idx} className="py-2 flex justify-between text-xs">
                            <span className="text-gray-700">{item.quantity}× {item.name}</span>
                            <span className="font-bold text-gray-900">
                                {money((item.unit_price || item.price || 0) * item.quantity)}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-500">
                        <span>Subtotal</span>
                        <span>{money(order.subtotal_amount)}</span>
                    </div>
                    {order.discount_amount > 0 && (
                        <div className="flex justify-between text-green-600 font-bold">
                            <span>Discount</span>
                            <span>-{money(order.discount_amount)}</span>
                        </div>
                    )}
                    {order.tax_amount > 0 && (
                        <div className="flex justify-between text-gray-500">
                            <span>Tax</span>
                            <span>{money(order.tax_amount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-2.5 border-t border-gray-100">
                        <span className="font-bold text-gray-750">Total</span>
                        <span className="text-base font-extrabold text-gray-900">{money(order.total_amount)}</span>
                    </div>
                </div>
            </div>

            {/* Customer details */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                    {isDelivery ? 'Delivery Details' : 'Pickup Details'}
                </h3>
                <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-gray-600">
                        <Phone size={13} className="text-gray-400" />
                        <span className="font-mono">{order.customer_phone}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                        <Clock size={13} className="text-gray-400" />
                        <span>
                            {isDelivery ? 'Deliver around: ' : 'Pickup around: '}
                            {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    {isDelivery && (order as any).delivery_address && (
                        <div className="flex items-start gap-2 text-gray-600">
                            <MapPin size={13} className="mt-0.5 text-gray-400 shrink-0" />
                            <span>{(order as any).delivery_address}</span>
                        </div>
                    )}
                    {order.customer_note && (
                        <div className="flex items-start gap-2 text-gray-600 bg-gray-50 p-2 rounded-lg">
                            <span className="font-bold text-[10px] text-gray-400 shrink-0 uppercase mt-0.5">Note:</span>
                            <span className="italic">{order.customer_note}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="text-center pb-6">
                <Link
                    href={`/takeout/${restaurantSlug}`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer"
                >
                    <ArrowLeft size={12} /> Order something else
                </Link>
            </div>
        </div>
    )
}
