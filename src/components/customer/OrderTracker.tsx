'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { playStatusUpdate } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { CheckCircle, Clock, ChefHat, Package, PartyPopper, ChevronLeft, MapPin } from 'lucide-react'
import type { Order, OrderItem, MenuItem, OrderItemModifier } from '@/types/database'
import Confetti from '@/components/customer/Confetti'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import OrderPaymentSection from './OrderPaymentSection'
import OrderSplitBillSection from './OrderSplitBillSection'
import FeedbackPrompt from './FeedbackPrompt'

type OrderWithItems = Order & {
    order_items?: (OrderItem & {
        menu_items?: Partial<MenuItem>
        order_item_modifiers?: OrderItemModifier[]
    })[]
}

const STEPS = [
    { id: 'pending',   label: 'Order Confirmed', sub: 'We received your order', icon: Clock,  hint: 'Waiting for kitchen to confirm…', time: 'Just now' },
    { id: 'confirmed', label: 'Confirmed',       sub: 'Kitchen has accepted',   icon: CheckCircle,  hint: 'Kitchen has received your order.', time: '1 min ago' },
    { id: 'preparing', label: 'Preparing',       sub: 'Chef is cooking',        icon: ChefHat,      hint: 'The chef is preparing your food.', time: '2 mins ago' },
    { id: 'ready',     label: 'Ready to Serve',  sub: 'Almost at your table!',  icon: Package,      hint: 'Your order is ready! A waiter is bringing it.', time: 'Ready' },
    { id: 'delivered', label: 'Delivered',       sub: 'Enjoy your meal!',       icon: PartyPopper,  hint: 'Enjoy your meal! 🍽️', time: 'Delivered' },
]

const STATUS_TOAST: Record<string, { emoji: string; message: string }> = {
    confirmed: { emoji: '✓', message: 'Order confirmed by kitchen!' },
    preparing: { emoji: '👨‍🍳', message: 'Kitchen is preparing your food…' },
    ready:     { emoji: '🎉', message: 'Your order is ready!' },
    delivered: { emoji: '🍽️', message: 'Order delivered. Enjoy!' },
    cancelled: { emoji: '✕', message: 'Order has been cancelled.' },
}

export default function OrderTracker({
    orderId,
    initialOrder,
    tableLabel,
    features,
    restaurantInfo,
    tableSlug,
}: {
    orderId: string
    initialOrder: OrderWithItems
    tableLabel: string
    features: any
    restaurantInfo: any
    tableSlug: string
}) {
    const [order, setOrder] = useState<OrderWithItems>(initialOrder)
    const money = useCurrency()
    const [showConfetti, setShowConfetti] = useState(() => ['pending', 'confirmed'].includes(initialOrder.status))
    const [showSuccessScreen, setShowSuccessScreen] = useState(true)
    const [showPayment, setShowPayment] = useState(false)
    const supabaseRef = useRef(createClient())
    const router = useRouter()

    useEffect(() => {
        const supabase = supabaseRef.current
        const channel = supabase
            .channel(`order:${orderId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
                (payload) => {
                    const newStatus = (payload.new as Order).status
                    setOrder((prev) => ({ ...prev, ...(payload.new as Order) }))
                    const info = newStatus ? STATUS_TOAST[newStatus] : null
                    if (info) {
                        playStatusUpdate().catch(() => {})
                        if (newStatus === 'preparing') {
                            playVoice('customer_order_preparing')
                        } else if (newStatus === 'ready') {
                            playVoice('customer_order_ready')
                        }
                        toast.custom((t) => (
                            <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3 border border-gray-100`}>
                                <span className="text-2xl">{info.emoji}</span>
                                <p className="text-sm font-semibold text-gray-800">{info.message}</p>
                            </div>
                        ), { duration: 5000, position: 'top-center' })
                    }
                }
            )
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [orderId])

    useEffect(() => {
        if (showConfetti) {
            const timer = setTimeout(() => setShowConfetti(false), 5000)
            return () => clearTimeout(timer)
        }
    }, [showConfetti])

    const isCancelled = order.status === 'cancelled'
    const currentStepIndex = STEPS.findIndex(s => s.id === order.status)
    const isDelivered = order.status === 'delivered'
    const preparationMin = order.order_items?.reduce(
        (max, item) => Math.max(max, item.menu_items?.preparation_min ?? 0),
        0
    ) || 0

    if (showSuccessScreen) {
        return (
            <div className="flex flex-col min-h-screen bg-[#FFF8F3] text-[#1A1006] font-sans select-none pb-12">
                {showConfetti && <Confetti />}

                {/* Top Orange Section */}
                <div className="bg-[#FB6303] pt-12 pb-16 px-4 text-white text-center relative overflow-hidden shrink-0 rounded-b-[40px] shadow-lg">
                    <div className="absolute top-0 right-0 w-36 h-36 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/2" />
                    
                    {/* Circle Checkmark Icon */}
                    <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg mx-auto mb-4 animate-scale-in">
                        <div className="w-16 h-16 rounded-full border-4 border-[#FB6303] flex items-center justify-center">
                            <CheckCircle size={28} className="text-[#FB6303] fill-white" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-black tracking-wide">🎉 Order Placed! 🎉</h1>
                    <p className="text-white/80 text-xs font-semibold mt-1">Sit back and relax — the kitchen is on it!</p>

                    <div className="mt-4 inline-block bg-white/20 text-white font-black text-xs px-4 py-2 rounded-xl backdrop-blur-sm border border-white/10 tracking-widest uppercase">
                        Order #{orderId.substring(0, 6).toUpperCase()}
                    </div>
                </div>

                {/* White Card Section */}
                <div className="px-4 -mt-8 flex-1 max-w-md mx-auto w-full relative z-10">
                    <div className="bg-white rounded-3xl border border-[#EDD9C8] p-5 shadow-xl">
                        <div className="flex items-center justify-between border-b border-[#F5EDE6] pb-3 mb-4">
                            <span className="font-black text-xs text-[#8C6A50] uppercase tracking-wider flex items-center gap-1">
                                📋 Your Order
                            </span>
                            <span className="font-black text-xs text-[#1A1006] bg-[#FFF0E6] px-2.5 py-1 rounded-lg">
                                Table {tableLabel}
                            </span>
                        </div>

                        {/* Items List */}
                        <div className="divide-y divide-[#F5EDE6] max-h-48 overflow-y-auto scrollbar-thin pr-1">
                            {order.order_items?.map((item) => (
                                <div key={item.id} className="py-2.5 flex justify-between gap-3 text-sm">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-1">
                                            <span className="font-bold text-[#8C6A50] tabular-nums text-xs">{item.quantity}×</span>
                                            <span className="font-bold text-[#1A1006] leading-snug">{item.menu_items?.name}</span>
                                        </div>
                                        {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {item.order_item_modifiers.map(m => (
                                                    <span key={m.id} className="text-[9px] bg-gray-50 border border-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                                                        {m.modifier_name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <span className="font-black text-[#FB6303] tabular-nums">
                                        {money(item.unit_price * item.quantity)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Total amount */}
                        <div className="flex justify-between items-center border-t border-[#EDD9C8] pt-4 mt-3">
                            <span className="text-sm font-bold text-[#8C6A50]">Total Amount</span>
                            <span className="font-black text-lg text-[#FB6303] tabular-nums">
                                {money(order.total_amount)}
                            </span>
                        </div>

                        {/* Estimated time callout */}
                        <div className="mt-5 bg-[#FFF0E6] rounded-2xl p-3 border border-[#EDD9C8] flex items-center gap-3">
                            <div className="text-[#FB6303] shrink-0 bg-white size-8 rounded-full flex items-center justify-center shadow-sm">
                                <Clock size={16} />
                            </div>
                            <div>
                                <p className="text-[10px] text-[#8C6A50] font-black uppercase tracking-wider">Estimated time</p>
                                <p className="text-sm font-black text-[#1A1006]">
                                    {preparationMin > 0 ? `${preparationMin} minutes` : '20–30 minutes'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Post-Order Loyalty Conversion Banner */}
                    <div className="mt-6 mx-4">
                        <Link href={`/r/${restaurantInfo?.slug || 'unknown'}/login`} className="block">
                            <div className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-4 text-white shadow-lg shadow-brand-500/30 flex items-center gap-4 active:scale-[0.98] transition-transform">
                                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                                    <PartyPopper size={24} className="text-white" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-sm">Claim {Math.floor(order.total_amount * 0.1)} Points! 🎁</h4>
                                    <p className="text-xs text-white/80 mt-0.5">Save your profile to earn loyalty rewards.</p>
                                </div>
                                <ChevronLeft size={20} className="rotate-180 text-white/50" />
                            </div>
                        </Link>
                    </div>

                    {/* Track Your Order Button */}
                    <div className="mt-8">
                        <button
                            onClick={() => setShowSuccessScreen(false)}
                            className="w-full bg-[#FB6303] text-white font-black text-sm py-4 rounded-2xl active:scale-[0.98] transition-transform shadow-md shadow-[#FB6303]/15 flex items-center justify-center gap-2"
                        >
                            <MapPin size={16} />
                            Track Your Order
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col min-h-screen bg-[#FFF8F3] text-[#1A1006] font-sans pb-28 select-none">
            {showConfetti && <Confetti />}

            {/* Tracking Header */}
            <div className="bg-[#FB6303] pt-6 pb-8 px-4 relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/2" />
                <button
                    onClick={() => setShowSuccessScreen(true)}
                    className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-4 transition-transform active:scale-95 text-white hover:bg-white/30"
                >
                    <ChevronLeft size={20} />
                </button>
                <p className="text-white/70 text-xs font-semibold tracking-widest uppercase mb-1">Live Tracking</p>
                <h1 className="text-2xl font-black text-white">Order #{orderId.substring(0, 6).toUpperCase()}</h1>
                <p className="text-white/80 text-sm font-semibold mt-1">
                    Table {tableLabel} • {money(order.total_amount)}
                </p>
            </div>

            <div className="px-4 pt-6 flex-1 max-w-md mx-auto w-full">
                {/* Status card */}
                <div className="bg-white rounded-2xl border border-[#EDD9C8] p-4 mb-6 shadow-sm" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-green-600 uppercase tracking-wide">Live Updates</span>
                    </div>
                    {isCancelled ? (
                        <>
                            <p className="text-base font-black text-red-650">Order Cancelled</p>
                            <p className="text-xs text-[#8C6A50] font-semibold mt-0.5">
                                {order.cancellation_reason || 'Please contact a waiter for assistance.'}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-base font-black text-[#1A1006]">
                                {STEPS[currentStepIndex]?.label || 'Pending Confirmation'}
                            </p>
                            <p className="text-xs text-[#8C6A50] font-semibold mt-0.5">
                                {STEPS[currentStepIndex]?.hint || 'Waiting for the kitchen...'}
                            </p>
                        </>
                    )}
                </div>

                {/* Timeline */}
                {!isCancelled && (
                    <div className="relative mb-6 pl-1">
                        {STEPS.map((step, i) => {
                            const isDone = i <= currentStepIndex
                            const isActive = i === currentStepIndex
                            const Icon = step.icon
                            return (
                                <div key={step.id} className="flex gap-4">
                                    {/* Line + Dot */}
                                    <div className="flex flex-col items-center">
                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shrink-0 z-10 transition-all duration-500 ${
                                            isDone
                                                ? isActive
                                                    ? "bg-[#FB6303] border-[#FB6303] shadow-md shadow-[#FB6303]/20 animate-pulse"
                                                    : "bg-[#FB6303] border-[#FB6303]"
                                                : "bg-white border-[#EDD9C8]"
                                        }`}
                                            style={isActive ? { boxShadow: "0 0 0 6px rgba(232,93,4,0.15)" } : {}}
                                        >
                                            <Icon size={16} className={isDone ? "text-white" : "text-[#C4A882]"} />
                                        </div>
                                        {i < STEPS.length - 1 && (
                                            <div className={`w-0.5 h-10 transition-all duration-700 ${
                                                i < currentStepIndex ? "bg-[#FB6303]" : "bg-[#EDD9C8]"
                                            }`} />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="pt-1.5 pb-8">
                                        <p className={`text-xs font-black ${isDone ? "text-[#1A1006]" : "text-[#C4A882]"}`}>{step.label}</p>
                                        <p className={`text-[10px] font-semibold ${isDone ? "text-[#8C6A50]" : "text-[#C4A882]"}`}>{step.sub}</p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}



                {/* Order Details list */}
                <div className="bg-white rounded-2xl border border-[#EDD9C8] shadow-sm overflow-hidden mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <div className="px-4 py-3.5 border-b border-[#EDD9C8] bg-[#FFF0E6]/30">
                        <h3 className="font-black text-[#1A1006] text-xs uppercase tracking-wider">Your Order Items</h3>
                    </div>
                    <div className="divide-y divide-[#F5EDE6]">
                        {order.order_items?.map((item) => (
                            <div key={item.id} className="px-4 py-3 flex justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="text-xs font-bold text-[#8C6A50] tabular-nums">{item.quantity}×</span>
                                        <span className="text-xs font-bold text-[#1A1006] leading-snug">{item.menu_items?.name}</span>
                                    </div>
                                    {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {item.order_item_modifiers.map(mod => (
                                                <span key={mod.id} className="text-[9px] bg-gray-50 border border-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                                                    {mod.modifier_name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs font-black text-[#FB6303] tabular-nums shrink-0">
                                    {money(item.unit_price * item.quantity)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            {/* Persistent Bottom Payment Control Button */}
            {!isCancelled && order.payment_status !== 'paid' && (
                <div 
                    className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.06)] px-4 pt-4 z-40 border-t border-[#F5EDE6]" 
                    style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 12px)' }}
                >
                    <div className="max-w-md mx-auto">
                        {!isDelivered ? (
                            <button
                                disabled
                                className="w-full bg-gray-200 text-gray-400 font-black text-sm py-3.5 rounded-2xl cursor-not-allowed flex items-center justify-center gap-2 border border-gray-300"
                            >
                                Pay Now (Pending Delivery)
                            </button>
                        ) : (
                            <button
                                onClick={() => router.push(`/t/${tableSlug}/order/${orderId}/payment`)}
                                className="w-full bg-[#FB6303] text-white font-black text-sm py-3.5 rounded-2xl active:scale-[0.98] transition-transform shadow-md shadow-[#FB6303]/15 flex items-center justify-center gap-2"
                            >
                                Pay Now
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
