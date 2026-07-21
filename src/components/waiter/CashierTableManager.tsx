'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { setTableStatus, openSession, linkSessionToBooking, findBookingByRoom, cancelTransientSession, closeSession } from '@/app/(staff)/waiter/actions'
import { createClient } from '@/lib/supabase/client'
import { Users, X, Check, CalendarClock, Eye, ShoppingCart, Hotel, Phone, Search, Loader2, Bed, UserCheck } from 'lucide-react'
import type { Table, Session } from '@/types/database'
import { toast } from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { useCurrency, useFeatures } from '@/lib/contexts/FeatureContext'
import { getItemDisplayName } from '@/lib/utils'
import QuickOrderModal from './QuickOrderModal'

export type TableWithSession = Table & { activeSession?: Session | null; otherActiveSessions?: Session[] }

const STATUS_CONFIG = {
    active:    { dot: 'bg-success animate-pulse', card: 'border-success/20 bg-success/5', label: 'Occupied', labelCls: 'text-success-fg' },
    dirty:     { dot: 'bg-warning',               card: 'border-warning/20 bg-warning/5', label: 'Dirty',    labelCls: 'text-warning-fg' },
    reserved:  { dot: 'bg-info',                  card: 'border-info/20 bg-info/5',       label: 'Reserved', labelCls: 'text-info-fg' },
    available: { dot: 'bg-ink-subtle',            card: 'border-hairline bg-surface',     label: '',         labelCls: '' },
}

function getSeatSession(table: TableWithSession, seatNumber: number): Session | null {
    if (table.activeSession?.seat_number === seatNumber) return table.activeSession
    return (table.otherActiveSessions || []).find(s => s.seat_number === seatNumber) || null
}

function getEffectiveStatus(table: TableWithSession, isHotel?: boolean): string {
    if (table.activeSession) return 'active'
    const status = table.table_status || 'available'
    if (isHotel && status === 'dirty') return 'available'
    return status
}

function getFontSizeClass(label: string): string {
    const len = label.length
    if (len <= 3) return 'text-xl sm:text-2xl md:text-3xl'
    if (len <= 6) return 'text-lg sm:text-xl md:text-2xl'
    if (len <= 10) return 'text-sm sm:text-base md:text-lg'
    return 'text-xs sm:text-sm md:text-base'
}

export default function CashierTableManager({
    initialTables,
    restaurantId,
    activeOrders,
    unpaidOrders,
    userId,
    spaceFilter,
    onSwitchToBilling,
    isHotel,
}: {
    initialTables: TableWithSession[]
    restaurantId: string
    activeOrders: any[]
    unpaidOrders: any[]
    userId: string
    spaceFilter: 'all' | 'available' | 'reserved' | 'occupied' | 'dirty'
    onSwitchToBilling: (sessionId: string) => void
    isHotel: boolean
}) {
    const [tables, setTables] = useState<TableWithSession[]>(initialTables)
    const [selectedTable, setSelectedTable] = useState<TableWithSession | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const money = useCurrency()
    const features = useFeatures()
    const kdsEnabled = !features.kotEnabled && (features.kdsEnabled ?? true)

    const getTableCookingStatus = (table: TableWithSession) => {
        if (!table.activeSession) return null
        if (!kdsEnabled) return 'Occupied'
        
        const sessionId = table.activeSession.id
        const sessionOrders = activeOrders.filter(o => o.session_id === sessionId)
        const sessionUnpaid = unpaidOrders.filter(o => o.session_id === sessionId)
        
        if (sessionOrders.length === 0 && sessionUnpaid.length === 0) {
            return 'Occupied'
        }
        
        const allOrders = [...sessionOrders, ...sessionUnpaid]
        
        if (allOrders.some(o => o.status === 'ready' || (o.order_items && o.order_items.some((i: any) => i.status === 'ready')))) {
            return 'Ready'
        }
        
        if (allOrders.some(o => ['pending', 'confirmed', 'preparing'].includes(o.status) || (o.order_items && o.order_items.some((i: any) => ['pending', 'preparing'].includes(i.status))))) {
            return 'Cooking'
        }
        
        if (allOrders.every(o => o.status === 'delivered' || o.status === 'served')) {
            return 'Served'
        }
        
        return 'Occupied'
    }

    // Form inputs for reservation
    const [reserveName, setReserveName] = useState('')
    const [reservePhone, setReservePhone] = useState('')

    // Choice step inside the Table click modal
    const [choiceStep, setChoiceStep] = useState<'options' | 'manual_order' | 'reserve'>('options')
    const [quickOrderSession, setQuickOrderSession] = useState<{ sessionId: string; tableName: string; sessionUuid?: string; tableId?: string } | null>(null)
    const quickOrderPlacedRef = useRef(false)
    const [vacantSeatNumber, setVacantSeatNumber] = useState<number | null>(null)
    const [vacantSeatStep, setVacantSeatStep] = useState<'choose' | 'room_lookup'>('choose')
    const [phoneInput, setPhoneInput] = useState('')
    const [phoneSearching, setPhoneSearching] = useState(false)
    const [phoneResult, setPhoneResult] = useState<any | null | undefined>(null)
    const [splitView, setSplitView] = useState(false)
    const [activeSeat, setActiveSeat] = useState<number | null>(null)

    const supabaseRef = useRef(createClient())

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (selectedTable) {
            setChoiceStep('options')
            setReserveName('')
            setReservePhone('')
            setPhoneInput('')
            setPhoneSearching(false)
            setPhoneResult(null)
            setSplitView(false)
            setVacantSeatNumber(null)
            setActiveSeat(null)
        }
    }, [selectedTable])

    // Realtime subscriptions
    useRestaurantTable(restaurantId, 'sessions', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new as Session
            const seatNumber = s.seat_number ?? 1
            const patch = seatNumber === 1
                ? { activeSession: s }
                : (t: TableWithSession) => ({ otherActiveSessions: [...(t.otherActiveSessions || []).filter(x => x.id !== s.id), s] })
            
            setTables(prev => prev.map(t => t.id === s.table_id
                ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
                : t))
            setSelectedTable(prev => prev?.id === s.table_id
                ? { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
                : prev)
        } else if (payload.eventType === 'UPDATE') {
            const s = payload.new as Session
            const isClosed = s.status === 'closed' || s.status === 'expired'
            
            setTables(prev => prev.map(t => {
                if (t.activeSession?.id === s.id) {
                    return { ...t, activeSession: isClosed ? null : s }
                }
                if (t.otherActiveSessions?.some(x => x.id === s.id)) {
                    return {
                        ...t,
                        otherActiveSessions: isClosed
                            ? t.otherActiveSessions.filter(x => x.id !== s.id)
                            : t.otherActiveSessions.map(x => x.id === s.id ? s : x)
                    }
                }
                return t
            }))
            setSelectedTable(prev => {
                if (!prev) return null
                if (prev.activeSession?.id === s.id) {
                    return { ...prev, activeSession: isClosed ? null : s }
                }
                if (prev.otherActiveSessions?.some(x => x.id === s.id)) {
                    return {
                        ...prev,
                        otherActiveSessions: isClosed
                            ? prev.otherActiveSessions.filter(x => x.id !== s.id)
                            : prev.otherActiveSessions.map(x => x.id === s.id ? s : x)
                    }
                }
                return prev
            })
        }
    })

    useRestaurantTable(restaurantId, 'tables', (payload) => {
        if (payload.eventType !== 'UPDATE') return
        const u = payload.new as TableWithSession
        const patch = {
            table_status: u.table_status,
            cleaning_claimed_by: u.cleaning_claimed_by ?? null,
            cleaning_claimed_at: u.cleaning_claimed_at ?? null,
        }
        setTables(prev => prev.map(t => t.id === u.id ? { ...t, ...patch } : t))
        setSelectedTable(prev => prev?.id === u.id ? { ...prev, ...patch } : prev)
    })

    // Filter tables
    const filteredTables = useMemo(() => {
        if (spaceFilter === 'all') return tables
        return tables.filter(t => {
            const status = getEffectiveStatus(t, isHotel)
            if (spaceFilter === 'occupied') return status === 'active'
            return status === spaceFilter
        })
    }, [tables, spaceFilter, isHotel])

    // Get active session orders & items for the selected occupied table
    const tableSessionDetails = useMemo(() => {
        if (!selectedTable?.activeSession) return null

        const sessionId = selectedTable.activeSession.id
        // Get all matching orders
        const allActive = activeOrders.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaidOrders.filter(o => o.session_id === sessionId)
        const combinedOrders = [...allActive, ...allUnpaid]

        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        let total = 0

        for (const order of combinedOrders) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                const name = getItemDisplayName(item)
                const qty = item.quantity || 0
                const price = Number(item.unit_price ?? 0)
                const status = item.status || order.status || 'unknown'
                items.push({ name, quantity: qty, unitPrice: price, status })
                total += price * qty
            }
        }

        return { items, total, sessionId }
    }, [selectedTable, activeOrders, unpaidOrders])

    const handleReserve = async () => {
        if (!selectedTable) return
        if (!reserveName.trim()) {
            toast.error('Please enter a guest name')
            return
        }

        setIsProcessing(true)
        // Set table status to reserved
        const res = await setTableStatus(selectedTable.id, 'reserved')
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`Table ${selectedTable.label} reserved for ${reserveName}`)
            setSelectedTable(null)
            setReserveName('')
            setReservePhone('')
        }
        setIsProcessing(false)
    }

    const handleReleaseReservation = async () => {
        if (!selectedTable) return
        setIsProcessing(true)
        const res = await setTableStatus(selectedTable.id, 'available')
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`Reservation released for Table ${selectedTable.label}`)
            setSelectedTable(null)
        }
        setIsProcessing(false)
    }

    const handleSilentOpenSeatSession = async (tableId: string, seatNumber: number) => {
        setIsProcessing(true)
        try {
            const res = await openSession(tableId, restaurantId, undefined, seatNumber)
            if (res.error || !res.session) {
                toast.error(res.error || 'Failed to open seat')
                setIsProcessing(false)
                return
            }
            const session = res.session as unknown as Session
            await setTableStatus(tableId, 'available')
            
            const patch = seatNumber === 1
                ? { activeSession: session }
                : (t: TableWithSession) => ({ otherActiveSessions: [...(t.otherActiveSessions || []).filter(x => x.id !== session.id), session] })
            
            setTables(prev => prev.map(t => t.id === tableId
                ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
                : t))
            
            quickOrderPlacedRef.current = false
            setQuickOrderSession({
                sessionId: session.session_token,
                tableName: seatNumber === 1 && !splitView ? `${selectedTable?.label || 'Table'}` : `${selectedTable?.label || 'Table'}-${seatNumber}`,
                sessionUuid: session.id,
                tableId,
            })
            setSelectedTable(null)
            setVacantSeatNumber(null)
        } catch (err) {
            toast.error('Failed to open seat session')
        } finally {
            setIsProcessing(false)
        }
    }

    const handleSilentOpenSeatSessionAndLink = async (tableId: string, bookingId: string, roomNumber: string, seatNumber: number = 1) => {
        setIsProcessing(true)
        try {
            const res = await openSession(tableId, restaurantId, undefined, seatNumber)
            if (res.error || !res.session) {
                toast.error(res.error || 'Failed to open seat')
                setIsProcessing(false)
                return
            }
            const session = res.session as unknown as Session
            await setTableStatus(tableId, 'available')
            
            const linkRes = await linkSessionToBooking(session.id, bookingId)
            if (linkRes.error) {
                toast.error(linkRes.error)
                setIsProcessing(false)
                return
            }
            
            toast.success(`Linked to Room ${roomNumber}`)
            const sessionWithBooking = { ...session, booking_id: bookingId }
            const patch = seatNumber === 1
                ? { activeSession: sessionWithBooking }
                : (t: TableWithSession) => ({ otherActiveSessions: [...(t.otherActiveSessions || []).filter(x => x.id !== session.id), sessionWithBooking] })
            
            setTables(prev => prev.map(t => t.id === tableId
                ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
                : t))
            
            quickOrderPlacedRef.current = false
            setQuickOrderSession({
                sessionId: session.session_token,
                tableName: seatNumber === 1 && !splitView ? `${selectedTable?.label || 'Table'}` : `${selectedTable?.label || 'Table'}-${seatNumber}`,
                sessionUuid: session.id,
                tableId,
            })
            setSelectedTable(null)
            setVacantSeatNumber(null)
        } catch (err) {
            toast.error('Failed to open and link session')
        } finally {
            setIsProcessing(false)
        }
    }



    return (
        <div className="w-full">
            <div className="p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4 bg-surface rounded-3xl border border-hairline shadow-sm">
                {filteredTables.length === 0 ? (
                    <div className="col-span-full py-12 text-center">
                        <p className="text-sm font-semibold text-ink-muted">No tables found matching this filter</p>
                    </div>
                ) : (
                    filteredTables.map(table => {
                        const status = getEffectiveStatus(table, isHotel)
                        const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available
                        
                        let displayStatusLabel = cfg.label
                        let displayLabelCls = cfg.labelCls
                        let displayDotCls = cfg.dot
                        let displayCardCls = cfg.card

                        if (status === 'active') {
                            const cookingStatus = getTableCookingStatus(table)
                            if (cookingStatus === 'Ready') {
                                displayStatusLabel = 'Ready'
                                displayLabelCls = 'text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm text-[8px]'
                                displayDotCls = 'bg-emerald-500 animate-pulse'
                                displayCardCls = 'border-emerald-200 bg-emerald-50/10'
                            } else if (cookingStatus === 'Cooking') {
                                displayStatusLabel = 'Cooking'
                                displayLabelCls = 'text-brand-600 bg-brand-50 border border-orange-100 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm animate-pulse text-[8px]'
                                displayDotCls = 'bg-brand-500 animate-pulse'
                                displayCardCls = 'border-brand-200 bg-brand-50/10'
                            } else if (cookingStatus === 'Served') {
                                displayStatusLabel = 'Served'
                                displayLabelCls = 'text-ink-subtle bg-surface-muted border border-gray-150 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm text-[8px]'
                                displayDotCls = 'bg-gray-400'
                                displayCardCls = 'border-hairline-strong bg-surface-muted/10'
                            } else {
                                displayStatusLabel = 'Occupied'
                                displayLabelCls = 'text-success-fg bg-success-bg border border-success/20 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm text-[8px]'
                                displayDotCls = 'bg-success animate-pulse'
                                displayCardCls = 'border-success/20 bg-success/5'
                            }
                        } else if (status === 'dirty') {
                            displayStatusLabel = 'Dirty'
                            displayLabelCls = 'text-warning-fg bg-warning-bg border border-warning/20 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm text-[8px]'
                        } else if (status === 'reserved') {
                            displayStatusLabel = 'Reserved'
                            displayLabelCls = 'text-info-fg bg-info-bg border border-info/20 px-1.5 py-0.5 rounded-md font-extrabold shadow-sm text-[8px]'
                        }

                        return (
                            <button
                                key={table.id}
                                onClick={() => {
                                    setReserveName('')
                                    setReservePhone('')
                                    setSelectedTable(table)
                                }}
                                className={`relative aspect-square rounded-[20px] border flex flex-col items-center justify-center transition-all duration-300 ${displayCardCls} hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95`}
                            >
                                <span className={`${getFontSizeClass(table.label || '')} font-extrabold tracking-tight text-ink leading-tight text-center break-words max-w-full px-1.5`}>
                                    {table.label}
                                </span>
                                {table.capacity && (
                                    <span className="flex items-center gap-0.5 text-caption text-ink-subtle mt-0.5">
                                        <Users size={9} />{table.capacity}
                                    </span>
                                )}
                                {displayStatusLabel && (
                                    <span className={`uppercase tracking-wide mt-1.5 ${displayLabelCls}`}>{displayStatusLabel}</span>
                                )}
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${displayDotCls}`} />
                            </button>
                        )
                    })
                )}
            </div>

            {/* Modal Overlay */}
            {mounted && selectedTable && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setSelectedTable(null)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md overflow-hidden transform transition-all"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink">
                                    {selectedTable.label.toLowerCase().startsWith('table') 
                                        ? selectedTable.label 
                                        : `Table ${selectedTable.label}`}
                                </h3>
                                <p className="text-caption text-ink-subtle mt-0.5">
                                    {selectedTable.activeSession
                                        ? `Occupied (${getTableCookingStatus(selectedTable)})`
                                        : selectedTable.table_status === 'reserved'
                                            ? 'Reserved'
                                            : (selectedTable.table_status === 'dirty' && isHotel)
                                                ? 'Available'
                                                : selectedTable.table_status === 'dirty'
                                                    ? 'Needs cleaning'
                                                    : 'Available'}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedTable(null)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[75vh] overflow-y-auto">
                            {selectedTable.table_status === 'reserved' ? (
                                <div className="space-y-4">
                                    <div className="flex flex-col items-center py-2 text-info-fg">
                                        <CalendarClock size={44} strokeWidth={1.5} />
                                        <p className="text-center text-xs font-semibold text-ink-muted mt-2">This table is currently reserved</p>
                                    </div>
                                    <Button 
                                        block 
                                        variant="secondary" 
                                        icon={X} 
                                        loading={isProcessing} 
                                        onClick={handleReleaseReservation}
                                    >
                                        Release Reservation
                                    </Button>
                                </div>
                            ) : choiceStep === 'options' ? (
                                // OPTIONS STEP (Default view when clicked)
                                <div className="space-y-4">
                                    {selectedTable.activeSession ? (
                                        // Occupied Option Choice
                                        <div className="space-y-4">
                                            <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Active Order Items</h4>
                                            {tableSessionDetails && tableSessionDetails.items.length > 0 ? (
                                                <div className="space-y-2 max-h-48 overflow-y-auto border border-hairline rounded-xl p-3 bg-surface-muted/50 divide-y divide-gray-100">
                                                    {tableSessionDetails.items.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between items-center py-2 text-xs">
                                                            <div className="flex-1 min-w-0 pr-2">
                                                                <p className="font-extrabold text-ink truncate text-[13px]">{item.name}</p>
                                                                <p className="text-[10px] text-ink-subtle capitalize">
                                                                    Status: <span className="text-brand-500 font-extrabold">{item.status}</span>
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-3 shrink-0">
                                                                <span className="text-xs font-extrabold text-brand-600 bg-brand-50 border border-brand-100/50 px-2 py-0.5 rounded-lg tabular-nums">
                                                                    {item.quantity}×
                                                                </span>
                                                                <span className="font-semibold text-ink-muted tabular-nums">{money(item.unitPrice * item.quantity)}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="p-4 text-center border border-dashed border-hairline-strong rounded-xl">
                                                    <p className="text-xs text-ink-subtle">No active items ordered yet</p>
                                                </div>
                                            )}

                                            {tableSessionDetails && (
                                                <div className="flex justify-between items-center py-3 px-1 border-t border-hairline font-bold text-sm">
                                                    <span className="text-ink-muted">Total Amount:</span>
                                                    <span className="text-brand-600 text-base tabular-nums">{money(tableSessionDetails.total)}</span>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-2 gap-3 pt-2">
                                                <Button
                                                    variant="secondary"
                                                    icon={ShoppingCart}
                                                    block
                                                    onClick={() => {
                                                        // If it's a split table (has other sessions), let's open the manual order seats menu
                                                        if ((selectedTable.otherActiveSessions?.length ?? 0) > 0) {
                                                            setChoiceStep('manual_order')
                                                            setSplitView(true)
                                                        } else {
                                                            // Regular combined table session
                                                            setQuickOrderSession({
                                                                sessionId: selectedTable.activeSession!.session_token,
                                                                tableName: selectedTable.label
                                                            })
                                                            setSelectedTable(null)
                                                        }
                                                    }}
                                                >
                                                    Manual Order
                                                </Button>
                                                <Button
                                                    variant="primary"
                                                    icon={Eye}
                                                    block
                                                    onClick={() => {
                                                        if (tableSessionDetails) {
                                                            onSwitchToBilling(tableSessionDetails.sessionId)
                                                        }
                                                        setSelectedTable(null)
                                                    }}
                                                >
                                                    View Bill
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        // Available Option Choice
                                        <div className="space-y-3">
                                            <p className="text-caption text-ink-subtle text-center pb-2">Select an action for Table {selectedTable.label}</p>
                                            <Button
                                                block
                                                variant="primary"
                                                icon={ShoppingCart}
                                                onClick={() => {
                                                    setChoiceStep('manual_order')
                                                    setVacantSeatNumber(1)
                                                    setVacantSeatStep('choose')
                                                }}
                                            >
                                                Manual Order
                                            </Button>
                                            <Button
                                                block
                                                variant="secondary"
                                                icon={CalendarClock}
                                                onClick={() => setChoiceStep('reserve')}
                                            >
                                                Reserve Table
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ) : choiceStep === 'reserve' ? (
                                // RESERVE STEP
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-hairline">
                                        <h4 className="text-xs font-extrabold uppercase text-ink-subtle tracking-wider">Reserve Table {selectedTable.label}</h4>
                                        <button onClick={() => setChoiceStep('options')} className="text-xs text-brand-500 font-bold hover:underline">← Back</button>
                                    </div>
                                    <div className="space-y-3.5">
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-ink-subtle uppercase">Guest Name</label>
                                            <input
                                                type="text"
                                                value={reserveName}
                                                onChange={(e) => setReserveName(e.target.value)}
                                                placeholder="Enter name"
                                                className="w-full px-3.5 py-2.5 rounded-xl border border-hairline text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-surface"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-ink-subtle uppercase">Phone Number</label>
                                            <input
                                                type="tel"
                                                value={reservePhone}
                                                onChange={(e) => setReservePhone(e.target.value)}
                                                placeholder="Enter phone number"
                                                className="w-full px-3.5 py-2.5 rounded-xl border border-hairline text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-surface"
                                            />
                                        </div>

                                        <Button 
                                            block 
                                            variant="primary" 
                                            icon={CalendarClock} 
                                            loading={isProcessing} 
                                            onClick={handleReserve}
                                            className="mt-2"
                                        >
                                            Reserve Table
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                // MANUAL ORDER / GUEST TYPE / SEATS FLOW
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between pb-2 border-b border-hairline mb-2">
                                        <h4 className="text-xs font-extrabold uppercase text-ink-subtle tracking-wider">
                                            {splitView ? `Seats - Table ${selectedTable.label}` : `New Order - Table ${selectedTable.label}`}
                                        </h4>
                                        <button 
                                            onClick={() => {
                                                if (splitView && vacantSeatNumber === null && activeSeat === null) {
                                                    setSplitView(false)
                                                    setChoiceStep('options')
                                                } else if (vacantSeatNumber !== null) {
                                                    if (vacantSeatStep === 'room_lookup') {
                                                        setVacantSeatStep('choose')
                                                    } else {
                                                        setVacantSeatNumber(null)
                                                    }
                                                } else if (activeSeat !== null) {
                                                    setActiveSeat(null)
                                                } else {
                                                    setChoiceStep('options')
                                                }
                                            }} 
                                            className="text-xs text-brand-500 font-bold hover:underline"
                                        >
                                            ← Back
                                        </button>
                                    </div>

                                    {splitView ? (
                                        vacantSeatNumber !== null ? (
                                            // Seat configuration: vacant seat opened
                                            <div className="space-y-4">
                                                <h5 className="text-sm font-black text-center text-ink">Seat {selectedTable.label}-{vacantSeatNumber}</h5>
                                                {vacantSeatStep === 'choose' ? (
                                                    <div className="space-y-3">
                                                        <p className="text-caption text-ink-subtle text-center">Select guest type for seat</p>
                                                        <Button
                                                            block
                                                            variant="primary"
                                                            icon={Hotel}
                                                            onClick={() => {
                                                                setVacantSeatStep('room_lookup')
                                                                setPhoneInput('')
                                                                setPhoneResult(null)
                                                            }}
                                                        >
                                                            Hotel Guest (Link to Room)
                                                        </Button>
                                                        <Button
                                                            block
                                                            variant="secondary"
                                                            icon={ShoppingCart}
                                                            loading={isProcessing}
                                                            onClick={() => handleSilentOpenSeatSession(selectedTable.id, vacantSeatNumber)}
                                                        >
                                                            Outside Guest (Direct Order)
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    // Room lookup flow
                                                    <div className="space-y-4">
                                                        <p className="text-caption text-ink-subtle text-center">Enter room number to link guest</p>
                                                        <div className="relative">
                                                            <Bed size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                                                            <input
                                                                type="text"
                                                                value={phoneInput}
                                                                onChange={e => setPhoneInput(e.target.value)}
                                                                placeholder="e.g. 101"
                                                                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-hairline bg-surface text-ink text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                                                                autoFocus
                                                                onKeyDown={async (e) => {
                                                                    if (e.key === 'Enter' && phoneInput.trim().length > 0 && !phoneSearching) {
                                                                        setPhoneSearching(true)
                                                                        setPhoneResult(null)
                                                                        const res = await findBookingByRoom(phoneInput, restaurantId)
                                                                        if (res.success) {
                                                                            setPhoneResult(res.booking || undefined)
                                                                        } else {
                                                                            toast.error(res.error || 'Search failed')
                                                                        }
                                                                        setPhoneSearching(false)
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                        <Button
                                                            block
                                                            variant="primary"
                                                            icon={phoneSearching ? Loader2 : Search}
                                                            loading={phoneSearching}
                                                            disabled={phoneInput.trim().length === 0}
                                                            onClick={async () => {
                                                                setPhoneSearching(true)
                                                                setPhoneResult(null)
                                                                const res = await findBookingByRoom(phoneInput, restaurantId)
                                                                if (res.success) {
                                                                    setPhoneResult(res.booking || undefined)
                                                                } else {
                                                                    toast.error(res.error || 'Search failed')
                                                                }
                                                                setPhoneSearching(false)
                                                            }}
                                                        >
                                                            Search Booking
                                                        </Button>

                                                        {phoneResult === undefined && (
                                                            <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 text-center">
                                                                <p className="text-xs font-semibold text-warning-fg">No active check-in found</p>
                                                            </div>
                                                        )}

                                                        {phoneResult && (
                                                            <div className="bg-success/10 border border-success/20 rounded-xl p-4">
                                                                <p className="text-xs font-bold text-ink truncate mb-2">{phoneResult.guest_name}</p>
                                                                <Button
                                                                    block
                                                                    variant="primary"
                                                                    icon={ShoppingCart}
                                                                    loading={isProcessing}
                                                                    onClick={() => handleSilentOpenSeatSessionAndLink(selectedTable.id, phoneResult.id, phoneResult.rooms?.room_number || '?', vacantSeatNumber)}
                                                                >
                                                                    Link to Room &amp; Order
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : activeSeat !== null ? (
                                            // Seat configuration: occupied seat selected
                                            (() => {
                                                const session = getSeatSession(selectedTable, activeSeat)
                                                return (
                                                    <div className="space-y-4">
                                                        <h5 className="text-sm font-black text-center text-ink">Seat {selectedTable.label}-{activeSeat}</h5>
                                                        {session && (
                                                            <div className="bg-surface-muted rounded-xl p-4 border border-hairline text-center">
                                                                {session.booking_id ? (
                                                                    <p className="text-caption text-success-fg font-semibold">Linked to Room Bill</p>
                                                                ) : (
                                                                    <p className="text-caption text-ink-subtle">Outside Guest (Direct Order)</p>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div className="flex flex-col gap-3">
                                                            <Button
                                                                variant="primary"
                                                                block
                                                                icon={ShoppingCart}
                                                                onClick={() => {
                                                                    if (session) {
                                                                        setQuickOrderSession({ sessionId: session.session_token, tableName: `${selectedTable.label}-${activeSeat}` })
                                                                        setSelectedTable(null)
                                                                    }
                                                                }}
                                                            >
                                                                Add Items (Manual Order)
                                                            </Button>
                                                            <Button
                                                                variant="secondary"
                                                                block
                                                                icon={Eye}
                                                                onClick={() => {
                                                                    if (session) {
                                                                        onSwitchToBilling(session.id)
                                                                        setSelectedTable(null)
                                                                    }
                                                                }}
                                                            >
                                                                View / Settle Bill
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )
                                            })()
                                        ) : (
                                            // Seats selection grid
                                            <div className="space-y-4">
                                                <p className="text-caption text-ink-subtle text-center">Tap a seat to order or manage.</p>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {Array.from({ length: selectedTable.capacity || 4 }, (_, i) => i + 1).map(seatNumber => {
                                                        const session = getSeatSession(selectedTable, seatNumber)
                                                        return (
                                                            <button
                                                                key={seatNumber}
                                                                disabled={isProcessing}
                                                                onClick={() => {
                                                                    if (session) {
                                                                        setActiveSeat(seatNumber)
                                                                    } else {
                                                                        setVacantSeatNumber(seatNumber)
                                                                        setVacantSeatStep('choose')
                                                                        setPhoneInput('')
                                                                        setPhoneResult(null)
                                                                    }
                                                                }}
                                                                className={`rounded-2xl border p-4 flex flex-col items-center gap-1 transition-all disabled:opacity-50 ${
                                                                    session ? 'border-success/30 bg-success/5 hover:bg-success/10' : 'border-hairline bg-surface hover:bg-surface-muted'
                                                                }`}
                                                            >
                                                                <span className="font-extrabold text-ink text-sm">{selectedTable.label}-{seatNumber}</span>
                                                                <span className={`text-[10px] font-bold uppercase tracking-wide ${session ? 'text-success-fg' : 'text-ink-subtle'}`}>
                                                                    {session ? 'Occupied' : 'Tap to open'}
                                                                </span>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    ) : (
                                        // Vacant table: choose type flow
                                        vacantSeatNumber === 1 && (
                                            vacantSeatStep === 'choose' ? (
                                                <div className="space-y-3">
                                                    <p className="text-caption text-ink-subtle text-center">Select guest type to open table session</p>
                                                    <Button
                                                        block
                                                        variant="primary"
                                                        icon={Hotel}
                                                        onClick={() => {
                                                            setVacantSeatStep('room_lookup')
                                                            setPhoneInput('')
                                                            setPhoneResult(null)
                                                        }}
                                                    >
                                                        Hotel Guest (Link to Room)
                                                    </Button>
                                                    <Button
                                                        block
                                                        variant="secondary"
                                                        icon={ShoppingCart}
                                                        loading={isProcessing}
                                                        onClick={() => handleSilentOpenSeatSession(selectedTable.id, 1)}
                                                    >
                                                        Outside Guest (Direct Order)
                                                    </Button>
                                                    <Button
                                                        block
                                                        variant="secondary"
                                                        icon={Users}
                                                        onClick={() => {
                                                            setSplitView(true)
                                                            setVacantSeatNumber(null)
                                                        }}
                                                    >
                                                        Split / Order by Seat
                                                    </Button>
                                                </div>
                                            ) : (
                                                // Room lookup flow
                                                <div className="space-y-4">
                                                    <p className="text-caption text-ink-subtle text-center">Enter room number to link guest</p>
                                                    <div className="relative">
                                                        <Bed size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                                                        <input
                                                            type="text"
                                                            value={phoneInput}
                                                            onChange={e => setPhoneInput(e.target.value)}
                                                            placeholder="e.g. 101"
                                                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-hairline bg-surface text-ink text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
                                                            autoFocus
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter' && phoneInput.trim().length > 0 && !phoneSearching) {
                                                                    setPhoneSearching(true)
                                                                    setPhoneResult(null)
                                                                    const res = await findBookingByRoom(phoneInput, restaurantId)
                                                                    if (res.success) {
                                                                        setPhoneResult(res.booking || undefined)
                                                                    } else {
                                                                        toast.error(res.error || 'Search failed')
                                                                    }
                                                                    setPhoneSearching(false)
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    <Button
                                                        block
                                                        variant="primary"
                                                        icon={phoneSearching ? Loader2 : Search}
                                                        loading={phoneSearching}
                                                        disabled={phoneInput.trim().length === 0}
                                                        onClick={async () => {
                                                            setPhoneSearching(true)
                                                            setPhoneResult(null)
                                                            const res = await findBookingByRoom(phoneInput, restaurantId)
                                                            if (res.success) {
                                                                    setPhoneResult(res.booking || undefined)
                                                            } else {
                                                                toast.error(res.error || 'Search failed')
                                                            }
                                                            setPhoneSearching(false)
                                                        }}
                                                    >
                                                        Search Booking
                                                    </Button>

                                                    {phoneResult === undefined && (
                                                        <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 text-center">
                                                            <p className="text-xs font-semibold text-warning-fg">No active check-in found</p>
                                                        </div>
                                                    )}

                                                    {phoneResult && (
                                                        <div className="bg-success/10 border border-success/20 rounded-xl p-4">
                                                            <p className="text-xs font-bold text-ink truncate mb-2">{phoneResult.guest_name}</p>
                                                            <Button
                                                                block
                                                                variant="primary"
                                                                icon={ShoppingCart}
                                                                loading={isProcessing}
                                                                onClick={() => handleSilentOpenSeatSessionAndLink(selectedTable.id, phoneResult.id, phoneResult.rooms?.room_number || '?', 1)}
                                                            >
                                                                Link to Room &amp; Order
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        )
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {quickOrderSession && (
                <QuickOrderModal
                    isOpen={!!quickOrderSession}
                    onClose={async () => {
                        // If no order was placed and this was a transient session,
                        // cancel it cleanly — reset table to 'available', not 'dirty'
                        const snap = quickOrderSession
                        setQuickOrderSession(null)
                        if (!quickOrderPlacedRef.current && snap.sessionUuid) {
                            await cancelTransientSession(snap.sessionUuid)
                            if (snap.tableId) {
                                setTables(prev => prev.map(t =>
                                    t.id === snap.tableId
                                        ? { ...t, activeSession: undefined, table_status: 'available' }
                                        : t
                                ))
                            }
                        }
                    }}
                    onSuccess={() => {
                        quickOrderPlacedRef.current = true
                        setQuickOrderSession(null)
                    }}
                    sessionId={quickOrderSession.sessionId}
                    tableName={quickOrderSession.tableName}
                    restaurantId={restaurantId}
                />
            )}
        </div>
    )
}
