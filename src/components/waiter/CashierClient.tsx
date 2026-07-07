'use client'

import { useRef, useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid } from '@/app/(staff)/waiter/order-actions'
import { updateTakeoutStatusAction } from '@/app/(admin)/admin/takeout/actions'
import { closeSession } from '@/app/(staff)/waiter/actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import { Banknote, CheckCircle, ChefHat, Clock, Loader2, CreditCard, Receipt, ShoppingBag, Flame, X } from 'lucide-react'
import PaymentVerificationFeed, { type PaymentClaim } from './PaymentVerificationFeed'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import Button from '@/components/ui/Button'

type OrderItem = { 
    id?: string
    quantity: number
    status?: string
    unit_price?: number
    menu_items: { name: string } | null 
}
type TableRef = { label?: string } | null

export type UnpaidOrder = {
    id: string
    status?: string
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
    order_items?: OrderItem[]
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
    initialBookings?: any[]
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
    initialBookings = [],
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
    
    // Stays and Billing states
    const [roomsState, setRoomsState] = useState<any[]>(rooms)
    const [bookings, setBookings] = useState<any[]>(initialBookings)
    const [billingSubTab, setBillingSubTab] = useState<'rooms' | 'tables'>('rooms')
    const [selectedBillingRoom, setSelectedBillingRoom] = useState<any | null>(null)
    const [selectedBillingTable, setSelectedBillingTable] = useState<any | null>(null)
    const [activeInvoice, setActiveInvoice] = useState<any | null>(null)
    const [isSettlingInvoice, setIsSettlingInvoice] = useState(false)

    // For stay billing detail states
    const [loadingStayDetails, setLoadingStayDetails] = useState(false)
    const [billingStayBooking, setBillingStayBooking] = useState<any | null>(null)
    const [billingRoomCharges, setBillingRoomCharges] = useState<any[]>([])

    const [mounted, setMounted] = useState(false)

    // Sync rooms state when prop changes
    useEffect(() => {
        setRoomsState(rooms)
    }, [rooms])

    // Realtime subscriptions for rooms
    useRestaurantTable(restaurantId, 'rooms', (payload) => {
        if (payload.eventType === 'UPDATE') {
            const updatedRoom = payload.new as any
            setRoomsState((prev: any[]) => prev.map(r => r.id === updatedRoom.id ? { ...r, status: updatedRoom.status } : r))
            setSelectedBillingRoom((prev: any) => {
                if (!prev) return null
                return prev.id === updatedRoom.id ? { ...prev, status: updatedRoom.status } : prev
            })
        }
    })

    // Realtime subscriptions for bookings
    useRestaurantTable(restaurantId, 'bookings', (payload) => {
        if (payload.eventType === 'INSERT') {
            setBookings((prev: any[]) => [...prev, payload.new])
        } else if (payload.eventType === 'UPDATE') {
            const b = payload.new as any
            setBookings((prev: any[]) => prev.map(item => item.id === b.id ? b : item))
            if (billingStayBooking?.id === b.id) {
                setBillingStayBooking(b)
            }
        }
    })

    // Load booking stay details and manual charges when room is selected
    useEffect(() => {
        if (selectedBillingRoom) {
            const booking = bookings.find(b => b.room_id === selectedBillingRoom.id && b.status === 'checked_in')
            if (booking) {
                setBillingStayBooking(booking)
                setLoadingStayDetails(true)
                fetch(`/api/rooms/charges?bookingId=${booking.id}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            setBillingRoomCharges(data.data || [])
                        }
                    })
                    .catch(err => console.error("Error loading room charges:", err))
                    .finally(() => setLoadingStayDetails(false))
            } else {
                setBillingStayBooking(null)
                setBillingRoomCharges([])
            }
        } else {
            setBillingStayBooking(null)
            setBillingRoomCharges([])
        }
    }, [selectedBillingRoom, bookings])

    const formatDateTime = (dateStr: string) => {
        if (!dateStr) return '-'
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        })
    }

    const calculateStayCost = (room: any, booking: any) => {
        if (!room || !booking) return 0
        const price = room.room_types?.base_price || 0
        const inDate = new Date(booking.check_in)
        const outDate = new Date(booking.check_out)
        const diffMs = outDate.getTime() - inDate.getTime()
        const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
        return price * nights
    }

    const getRoomQrOrders = (room: any) => {
        if (!room) return []
        const matchingTable = tables.find(t => t.label === room.room_number || t.label === 'Room ' + room.room_number)
        if (!matchingTable?.activeSession) return []

        const sessionId = matchingTable.activeSession.id
        const allActive = active.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaid.filter(o => o.session_id === sessionId)
        const combinedOrders = [...allActive, ...allUnpaid]

        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        for (const order of combinedOrders) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                items.push({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity || 0,
                    unitPrice: Number(item.unit_price ?? 0),
                    status: item.status || order.status || 'unknown'
                })
            }
        }
        return items
    }

    const getTableSessionItems = (table: any) => {
        if (!table || !table.activeSession) return []
        const sessionId = table.activeSession.id
        const allActive = active.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaid.filter(o => o.session_id === sessionId)
        const combinedOrders = [...allActive, ...allUnpaid]

        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        for (const order of combinedOrders) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                items.push({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity || 0,
                    unitPrice: Number(item.unit_price ?? 0),
                    status: item.status || order.status || 'unknown'
                })
            }
        }
        return items
    }

    const calculateGrandTotal = (room: any, booking: any) => {
        const stayCost = calculateStayCost(room, booking)
        const qrOrdersTotal = getRoomQrOrders(room).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
        const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        return stayCost + qrOrdersTotal + manualChargesTotal
    }

    const compileInvoice = (type: 'room' | 'table', item: any) => {
        if (type === 'room') {
            const room = item
            const booking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
            if (!booking) return
            
            const price = room.room_types?.base_price || 0
            const inDate = new Date(booking.check_in)
            const outDate = new Date(booking.check_out)
            const diffMs = outDate.getTime() - inDate.getTime()
            const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
            const stayCost = price * nights

            const matchingTable = tables.find(t => t.label === room.room_number || t.label === 'Room ' + room.room_number)
            const sessionOrders = matchingTable?.activeSession ? getRoomQrOrders(room) : []
            const qrOrdersTotal = sessionOrders.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)

            const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
            const total = stayCost + qrOrdersTotal + manualChargesTotal

            setActiveInvoice({
                type: 'room',
                id: room.id,
                label: `Room ${room.room_number}`,
                roomType: room.room_types?.name || 'Deluxe',
                guestName: booking.guest_name,
                guestPhone: booking.guest_phone,
                checkIn: booking.check_in,
                checkOut: booking.check_out,
                nights,
                basePrice: price,
                stayCost,
                qrOrders: getRoomQrOrders(room),
                qrOrdersTotal,
                manualCharges: billingRoomCharges,
                manualChargesTotal,
                total,
                bookingId: booking.id,
                roomId: room.id
            })
        } else {
            const table = item
            const sessionOrders = getTableSessionItems(table)
            const total = sessionOrders.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)

            setActiveInvoice({
                type: 'table',
                id: table.id,
                label: `Table ${table.label}`,
                guestName: `Table Guest`,
                guestPhone: null,
                checkIn: table.activeSession.opened_at,
                checkOut: new Date().toISOString(),
                nights: 0,
                basePrice: 0,
                stayCost: 0,
                qrOrders: sessionOrders,
                qrOrdersTotal: total,
                manualCharges: [],
                manualChargesTotal: 0,
                total,
                sessionId: table.activeSession.id
            })
        }
    }

    const handleMarkPaid = async () => {
        if (!activeInvoice) return
        setIsSettlingInvoice(true)
        try {
            // Settle all unpaid orders associated with this room or table
            const sessionId = activeInvoice.type === 'room' 
                ? (tables.find(t => t.label === activeInvoice.label.replace('Room ', '') || t.label === activeInvoice.label)?.activeSession?.id)
                : activeInvoice.sessionId

            if (sessionId) {
                const sessionOrders = active.filter(o => o.session_id === sessionId)
                const sessionUnpaid = unpaid.filter(o => o.session_id === sessionId)
                const allUnpaid = [...sessionOrders, ...sessionUnpaid]

                for (const order of allUnpaid) {
                    if (order.payment_status === 'unpaid') {
                        const res = await markDeliveredAndCashPaid(order.id)
                        if (res.error) {
                            throw new Error(res.error)
                        }
                    }
                }
            }

            if (activeInvoice.type === 'room') {
                const res = await fetch(`/api/bookings/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: activeInvoice.bookingId,
                        room_id: activeInvoice.roomId
                    })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

                toast.success('Room billing settled and guest checked out successfully!')
            } else {
                const res = await closeSession(activeInvoice.sessionId)
                if (res.error) throw new Error(res.error)

                toast.success('Table session settled and closed successfully!')
            }

            setActiveInvoice(null)
            setSelectedBillingRoom(null)
            setSelectedBillingTable(null)
        } catch (e: any) {
            toast.error(e.message || 'Failed to settle invoice')
        } finally {
            setIsSettlingInvoice(false)
        }
    }
    
    // Set default active tab correctly
    useEffect(() => {
        setMounted(true)
        if (isHotel) {
            setActiveTab('rooms')
            setBillingSubTab('rooms')
        } else {
            setBillingSubTab('tables')
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

    const tabs: { id: 'rooms' | 'tables' | 'space' | 'takeaway' | 'billing'; label: string }[] = isHotel ? [
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
                            tables={tables}
                            activeOrders={active}
                            unpaidOrders={unpaid}
                            onGoToBilling={(room) => {
                                setActiveTab('billing')
                                setBillingSubTab('rooms')
                                setSelectedBillingRoom(room)
                            }}
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
                            isHotel={isHotel}
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
                        {/* Awaiting Payment section */}
                        <div>
                            {isHotel && (
                                <div className="border-b border-hairline pb-3 mb-4 flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-ink-muted flex items-center gap-2">
                                        <Receipt size={14} className="text-red-400" />
                                        Awaiting Settlement
                                    </h2>
                                    <div className="flex bg-surface-muted p-1 rounded-xl border border-hairline">
                                        <button
                                            onClick={() => setBillingSubTab('rooms')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'rooms' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Rooms ({roomsState.filter(r => r.status === 'occupied').length})
                                        </button>
                                        <button
                                            onClick={() => setBillingSubTab('tables')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'tables' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Tables ({tables.filter(t => t.activeSession !== null).length})
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!isHotel && (
                                <h2 className="text-sm font-semibold text-ink-muted mb-4 flex items-center gap-2">
                                    <Receipt size={14} className="text-red-400" />
                                    Awaiting Payment
                                </h2>
                            )}

                            {((isHotel && billingSubTab === 'rooms') ? roomsState.filter(r => r.status === 'occupied') : tables.filter(t => t.activeSession !== null)).length === 0 ? (
                                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-10 text-center">
                                    <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
                                    <p className="text-sm font-medium text-ink-subtle">All bills settled</p>
                                    <p className="text-xs text-gray-300 mt-1">No pending payments in this category</p>
                                </div>
                            ) : (
                                <div>
                                    {isHotel && billingSubTab === 'rooms' ? (
                                        // Occupied Rooms Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {roomsState.filter(r => r.status === 'occupied').map(room => {
                                                const booking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
                                                const stayCost = calculateStayCost(room, booking)
                                                const qrOrdersTotal = getRoomQrOrders(room).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
                                                const total = stayCost + qrOrdersTotal
                                                
                                                return (
                                                    <button
                                                        key={room.id}
                                                        onClick={() => setSelectedBillingRoom(room)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight">
                                                            Room {room.room_number}
                                                        </span>
                                                        {booking && (
                                                            <span className="text-[10px] font-bold text-ink-subtle mt-1.5 truncate max-w-full">
                                                                {booking.guest_name}
                                                            </span>
                                                        )}
                                                        <span className="text-[11px] font-extrabold text-brand-650 mt-1">
                                                            {money(total)}
                                                        </span>
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            Awaiting Pay
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        // Occupied Tables Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {tables.filter(t => t.activeSession !== null).map(table => {
                                                const sessionItems = getTableSessionItems(table)
                                                const total = sessionItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
                                                
                                                return (
                                                    <button
                                                        key={table.id}
                                                        onClick={() => setSelectedBillingTable(table)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight">
                                                            Table {table.label}
                                                        </span>
                                                        <span className="text-[11px] font-extrabold text-brand-650 mt-1">
                                                            {money(total)}
                                                        </span>
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            {sessionItems.length} items unpaid
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
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

            {/* Billing Stay Details modal */}
            {mounted && selectedBillingRoom && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingRoom(null)}
                >
                    <div 
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline p-6 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline pb-4">
                            <div>
                                <h3 className="text-lg font-black text-ink">Room {selectedBillingRoom.room_number} stays details</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">{selectedBillingRoom.room_types?.name} • Floor {selectedBillingRoom.floor || 'N/A'}</p>
                            </div>
                            <button onClick={() => setSelectedBillingRoom(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        {loadingStayDetails ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-brand-500" />
                                <p className="text-xs text-ink-subtle font-semibold">Loading details...</p>
                            </div>
                        ) : billingStayBooking ? (
                            <div className="space-y-6">
                                <div className="grid grid-cols-2 gap-4 bg-surface-muted/50 border border-hairline rounded-2xl p-4 text-xs">
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest</p>
                                        <p className="font-extrabold text-ink text-sm">{billingStayBooking.guest_name}</p>
                                        <p className="font-semibold text-ink-muted">{billingStayBooking.guest_phone}</p>
                                    </div>
                                    <div className="space-y-1 text-right border-l border-hairline pl-4">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase">Stay schedule</p>
                                        <p className="font-semibold text-ink-muted">In: {formatDateTime(billingStayBooking.check_in)}</p>
                                        <p className="font-semibold text-ink-muted">Out: {formatDateTime(billingStayBooking.check_out)}</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Stay billing breakdown</h4>
                                    <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface">
                                        <div className="flex justify-between items-center p-4 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">Room Stay Cost</p>
                                                <p className="text-[10px] text-ink-subtle">{money(selectedBillingRoom.room_types?.base_price || 0)} / Night</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(calculateStayCost(selectedBillingRoom, billingStayBooking))}</span>
                                        </div>

                                        {getRoomQrOrders(selectedBillingRoom).length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-indigo-650 font-semibold">QR Room service orders</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                                                    {getRoomQrOrders(selectedBillingRoom).map((item, idx) => (
                                                        <div key={idx} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span>{item.name} ({item.quantity}×)</span>
                                                            <span className="tabular-nums font-semibold">{money(item.unitPrice * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {billingRoomCharges.length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-amber-650 font-semibold">Additional stay charges</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-amber-100">
                                                    {billingRoomCharges.map((c) => (
                                                        <div key={c.id} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span className="capitalize">{c.description} ({c.charge_type})</span>
                                                            <span className="tabular-nums font-semibold">{money(c.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="border-t border-hairline pt-4 flex items-center justify-between mt-2">
                                    <div>
                                        <span className="text-[10px] font-bold text-ink-subtle uppercase">Total bill amount</span>
                                        <p className="text-2xl font-black text-brand-600 tabular-nums">{money(calculateGrandTotal(selectedBillingRoom, billingStayBooking))}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button variant="secondary" onClick={() => setSelectedBillingRoom(null)}>Close</Button>
                                        <Button variant="primary" onClick={() => compileInvoice('room', selectedBillingRoom)} className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs">Generate Invoice</Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="p-8 text-center border border-dashed border-hairline-strong rounded-xl">
                                <p className="text-sm text-ink-subtle">No active booking session found.</p>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {/* Billing Table Details modal */}
            {mounted && selectedBillingTable && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingTable(null)}
                >
                    <div 
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline p-6 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline pb-4">
                            <div>
                                <h3 className="text-lg font-black text-ink">Table {selectedBillingTable.label} details</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">Capacity: {selectedBillingTable.capacity} Seats</p>
                            </div>
                            <button onClick={() => setSelectedBillingTable(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Session order items</h4>
                            {getTableSessionItems(selectedBillingTable).length > 0 ? (
                                <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface p-4 space-y-2">
                                    {getTableSessionItems(selectedBillingTable).map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-1.5 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">{item.name}</p>
                                                <p className="text-[10px] text-ink-subtle">Qty: {item.quantity} × {money(item.unitPrice)}</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(item.unitPrice * item.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center border border-dashed border-hairline-strong rounded-xl text-xs text-ink-subtle font-semibold">
                                    No items ordered in this session yet
                                </div>
                            )}
                        </div>

                        <div className="border-t border-hairline pt-4 flex items-center justify-between mt-2">
                            <div>
                                <span className="text-[10px] font-bold text-ink-subtle uppercase">Total session bill</span>
                                <p className="text-2xl font-black text-brand-600 tabular-nums">
                                    {money(getTableSessionItems(selectedBillingTable).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0))}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={() => setSelectedBillingTable(null)}>Close</Button>
                                <Button variant="primary" onClick={() => compileInvoice('table', selectedBillingTable)} className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs">Generate Invoice</Button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Invoice Preview Overlay modal */}
            {mounted && activeInvoice && createPortal(
                <div 
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
                    onClick={() => setActiveInvoice(null)}
                >
                    <div 
                        className="bg-white w-full max-w-sm p-5 space-y-4 text-black print-container font-mono text-[11px] shadow-2xl relative border-t-8 border-brand-500"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* CSS media print override for POS thermal printer */}
                        <style>{`
                            @page {
                                size: 80mm auto;
                                margin: 0;
                            }
                            @media print {
                                html, body {
                                    background: #fff !important;
                                    color: #000 !important;
                                    margin: 0 !important;
                                    padding: 0 !important;
                                }
                                body * {
                                    visibility: hidden !important;
                                }
                                .print-container, .print-container * {
                                    visibility: visible !important;
                                }
                                .print-container {
                                    position: absolute !important;
                                    left: 0 !important;
                                    top: 0 !important;
                                    width: 72mm !important; /* standard safe area for 80mm roll */
                                    max-width: 72mm !important;
                                    border: none !important;
                                    border-top: none !important;
                                    box-shadow: none !important;
                                    padding: 2mm 0 4mm 0 !important;
                                    margin: 0 !important;
                                    background: #fff !important;
                                    color: #000 !important;
                                    font-family: monospace !important;
                                    font-size: 11px !important;
                                    line-height: 1.3 !important;
                                }
                                .print-actions {
                                    display: none !important;
                                }
                            }
                        `}</style>

                        {/* Invoice Header */}
                        <div className="text-center space-y-0.5">
                            <h2 className="text-sm font-black tracking-tight text-black uppercase">KKHANE HOTEL &amp; RESTAURANT</h2>
                            <p className="text-[10px] text-gray-600">Lalitpur, Nepal · Tel: 01-5500000</p>
                            <div className="border-t border-dashed border-black my-1.5" />
                            <p className="font-bold text-[11px] uppercase tracking-wider">*** INVOICE ***</p>
                            <p className="text-[9px] text-gray-500 font-mono">No: INV-{activeInvoice.id.slice(0,8).toUpperCase()}</p>
                            <p className="text-[9px] text-gray-500 font-mono">Date: {new Date().toLocaleString()}</p>
                        </div>

                        <div className="border-t border-dashed border-black my-1.5" />

                        {/* Guest / Table Info */}
                        <div className="space-y-0.5 text-[10px]">
                            <div className="flex justify-between">
                                <span className="font-bold">GUEST:</span>
                                <span>{activeInvoice.guestName || 'Walk-in Customer'}</span>
                            </div>
                            {activeInvoice.guestPhone && (
                                <div className="flex justify-between">
                                    <span className="font-bold">PHONE:</span>
                                    <span>{activeInvoice.guestPhone}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="font-bold">REF:</span>
                                <span className="font-bold uppercase text-brand-600">{activeInvoice.label}</span>
                            </div>
                            {activeInvoice.roomType && (
                                <div className="flex justify-between">
                                    <span className="font-bold">TYPE:</span>
                                    <span>{activeInvoice.roomType}</span>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-dashed border-black my-1.5" />

                        {/* Line Items */}
                        <div className="space-y-1">
                            <div className="flex justify-between text-[10px] font-bold pb-1 border-b border-dashed border-black">
                                <span className="w-1/2 text-left">DESC</span>
                                <span className="w-12 text-center">QTY</span>
                                <span className="w-16 text-right">RATE</span>
                                <span className="w-16 text-right text-black">AMT</span>
                            </div>
                            
                            <div className="divide-y divide-dashed divide-gray-200 text-[10px] space-y-1 pt-1.5">
                                {/* Stay Charge (if room) */}
                                {activeInvoice.type === 'room' && (
                                    <div className="flex justify-between py-0.5">
                                        <span className="w-1/2 text-left truncate">Room Stay ({activeInvoice.nights}n)</span>
                                        <span className="w-12 text-center">{activeInvoice.nights}</span>
                                        <span className="w-16 text-right">{money(activeInvoice.basePrice)}</span>
                                        <span className="w-16 text-right font-bold text-black">{money(activeInvoice.stayCost)}</span>
                                    </div>
                                )}

                                {/* Additional charges */}
                                {activeInvoice.manualCharges && activeInvoice.manualCharges.map((c: any) => (
                                    <div key={c.id} className="flex justify-between py-0.5">
                                        <span className="w-1/2 text-left truncate capitalize">{c.description}</span>
                                        <span className="w-12 text-center">1</span>
                                        <span className="w-16 text-right">{money(c.amount)}</span>
                                        <span className="w-16 text-right font-bold text-black">{money(c.amount)}</span>
                                    </div>
                                ))}

                                {/* QR / Session order items */}
                                {activeInvoice.type === 'room' ? (
                                    activeInvoice.qrOrders && activeInvoice.qrOrders.map((item: any, idx: number) => (
                                        <div key={idx} className="flex justify-between py-0.5">
                                            <span className="w-1/2 text-left truncate">Food: {item.name}</span>
                                            <span className="w-12 text-center">{item.quantity}</span>
                                            <span className="w-16 text-right">{money(item.unitPrice)}</span>
                                            <span className="w-16 text-right font-bold text-black">{money(item.unitPrice * item.quantity)}</span>
                                        </div>
                                    ))
                                ) : (
                                    activeInvoice.qrOrders && activeInvoice.qrOrders.map((item: any, idx: number) => (
                                        <div key={idx} className="flex justify-between py-0.5">
                                            <span className="w-1/2 text-left truncate">{item.name}</span>
                                            <span className="w-12 text-center">{item.quantity}</span>
                                            <span className="w-16 text-right">{money(item.unitPrice)}</span>
                                            <span className="w-16 text-right font-bold text-black">{money(item.unitPrice * item.quantity)}</span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="border-t border-dashed border-black my-1.5" />

                        {/* Invoice Total */}
                        <div className="flex justify-between items-center text-xs font-black">
                            <span className="uppercase">GRAND TOTAL</span>
                            <span className="text-sm font-black text-black tabular-nums">{money(activeInvoice.total)}</span>
                        </div>

                        <div className="border-t border-dashed border-black my-1.5" />

                        {/* Thermal Printer Welcome Greeting */}
                        <div className="text-center text-[9px] text-gray-500 uppercase tracking-widest leading-normal pt-1 pb-2">
                            <p>*** THANK YOU! ***</p>
                            <p>WE HOPE TO SEE YOU AGAIN</p>
                        </div>

                        {/* Invoice Footer Actions (Print, Mark Paid, Close) */}
                        <div className="flex gap-2 pt-3 border-t border-gray-100 print-actions flex-wrap">
                            <Button 
                                variant="secondary" 
                                onClick={() => setActiveInvoice(null)}
                                className="font-bold flex-1 text-[10px] py-1.5 min-w-[70px]"
                            >
                                Cancel
                            </Button>
                            <button
                                onClick={() => window.print()}
                                className="flex-1 py-1.5 px-3 border border-gray-300 rounded-xl text-[10px] font-bold text-gray-700 bg-white hover:bg-gray-50 transition active:scale-95 text-center flex items-center justify-center gap-1.5 shadow-sm min-w-[70px]"
                            >
                                Print Bill
                            </button>
                            <Button 
                                variant="primary" 
                                loading={isSettlingInvoice}
                                onClick={handleMarkPaid}
                                className="font-bold flex-1 bg-emerald-600 hover:bg-emerald-700 border-emerald-600 hover:border-emerald-700 text-[10px] text-white py-1.5 min-w-[70px]"
                            >
                                Mark Paid
                            </Button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
