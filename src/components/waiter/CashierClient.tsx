'use client'

import { useRef, useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid } from '@/app/(staff)/waiter/order-actions'
import { updateTakeoutStatusAction } from '@/app/(admin)/admin/takeout/actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import { Banknote, CheckCircle, ChefHat, Clock, Loader2, CreditCard, Receipt, ShoppingBag, Flame, X } from 'lucide-react'
import PaymentVerificationFeed, { type PaymentClaim } from './PaymentVerificationFeed'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

type OrderItem = { quantity: number; menu_items: { name: string } | null }
type TableRef = { label?: string } | null

export type UnpaidOrder = {
    id: string
    total_amount: number
    delivered_at: string | null
    payment_status: string
    payment_method: string | null
    session_id: string | null
    sessions: { id: string; tables: TableRef } | null
    order_items: OrderItem[]
}

export type ActiveOrder = {
    id: string
    status: string
    total_amount: number
    placed_at: string
    session_id: string | null
    order_type?: 'dine_in' | 'takeout' | 'delivery'
    payment_status?: string
    customer_name?: string | null
    customer_phone?: string | null
    delivery_address?: string | null
    sessions: { id: string; tables: TableRef } | null
    order_items?: { id: string; quantity: number; status: string; unit_price?: number; menu_items: { name: string } | null }[]
}

import CashierTableManager, { type TableWithSession } from './CashierTableManager'
import CashierRoomManager from './CashierRoomManager'

interface Props {
    restaurantId: string
    restaurantSlug: string
    userId: string
    initialUnpaid: UnpaidOrder[]
    initialActive: ActiveOrder[]
    initialClaims: PaymentClaim[]
    tables: TableWithSession[]
    rooms?: any[]
    isHotel?: boolean
}

function tableLabel(sessions: { tables: TableRef } | null): string {
    return (sessions?.tables as { label?: string } | null)?.label ?? '?'
}

export default function CashierClient({ 
    restaurantId, 
    restaurantSlug, 
    userId, 
    initialUnpaid, 
    initialActive, 
    initialClaims, 
    tables,
    rooms = [],
    isHotel = false,
}: Props) {
    const [unpaid, setUnpaid] = useState<UnpaidOrder[]>(initialUnpaid)
    const money = useCurrency()
    const [active, setActive] = useState<ActiveOrder[]>(initialActive)
    const [processingId, setProcessingId] = useState<string | null>(null)
    const [pendingClaims, setPendingClaims] = useState(
        initialClaims.filter(c => !c.staff_verified && !c.staff_rejected).length
    )
    const supabaseRef = useRef(createClient())
    const [activeTab, setActiveTab] = useState<'rooms' | 'tables' | 'space' | 'takeaway' | 'billing'>('billing')
    const [takeawaySubTab, setTakeawaySubTab] = useState<'takeaway' | 'delivery'>('takeaway')
    const [spaceFilter, setSpaceFilter] = useState<'all' | 'available' | 'reserved' | 'occupied' | 'dirty'>('all')
    const [roomsFilter, setRoomsFilter] = useState<'all' | 'available' | 'reserve' | 'occupied' | 'dirty' | 'closed'>('all')
    const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null)
    const [selectedOrder, setSelectedOrder] = useState<ActiveOrder | null>(null)
    const [mounted, setMounted] = useState(false)
    
    // Set default active tab correctly
    useEffect(() => {
        setMounted(true)
        if (isHotel) {
            setActiveTab('rooms')
        }
    }, [isHotel])

    const spaceCounts = useMemo(() => {
        let all = tables.length
        let available = 0
        let reserved = 0
        let occupied = 0
        let dirty = 0
        for (const t of tables) {
            const status = t.activeSession ? 'active' : (t.table_status || 'available')
            if (status === 'active') occupied++
            else if (status === 'dirty') dirty++
            else if (status === 'reserved') reserved++
            else available++
        }
        return { all, available, reserved, occupied, dirty }
    }, [tables])

    const roomsCounts = useMemo(() => {
        let all = rooms.length
        let available = rooms.filter(r => r.status === 'available').length
        let reserve = 0 // dummy count for reserve status
        let occupied = rooms.filter(r => r.status === 'occupied').length
        let dirty = rooms.filter(r => r.status === 'dirty').length
        let closed = rooms.filter(r => r.status === 'maintenance').length
        return { all, available, reserve, occupied, dirty, closed }
    }, [rooms])

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        const supabase = supabaseRef.current
        if (payload.eventType === 'INSERT') {
            const { data } = await supabase
                .from('orders')
                .select(`id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address, sessions ( id, tables ( label ) ), order_items ( id, quantity, status, menu_items ( name ) )`)
                .eq('id', payload.new.id)
                .single()
            if (data) setActive(prev => [...prev, data as unknown as ActiveOrder])
        } else if (payload.eventType === 'UPDATE') {
            const { id, status, payment_status } = payload.new
            if (status === 'delivered' && payment_status === 'unpaid') {
                // Fetch full record to show in unpaid list
                const { data } = await supabase
                    .from('orders')
                    .select(`id, total_amount, delivered_at, payment_status, payment_method, session_id, sessions ( id, tables ( label ) ), order_items ( quantity, menu_items ( name ) )`)
                    .eq('id', id)
                    .single()
                if (data) {
                    setUnpaid(prev => [...prev, data as unknown as UnpaidOrder])
                }
                setActive(prev => prev.filter(o => o.id !== id))
            } else if (payment_status === 'paid' || status === 'cancelled') {
                setUnpaid(prev => prev.filter(o => o.id !== id))
                setActive(prev => prev.filter(o => o.id !== id))
            } else {
                setActive(prev => prev.map(o => o.id === id ? { ...o, status, total_amount: payload.new.total_amount } : o))
            }
        }
    })

    const handleCashPay = async (orderId: string) => {
        setProcessingId(orderId)
        const res = await markDeliveredAndCashPaid(orderId)
        if (res.error) toast.error(res.error)
        else {
            setUnpaid(prev => prev.filter(o => o.id !== orderId))
            toast.success('Payment collected ✓')
        }
        setProcessingId(null)
    }

    // Group unpaid by session
    const unpaidBySession = useMemo(() => {
        const groups = new Map<string, { label: string; orders: UnpaidOrder[]; total: number }>()
        for (const o of unpaid) {
            const key = o.session_id ?? o.id
            const label = tableLabel(o.sessions)
            if (!groups.has(key)) groups.set(key, { label, orders: [], total: 0 })
            const g = groups.get(key)!
            g.orders.push(o)
            g.total += o.total_amount ?? 0
        }
        return [...groups.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label))
    }, [unpaid])

    const activeDineIn = useMemo(() => active.filter(o => o.order_type === 'dine_in' || o.session_id !== null), [active])
    const activeTakeoutDelivery = useMemo(() => active.filter(o => o.order_type === 'takeout' || o.order_type === 'delivery'), [active])

    // Group active by session for the pipeline view
    const activePipeline = useMemo(() => {
        const groups = new Map<string, { label: string; orders: ActiveOrder[] }>()
        for (const o of activeDineIn) {
            const key = o.session_id ?? o.id
            const label = tableLabel(o.sessions)
            if (!groups.has(key)) groups.set(key, { label, orders: [] })
            groups.get(key)!.orders.push(o)
        }
        return [...groups.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label))
    }, [activeDineIn])

    const handleUpdateStatus = async (orderId: string, status: 'confirmed' | 'cancelled') => {
        const res = await updateTakeoutStatusAction(orderId, status)
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`Order ${status === 'confirmed' ? 'confirmed' : 'cancelled'}`)
            if (status === 'cancelled') {
                setActive(prev => prev.filter(o => o.id !== orderId))
            } else {
                setActive(prev => prev.map(o => o.id === orderId ? { ...o, status: 'confirmed' } : o))
            }
        }
    }

    const totalUnpaid = unpaid.reduce((s, o) => s + (o.total_amount ?? 0), 0)

    const tabs = isHotel ? [
        { id: 'rooms', label: 'Rooms' },
        { id: 'tables', label: 'Tables' },
        { id: 'takeaway', label: 'Takeaway/Delivery' },
        { id: 'billing', label: 'Billing' },
    ] : [
        { id: 'space', label: 'Space' },
        { id: 'takeaway', label: 'Takeaway/Delivery' },
        { id: 'billing', label: 'Billing' },
    ]

    return (
        <div className="space-y-5">
            {/* Cashier Tab Navigation */}
            <div className={`grid ${isHotel ? 'grid-cols-4' : 'grid-cols-3'} border-b border-hairline mb-4 bg-surface sticky top-14 z-20 -mx-3 px-3 md:mx-0 md:px-0`}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center justify-center gap-1.5 py-4 text-xs md:text-sm font-bold whitespace-nowrap transition-colors relative focus:outline-none w-full ${
                                isActive ? 'text-[var(--brand-500)]' : 'text-ink-muted hover:text-ink'
                            }`}
                        >
                            {tab.id === 'takeaway' && activeTakeoutDelivery.length > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {activeTakeoutDelivery.length}
                                </span>
                            )}
                            {tab.id === 'billing' && unpaid.length > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-red-100 text-red-700'
                                }`}>
                                    {unpaid.length}
                                </span>
                            )}
                            <span>{tab.label}</span>
                            {isActive && (
                                <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[var(--brand-500)] rounded-t-full" />
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Tab Contents */}
            <div>
                {activeTab === 'rooms' && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Sticky Sub-tabs / Filters for Rooms */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className="grid grid-cols-6 gap-1.5 sm:gap-2.5 w-full">
                                {([
                                    { key: 'all', label: 'ALL', count: roomsCounts.all },
                                    { key: 'available', label: 'Available', count: roomsCounts.available },
                                    { key: 'reserve', label: 'Reserve', count: roomsCounts.reserve },
                                    { key: 'occupied', label: 'Occupied', count: roomsCounts.occupied },
                                    { key: 'dirty', label: 'Dirty', count: roomsCounts.dirty },
                                    { key: 'closed', label: 'Closed', count: roomsCounts.closed }
                                ] as const).map(({ key, label, count }) => {
                                    const isActive = roomsFilter === key
                                    const activeColors = {
                                        all: 'bg-[var(--color-primary)] text-white',
                                        available: 'bg-emerald-500 text-white',
                                        reserve: 'bg-blue-500 text-white',
                                        occupied: 'bg-indigo-500 text-white',
                                        dirty: 'bg-amber-500 text-white',
                                        closed: 'bg-rose-500 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setRoomsFilter(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2 px-1 sm:py-2.5 sm:px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <CashierRoomManager
                            initialRooms={rooms}
                            restaurantId={restaurantId}
                            roomsFilter={roomsFilter}
                        />
                    </div>
                )}

                {(activeTab === 'space' || activeTab === 'tables') && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Sticky Sub-tabs / Filters */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5 w-full">
                                {([
                                    { key: 'all', label: 'ALL', count: spaceCounts.all },
                                    { key: 'available', label: 'Available', count: spaceCounts.available },
                                    { key: 'reserved', label: 'Reserved', count: spaceCounts.reserved },
                                    { key: 'dirty', label: 'Dirty', count: spaceCounts.dirty },
                                    { key: 'occupied', label: 'Occupied', count: spaceCounts.occupied }
                                ] as const).map(({ key, label, count }) => {
                                    const isActive = spaceFilter === key
                                    const activeColors = {
                                        all: 'bg-[var(--color-primary)] text-white',
                                        available: 'bg-emerald-500 text-white',
                                        reserved: 'bg-blue-500 text-white',
                                        occupied: 'bg-brand-500 text-white',
                                        dirty: 'bg-amber-500 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setSpaceFilter(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2 px-1 sm:py-2.5 sm:px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <CashierTableManager
                            initialTables={tables}
                            restaurantId={restaurantId}
                            activeOrders={active}
                            unpaidOrders={unpaid}
                            userId={userId}
                            spaceFilter={spaceFilter}
                            onSwitchToBilling={(sessionId) => {
                                setActiveTab('billing')
                                setHighlightSessionId(sessionId)
                            }}
                        />
                    </div>
                )}

                {activeTab === 'takeaway' && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Top action row */}
                        <div className="flex justify-between items-center bg-surface rounded-2xl border border-hairline p-4 shadow-sm">
                            <div>
                                <h3 className="text-sm font-bold text-ink-muted">Takeaway &amp; Delivery Panel</h3>
                                <p className="text-caption text-ink-subtle">Monitor status and manage takeaway/delivery orders.</p>
                            </div>
                            <button 
                                onClick={() => {
                                    if (restaurantSlug) {
                                        window.open(`/takeout/${restaurantSlug}`, '_blank')
                                    } else {
                                        toast.error('Restaurant slug not found')
                                    }
                                }}
                                className="bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] font-extrabold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition shadow-sm"
                            >
                                Manual Takeaway/Delivery
                            </button>
                        </div>

                        {/* Sub-tabs / Filters */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className="grid grid-cols-2 gap-2 sm:gap-4 w-full">
                                {([
                                    { key: 'takeaway', label: 'Takeaway orders', count: activeTakeoutDelivery.filter(o => o.order_type === 'takeout').length },
                                    { key: 'delivery', label: 'Delivery orders', count: activeTakeoutDelivery.filter(o => o.order_type === 'delivery').length }
                                ] as const).map(({ key, label, count }) => {
                                    const isActive = takeawaySubTab === key
                                    const activeColors = {
                                        takeaway: 'bg-amber-500 text-white',
                                        delivery: 'bg-purple-600 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setTakeawaySubTab(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* List grid */}
                        <div className="bg-surface rounded-[24px] border border-hairline p-5 shadow-sm">
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                                {activeTakeoutDelivery.filter(o => o.order_type === (takeawaySubTab === 'takeaway' ? 'takeout' : 'delivery')).length === 0 ? (
                                    <div className="col-span-full py-12 text-center text-xs text-ink-subtle font-semibold">
                                        No active {takeawaySubTab === 'takeaway' ? 'takeaway' : 'delivery'} orders
                                    </div>
                                ) : (
                                    activeTakeoutDelivery.filter(o => o.order_type === (takeawaySubTab === 'takeaway' ? 'takeout' : 'delivery')).map(order => {
                                        const statusColors = {
                                            pending: 'border-yellow-200 bg-yellow-50/10 text-yellow-700',
                                            confirmed: 'border-blue-200 bg-blue-50/10 text-blue-700',
                                            preparing: 'border-brand-200 bg-brand-50/10 text-orange-700',
                                            ready: 'border-emerald-200 bg-emerald-50/10 text-emerald-700',
                                        } as any
                                        const cls = statusColors[order.status] || 'border-hairline bg-surface text-ink-subtle'

                                        return (
                                            <button
                                                key={order.id}
                                                onClick={() => setSelectedOrder(order)}
                                                className={`aspect-square rounded-[20px] border flex flex-col items-center justify-center p-3 text-center transition-all duration-300 ${cls} hover:-translate-y-1 hover:shadow-md active:scale-95`}
                                            >
                                                <span className="text-sm font-black tracking-tight text-ink block font-mono">
                                                    #{order.id.slice(0, 4).toUpperCase()}
                                                </span>
                                                <span className="text-[9px] font-extrabold uppercase tracking-wide mt-2.5 px-2 py-0.5 rounded bg-surface/60 border border-black/5 shadow-sm">
                                                    {order.status === 'ready' ? 'Ready' : order.status}
                                                </span>
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'billing' && (
                    <div className="space-y-5">
                        {/* Online payment claims (UPI/card) awaiting verification */}
                        <PaymentVerificationFeed
                            initialClaims={initialClaims}
                            restaurantId={restaurantId}
                            userId={userId}
                            onPendingCountChange={setPendingClaims}
                        />

                        {/* Unpaid Bills — main cashier action */}
                        <div>
                            <h2 className="text-sm font-semibold text-ink-muted mb-3 flex items-center gap-2">
                                <Receipt size={14} className="text-red-400" />
                                Awaiting Payment
                                {unpaid.length > 0 && (
                                    <span className="ml-1 bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{unpaid.length}</span>
                                )}
                            </h2>

                            {unpaidBySession.length === 0 ? (
                                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-10 text-center">
                                    <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
                                    <p className="text-sm font-medium text-ink-subtle">All bills settled</p>
                                    <p className="text-xs text-gray-300 mt-1">No pending payments right now</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {unpaidBySession.map(([sessionKey, { label, orders: tableOrders, total }]) => (
                                        <div 
                                            key={sessionKey} 
                                            className={`bg-surface rounded-2xl border-2 shadow-sm overflow-hidden transition-all duration-500 ${
                                                sessionKey === highlightSessionId 
                                                    ? 'border-[var(--brand-500)] ring-2 ring-brand-500/20 scale-[1.01]' 
                                                    : 'border-red-200'
                                            }`}
                                        >
                                            <div className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-red-400" />
                                                    <span className="font-bold text-sm text-red-800">Table {label}</span>
                                                </div>
                                                <span className="text-base font-bold text-red-700 tabular-nums">{money(total)}</span>
                                            </div>

                                            <div className="px-4 py-3 space-y-3">
                                                {tableOrders.map(order => (
                                                    <div key={order.id} className="flex items-start gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs text-ink-subtle mb-1 font-mono">#{order.id.substring(0, 6).toUpperCase()}</p>
                                                            <ul className="text-sm text-ink-muted space-y-0.5">
                                                                {order.order_items.map((item, i) => (
                                                                    <li key={i} className="flex gap-1.5">
                                                                        <span className="text-xs text-ink-subtle tabular-nums shrink-0">{item.quantity}×</span>
                                                                        <span className="truncate">{(item.menu_items as { name?: string } | null)?.name}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-2 shrink-0">
                                                            <span className="text-sm font-semibold text-ink tabular-nums">{money(order.total_amount)}</span>
                                                            <button
                                                                onClick={() => handleCashPay(order.id)}
                                                                disabled={processingId === order.id}
                                                                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-xl active:scale-95 disabled:opacity-50 transition"
                                                            >
                                                                {processingId === order.id ? <Loader2 size={12} className="animate-spin" /> : <Banknote size={12} />}
                                                                Cash
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {tableOrders.length > 1 && (
                                                <div className="px-4 py-2.5 bg-surface-muted border-t border-hairline flex items-center justify-between">
                                                    <span className="text-xs text-ink-subtle">{tableOrders.length} orders · table total</span>
                                                    <span className="text-sm font-bold text-ink tabular-nums">{money(total)}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>



                        {/* Active Pipeline — read-only overview for cashier */}
                        {activePipeline.length > 0 && (
                            <div>
                                <h2 className="text-sm font-semibold text-ink-muted mb-3 flex items-center gap-2">
                                    <ChefHat size={14} className="text-orange-400" />
                                    In Pipeline (Dine-In)
                                    <span className="ml-1 bg-brand-100 text-brand-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{activeDineIn.length}</span>
                                </h2>
                                <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                                    <div className="divide-y divide-gray-50">
                                        {activePipeline.map(([sessionKey, { label, orders: tableOrders }]) => {
                                            const worstStatus = tableOrders.some(o => o.status === 'ready') ? 'ready'
                                                : tableOrders.some(o => o.status === 'preparing') ? 'preparing'
                                                : 'pending'
                                            const statusConfig = {
                                                ready:    { dot: 'bg-emerald-500 animate-pulse', label: 'Ready',    cls: 'text-emerald-700' },
                                                preparing:{ dot: 'bg-brand-400 animate-pulse',  label: 'Cooking',  cls: 'text-orange-700' },
                                                pending:  { dot: 'bg-amber-300',                 label: 'Pending',  cls: 'text-amber-700' },
                                            }
                                            const sc = statusConfig[worstStatus]
                                            const total = tableOrders.reduce((s, o) => s + (o.total_amount ?? 0), 0)

                                            return (
                                                <div key={sessionKey} className="px-4 py-3 flex items-center gap-3">
                                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.dot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-sm text-ink">Table {label}</span>
                                                            <span className={`text-[10px] font-semibold ${sc.cls}`}>{sc.label}</span>
                                                        </div>
                                                        <p className="text-xs text-ink-subtle mt-0.5">
                                                            {tableOrders.length} order{tableOrders.length !== 1 ? 's' : ''}
                                                        </p>
                                                    </div>
                                                    <span className="text-sm font-semibold text-ink-muted tabular-nums shrink-0">{money(total)}</span>
                                                    <Clock size={13} className="text-gray-300 shrink-0" />
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {unpaid.length === 0 && activePipeline.length === 0 && activeTakeoutDelivery.length === 0 && pendingClaims === 0 && (
                            <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-12 text-center">
                                <CreditCard size={36} className="mx-auto text-gray-200 mb-3" />
                                <p className="text-base font-semibold text-ink-subtle">All quiet at the counter</p>
                                <p className="text-sm text-gray-350 mt-1">No active orders or pending payments</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Takeaway/Delivery Order Detail Modal */}
            {mounted && selectedOrder && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setSelectedOrder(null)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md overflow-hidden transform transition-all"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink font-mono">
                                    Order #{selectedOrder.id.substring(0, 6).toUpperCase()}
                                </h3>
                                <p className="text-caption text-ink-subtle mt-0.5 capitalize">
                                    {selectedOrder.order_type} · {selectedOrder.status}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedOrder(null)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
                            {/* Customer info */}
                            <div className="space-y-1 text-xs text-ink-muted bg-surface-muted p-3.5 rounded-xl border border-hairline">
                                <p className="font-bold text-ink text-sm">{selectedOrder.customer_name || 'Customer'}</p>
                                <p className="font-mono">{selectedOrder.customer_phone}</p>
                                {selectedOrder.order_type === 'delivery' && selectedOrder.delivery_address && (
                                    <p className="text-ink-subtle italic mt-1 bg-surface p-2.5 rounded border border-hairline">
                                        {selectedOrder.delivery_address}
                                    </p>
                                )}
                            </div>

                            {/* Order Items */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Order Items</h4>
                                <div className="space-y-2 border border-hairline rounded-xl p-3 bg-surface-muted/50 divide-y divide-gray-100">
                                    {(selectedOrder.order_items || []).map((item, idx) => {
                                        const price = Number(item.unit_price ?? 0)
                                        const qty = item.quantity || 0
                                        return (
                                            <div key={idx} className="flex justify-between items-center py-2 text-xs">
                                                <div className="flex-1 min-w-0 pr-2">
                                                    <p className="font-extrabold text-ink truncate text-[13px]">
                                                        {item.menu_items?.name || 'Item'}
                                                    </p>
                                                    <p className="text-[10px] text-ink-subtle capitalize">
                                                        Status: <span className="text-brand-500 font-extrabold">{item.status || selectedOrder.status}</span>
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <span className="text-xs font-extrabold text-brand-600 bg-brand-50 border border-brand-100/50 px-2 py-0.5 rounded-lg tabular-nums">
                                                        {qty}×
                                                    </span>
                                                    <span className="font-semibold text-ink-muted tabular-nums">
                                                        {money(price * qty)}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Total Amount & Prepaid status */}
                            <div className="flex flex-col gap-2 pt-3 border-t border-hairline">
                                <div className="flex justify-between items-center font-bold text-sm">
                                    <span className="text-ink-muted">Total Amount:</span>
                                    <span className="text-brand-600 text-base tabular-nums">{money(selectedOrder.total_amount)}</span>
                                </div>

                                <div className="flex items-center justify-between mt-1 text-xs">
                                    <span className="text-ink-subtle font-bold">Payment Status:</span>
                                    {selectedOrder.payment_status === 'paid' ? (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-3 py-1 rounded-full text-[10px]">
                                            ✓ Prepaid
                                        </span>
                                    ) : (
                                        <span className="bg-red-50 text-red-700 border border-red-200 font-extrabold px-3 py-1 rounded-full text-[10px]">
                                            Awaiting Payment
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons if Pending */}
                            {selectedOrder.status === 'pending' && (
                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    <button
                                        onClick={async () => {
                                            await handleUpdateStatus(selectedOrder.id, 'cancelled')
                                            setSelectedOrder(null)
                                        }}
                                        className="w-full bg-surface border border-red-200 text-red-700 hover:bg-red-50 font-extrabold text-xs py-3 rounded-xl transition duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-1.5"
                                    >
                                        Cancel Order
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await handleUpdateStatus(selectedOrder.id, 'confirmed')
                                            setSelectedOrder(null)
                                        }}
                                        className="w-full bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] font-extrabold text-xs py-3 rounded-xl transition duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-1.5"
                                    >
                                        Confirm Order
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
