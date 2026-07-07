'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { setTableStatus, openSession } from '@/app/(staff)/waiter/actions'
import { createClient } from '@/lib/supabase/client'
import { Users, X, Check, CalendarClock, ShoppingBag, Eye } from 'lucide-react'
import type { Table, Session } from '@/types/database'
import { toast } from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { useCurrency } from '@/lib/contexts/FeatureContext'

export type TableWithSession = Table & { activeSession?: Session | null }

const STATUS_CONFIG = {
    active:    { dot: 'bg-success animate-pulse', card: 'border-success/20 bg-success/5', label: 'Occupied', labelCls: 'text-success-fg' },
    dirty:     { dot: 'bg-warning',               card: 'border-warning/20 bg-warning/5', label: 'Dirty',    labelCls: 'text-warning-fg' },
    reserved:  { dot: 'bg-info',                  card: 'border-info/20 bg-info/5',       label: 'Reserved', labelCls: 'text-info-fg' },
    available: { dot: 'bg-ink-subtle',            card: 'border-hairline bg-surface',     label: '',         labelCls: '' },
}

function getEffectiveStatus(table: TableWithSession): string {
    if (table.activeSession) return 'active'
    return table.table_status || 'available'
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
}: {
    initialTables: TableWithSession[]
    restaurantId: string
    activeOrders: any[]
    unpaidOrders: any[]
    userId: string
    spaceFilter: 'all' | 'available' | 'reserved' | 'occupied' | 'dirty'
    onSwitchToBilling: (sessionId: string) => void
}) {
    const [tables, setTables] = useState<TableWithSession[]>(initialTables)
    const [selectedTable, setSelectedTable] = useState<TableWithSession | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const money = useCurrency()

    const getTableCookingStatus = (table: TableWithSession) => {
        if (!table.activeSession) return null
        
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
    const [showReserveForm, setShowReserveForm] = useState(false)

    const supabaseRef = useRef(createClient())

    // Reset reservation form on select change
    useEffect(() => {
        setShowReserveForm(false)
    }, [selectedTable])

    useEffect(() => {
        setMounted(true)
    }, [])

    // Realtime subscriptions
    useRestaurantTable(restaurantId, 'sessions', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new as Session
            setTables(prev => prev.map(t => t.id === s.table_id ? { ...t, activeSession: s } : t))
            setSelectedTable(prev => prev?.id === s.table_id ? { ...prev, activeSession: s } : prev)
        } else if (payload.eventType === 'UPDATE') {
            const s = payload.new as Session
            const isClosed = s.status === 'closed' || s.status === 'expired'
            setTables(prev => prev.map(t => t.activeSession?.id === s.id ? { ...t, activeSession: isClosed ? null : s } : t))
            setSelectedTable(prev => prev?.activeSession?.id === s.id ? { ...prev, activeSession: isClosed ? null : s } : prev)
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
            const status = getEffectiveStatus(t)
            if (spaceFilter === 'occupied') return status === 'active'
            return status === spaceFilter
        })
    }, [tables, spaceFilter])

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
                const name = item.menu_items?.name || 'Item'
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

    const handleManualOrder = async () => {
        if (!selectedTable) return
        setIsProcessing(true)
        try {
            const res = await openSession(selectedTable.id, restaurantId)
            if (res.error) {
                toast.error(res.error)
            } else if (res.success && res.session) {
                toast.success(`Session opened for Table ${selectedTable.label}`)
                // Redirect waiter/cashier to the table's menu ordering page in waiter mode
                window.location.href = `/t/${selectedTable.qr_token}?s=${res.session.session_token}&w=1`
                setSelectedTable(null)
            }
        } catch {
            toast.error('Failed to start session')
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
                        const status = getEffectiveStatus(table)
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
                                        : selectedTable.table_status === 'dirty'
                                            ? 'Needs cleaning'
                                            : selectedTable.table_status === 'reserved'
                                                ? 'Reserved'
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
                            {selectedTable.activeSession ? (
                                // Occupied View
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

                                    <Button
                                        variant="primary"
                                        block
                                        icon={Eye}
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
                            ) : (
                                // Available / Reserved / Dirty View
                                <div className="space-y-4">
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
                                    ) : showReserveForm ? (
                                        // Reserve details form
                                        <div className="space-y-3.5">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-extrabold uppercase text-indigo-600 tracking-wider">Reserve details</h4>
                                                <button onClick={() => setShowReserveForm(false)} className="text-xs text-ink-subtle hover:underline font-semibold">Back</button>
                                            </div>
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
                                    ) : (
                                        // Big T1 label, capacity, and Choice Buttons
                                        <div className="flex flex-col items-center justify-center py-6 text-center space-y-6">
                                            <div className="space-y-1">
                                                <h1 className="text-6xl font-black text-ink tracking-tight uppercase leading-none">
                                                    {selectedTable.label}
                                                </h1>
                                                <p className="text-xs text-ink-subtle font-semibold">
                                                    {selectedTable.capacity ? `${selectedTable.capacity}-seat table` : 'Dining table'}
                                                </p>
                                            </div>

                                            <div>
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                    FREE
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 w-full pt-4">
                                                <button
                                                    onClick={handleManualOrder}
                                                    disabled={isProcessing}
                                                    className="flex flex-col items-center justify-center gap-3 py-6 px-4 bg-[#ff5a00] hover:bg-[#ff4500] text-white rounded-[28px] font-extrabold text-sm transition-all shadow-md shadow-[#ff5a00]/10 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
                                                >
                                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shadow-inner">
                                                        <ShoppingBag size={18} />
                                                    </div>
                                                    <span>Manual Order</span>
                                                </button>

                                                <button
                                                    onClick={() => setShowReserveForm(true)}
                                                    disabled={isProcessing}
                                                    className="flex flex-col items-center justify-center gap-3 py-6 px-4 bg-[#1d4ed8] hover:bg-[#1e40af] text-white rounded-[28px] font-extrabold text-sm transition-all shadow-md shadow-blue-500/10 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
                                                >
                                                    <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center shadow-inner">
                                                        <CalendarClock size={18} />
                                                    </div>
                                                    <span>Reserve</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
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
