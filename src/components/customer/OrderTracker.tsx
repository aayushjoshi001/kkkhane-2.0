'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { playStatusUpdate } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency, useBusinessMode } from '@/lib/contexts/FeatureContext'
import { CheckCircle, Clock, ChefHat, Package, PartyPopper, ChevronLeft, MapPin, Plus } from 'lucide-react'
import type { Order, OrderItem, MenuItem, OrderItemModifier } from '@/types/database'
import Confetti from '@/components/customer/Confetti'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import OrderPaymentSection from './OrderPaymentSection'
import OrderSplitBillSection from './OrderSplitBillSection'
import FeedbackPrompt from './FeedbackPrompt'
import BottomNavbar from '@/components/customer/BottomNavbar'

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
    sessionOrders = [],
}: {
    orderId: string
    initialOrder: OrderWithItems
    tableLabel: string
    features: any
    restaurantInfo: any
    tableSlug: string
    sessionOrders?: OrderWithItems[]
}) {
    const [order, setOrder] = useState<OrderWithItems>(initialOrder)
    const money = useCurrency()
    const [showConfetti, setShowConfetti] = useState(() => ['pending', 'confirmed'].includes(initialOrder.status))
    const [showSuccessScreen, setShowSuccessScreen] = useState(true)
    const [showPayment, setShowPayment] = useState(false)
    const supabaseRef = useRef(createClient())
    const router = useRouter()

    const isHotelRoom = !!(order as any).booking_id
    // Hotels run the kitchen off printed KOT tickets, not this digital tracker —
    // order status here never advances for them, so live tracking is hidden for
    // every order in a hotel-mode restaurant, not just ones billed to a room.
    const businessMode = useBusinessMode()
    const hideLiveTracking = isHotelRoom || businessMode === 'hotel'
    const activeShowSuccess = hideLiveTracking ? true : showSuccessScreen

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
                            <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-surface shadow-xl rounded-2xl px-4 py-3 flex items-center gap-3 border border-hairline`}>
                                <span className="text-2xl">{info.emoji}</span>
                                <p className="text-sm font-semibold text-ink">{info.message}</p>
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

    const displayOrders = sessionOrders.length > 0 ? sessionOrders : [order]
    const grandTotal = displayOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)

    if (activeShowSuccess) {
        return (
            <div className="flex flex-col min-h-screen bg-surface text-ink font-sans select-none pb-48 animate-in fade-in duration-300">
                {showConfetti && <Confetti />}

                {/* Top Orange Section */}
                <div className="bg-brand-500 pt-12 pb-16 px-4 text-white text-center relative overflow-hidden shrink-0 rounded-b-[40px] shadow-lg">
                    <div className="absolute top-0 right-0 w-36 h-36 rounded-full bg-surface/10 -translate-y-1/2 translate-x-1/2" />
                    
                    {/* Circle Checkmark Icon */}
                    <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center shadow-lg mx-auto mb-4 animate-scale-in">
                        <div className="w-16 h-16 rounded-full border-4 border-brand-500 flex items-center justify-center">
                            <CheckCircle size={28} className="text-brand-500 fill-white" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-black tracking-wide">🎉 Order Placed! 🎉</h1>
                    <p className="text-white/80 text-xs font-semibold mt-1">Sit back and relax — the kitchen is on it!</p>

                    <div className="mt-4 inline-block bg-surface/20 text-white font-black text-xs px-4 py-2 rounded-xl backdrop-blur-sm border border-white/10 tracking-widest uppercase">
                        Order #{orderId.substring(0, 6).toUpperCase()}
                    </div>
                </div>

                {/* White Card Section */}
                <div className="px-4 -mt-8 flex-1 max-w-md mx-auto w-full relative z-10">
                    <div className="bg-surface rounded-3xl border border-hairline p-5 shadow-xl">
                        <div className="flex items-center justify-between border-b border-hairline pb-3 mb-4">
                            <span className="font-black text-xs text-ink-subtle uppercase tracking-wider flex items-center gap-1">
                                📋 {isHotelRoom ? 'Your Room Orders' : 'Your Order'}
                            </span>
                            <span className="font-black text-xs text-ink bg-surface-muted px-2.5 py-1 rounded-lg">
                                Table {tableLabel}
                            </span>
                        </div>

                        {/* Cumulative Orders/Items List */}
                        <div className="divide-y divide-[#F5EDE6] max-h-64 overflow-y-auto scrollbar-thin pr-1 space-y-3">
                            {displayOrders.map((o) => (
                                <div key={o.id} className="pt-2.5 first:pt-0">
                                    {displayOrders.length > 1 && (
                                        <div className="flex justify-between items-center mb-1.5 text-[9px] font-black text-ink-muted/80 tracking-wider">
                                            <span>ORDER #{o.id.substring(0, 6).toUpperCase()}</span>
                                            <span className="bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded uppercase">{o.status}</span>
                                        </div>
                                    )}
                                    <div className="divide-y divide-[#F5EDE6]/50">
                                        {o.order_items?.map((item) => (
                                            <div key={item.id} className="py-2 flex justify-between gap-3 text-xs">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-baseline gap-1">
                                                        <span className="font-bold text-ink-subtle tabular-nums text-[10px]">{item.quantity}×</span>
                                                        <span className="font-bold text-ink leading-snug">{item.menu_items?.name}</span>
                                                    </div>
                                                    {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {item.order_item_modifiers.map(m => (
                                                                <span key={m.id} className="text-[8px] bg-surface-muted border border-hairline text-ink-subtle px-1.5 py-0.5 rounded-full">
                                                                    {m.modifier_name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className="font-black text-brand-500 tabular-nums">
                                                    {money(item.unit_price * item.quantity)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Total amount */}
                        <div className="flex justify-between items-center border-t border-hairline pt-4 mt-3">
                            <span className="text-sm font-bold text-ink-subtle">{isHotelRoom ? 'Grand Total' : 'Total Amount'}</span>
                            <span className="font-black text-lg text-brand-500 tabular-nums">
                                {money(grandTotal)}
                            </span>
                        </div>

                        {/* Estimated time callout */}
                        <div className="mt-5 bg-surface-muted rounded-2xl p-3 border border-hairline flex items-center gap-3">
                            <div className="text-brand-500 shrink-0 bg-surface size-8 rounded-full flex items-center justify-center shadow-sm">
                                <Clock size={16} />
                            </div>
                            <div>
                                <p className="text-[10px] text-ink-subtle font-black uppercase tracking-wider">Estimated time</p>
                                <p className="text-sm font-black text-ink">
                                    {preparationMin > 0 ? `${preparationMin} minutes` : '20–30 minutes'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Post-Order Loyalty Conversion Banner */}
                    <div className="mt-6 mx-4">
                        <Link href={`/r/${restaurantInfo?.slug || 'unknown'}/login`} className="block">
                            <div className="bg-gradient-to-r from-brand-600 to-brand-500 rounded-2xl p-4 text-white shadow-lg shadow-brand-500/30 flex items-center gap-4 active:scale-[0.98] transition-transform">
                                <div className="w-12 h-12 bg-surface/20 rounded-full flex items-center justify-center shrink-0">
                                    <PartyPopper size={24} className="text-white" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-sm">Claim {Math.floor(grandTotal * 0.1)} Points! 🎁</h4>
                                    <p className="text-xs text-white/80 mt-0.5">Save your profile to earn loyalty rewards.</p>
                                </div>
                                <ChevronLeft size={20} className="rotate-180 text-white/50" />
                            </div>
                        </Link>
                    </div>

                    {/* Action Button */}
                    <div className="mt-8">
                        {hideLiveTracking ? (
                            <button
                                onClick={() => router.push(`/t/${tableSlug}`)}
                                className="w-full bg-brand-500 text-white font-black text-sm py-4 rounded-2xl active:scale-[0.98] transition-transform shadow-md shadow-[#FB6303]/15 flex items-center justify-center gap-2"
                            >
                                <Plus size={16} />
                                Order More Items
                            </button>
                        ) : (
                            <button
                                onClick={() => setShowSuccessScreen(false)}
                                className="w-full bg-brand-500 text-white font-black text-sm py-4 rounded-2xl active:scale-[0.98] transition-transform shadow-md shadow-[#FB6303]/15 flex items-center justify-center gap-2"
                            >
                                <MapPin size={16} />
                                Track Your Order
                            </button>
                        )}
                    </div>
                </div>
                <BottomNavbar activeTab="orders" />
            </div>
        )
    }

    return (
        <div className="flex flex-col min-h-screen bg-surface text-ink font-sans pb-64 select-none">
            {showConfetti && <Confetti />}

            {/* Tracking Header */}
            <div className="bg-brand-500 pt-6 pb-8 px-4 relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-surface/10 -translate-y-1/2 translate-x-1/2" />
                <button
                    onClick={() => setShowSuccessScreen(true)}
                    className="w-9 h-9 bg-surface/20 rounded-full flex items-center justify-center mb-4 transition-transform active:scale-95 text-white hover:bg-surface/30"
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
                <div className="bg-surface rounded-2xl border border-hairline p-4 mb-6 shadow-sm" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-green-600 uppercase tracking-wide">Live Updates</span>
                    </div>
                    {isCancelled ? (
                        <>
                            <p className="text-base font-black text-red-650">Order Cancelled</p>
                            <p className="text-xs text-ink-subtle font-semibold mt-0.5">
                                {order.cancellation_reason || 'Please contact a waiter for assistance.'}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-base font-black text-ink">
                                {STEPS[currentStepIndex]?.label || 'Pending Confirmation'}
                            </p>
                            <p className="text-xs text-ink-subtle font-semibold mt-0.5">
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
                                                    ? "bg-brand-500 border-brand-500 shadow-md shadow-[#FB6303]/20 animate-pulse"
                                                    : "bg-brand-500 border-brand-500"
                                                : "bg-surface border-hairline"
                                        }`}
                                            style={isActive ? { boxShadow: "0 0 0 6px rgba(232,93,4,0.15)" } : {}}
                                        >
                                            <Icon size={16} className={isDone ? "text-white" : "text-brand-200"} />
                                        </div>
                                        {i < STEPS.length - 1 && (
                                            <div className={`w-0.5 h-10 transition-all duration-700 ${
                                                i < currentStepIndex ? "bg-brand-500" : "bg-[#EDD9C8]"
                                            }`} />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="pt-1.5 pb-8">
                                        <p className={`text-xs font-black ${isDone ? "text-ink" : "text-brand-200"}`}>{step.label}</p>
                                        <p className={`text-[10px] font-semibold ${isDone ? "text-ink-subtle" : "text-brand-200"}`}>{step.sub}</p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}



                {/* Order Details list */}
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <div className="px-4 py-3.5 border-b border-hairline bg-surface-muted/30">
                        <h3 className="font-black text-ink text-xs uppercase tracking-wider">Your Order Items</h3>
                    </div>
                    <div className="divide-y divide-[#F5EDE6]">
                        {order.order_items?.map((item) => (
                            <div key={item.id} className="px-4 py-3 flex justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="text-xs font-bold text-ink-subtle tabular-nums">{item.quantity}×</span>
                                        <span className="text-xs font-bold text-ink leading-snug">{item.menu_items?.name}</span>
                                    </div>
                                    {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {item.order_item_modifiers.map(mod => (
                                                <span key={mod.id} className="text-[9px] bg-surface-muted border border-hairline text-ink-subtle px-2 py-0.5 rounded-full">
                                                    {mod.modifier_name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs font-black text-brand-500 tabular-nums shrink-0">
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
                    className="fixed bottom-[88px] left-0 right-0 bg-surface/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.06)] px-4 py-4 z-30 border-t border-hairline" 
                >
                    <div className="max-w-md mx-auto">
                        {!isDelivered ? (
                            <button
                                disabled
                                className="w-full bg-surface-muted text-ink-subtle font-black text-sm py-3.5 rounded-2xl cursor-not-allowed flex items-center justify-center gap-2 border border-hairline-strong"
                            >
                                Pay Now (Pending Delivery)
                            </button>
                        ) : (
                            <button
                                onClick={() => router.push(`/t/${tableSlug}/order/${orderId}/payment`)}
                                className="w-full bg-brand-500 text-white font-black text-sm py-3.5 rounded-2xl active:scale-[0.98] transition-transform shadow-md shadow-[#FB6303]/15 flex items-center justify-center gap-2"
                            >
                                Pay Now
                            </button>
                        )}
                    </div>
                </div>
            )}
            <BottomNavbar activeTab="orders" />
        </div>
    )
}
