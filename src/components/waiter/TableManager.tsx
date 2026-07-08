'use client'

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { openSession, closeSession, setTableStatus, claimTableCleaning, releaseTableCleaning, markTableClean, openSessionFromRequest, findBookingByPhone, getActiveBookings, linkSessionToBooking } from '@/app/(staff)/waiter/actions'
import { createClient } from '@/lib/supabase/client'
import { Users, QrCode, PowerOff, Power, Sparkles, CalendarClock, UtensilsCrossed, Footprints, Check, X, Flame, ShoppingCart, Hotel, Phone, Search, Loader2, Bed, UserCheck } from 'lucide-react'
import type { Table, Session } from '@/types/database'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { useRouter } from 'next/navigation'

export type TableWithSession = Table & { activeSession?: Session | null }

// Status → semantic tokens (active=success, dirty=warning, reserved=info).
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

export default function TableManager({ initialTables, restaurantId, appUrl, initialOrders = [], userId, staffNames = {}, isHotel = false }: {
    initialTables: TableWithSession[]
    restaurantId: string
    appUrl: string
    initialOrders?: { id: string; session_id: string | null; status: string }[]
    userId: string
    staffNames?: Record<string, string>
    isHotel?: boolean
}) {
    const [tables, setTables] = useState<TableWithSession[]>(initialTables)
    const [selectedTable, setSelectedTable] = useState<TableWithSession | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const { confirm } = useConfirmStore()
    const router = useRouter()

    // Hotel guest selection state
    const [showGuestPicker, setShowGuestPicker] = useState(false)
    const [guestPickerStep, setGuestPickerStep] = useState<'choose' | 'phone' | 'rooms'>('choose')
    const [phoneInput, setPhoneInput] = useState('')
    const [phoneSearching, setPhoneSearching] = useState(false)
    const [phoneResult, setPhoneResult] = useState<any>(null)
    const [activeBookingsList, setActiveBookingsList] = useState<any[]>([])
    const [loadingBookings, setLoadingBookings] = useState(false)

    // Track order statuses per order ID → { session_id, status }
    const [orderStatuses, setOrderStatuses] = useState<Record<string, { session_id: string | null; status: string }>>(() => {
        const m: Record<string, { session_id: string | null; status: string }> = {}
        for (const o of initialOrders) m[o.id] = { session_id: o.session_id, status: o.status }
        return m
    })

    // Use actual browser origin so QR codes encode the live URL, not localhost
    const [baseUrl, setBaseUrl] = useState(appUrl)
    useEffect(() => { setBaseUrl(window.location.origin) }, [])

    const [mounted, setMounted] = useState(false)
    useEffect(() => { setMounted(true) }, [])

    const [openSessionRequests, setOpenSessionRequests] = useState<Record<string, string>>({})

    useEffect(() => {
        const fetchOpenSessionRequests = async () => {
            const supabase = createClient()
            const { data } = await supabase
                .from('service_requests')
                .select('id, table_id')
                .eq('request_type', 'open_session')
                .in('status', ['pending', 'acknowledged'])
            if (data) {
                const map: Record<string, string> = {}
                for (const r of data) {
                    if (r.table_id) map[r.table_id] = r.id
                }
                setOpenSessionRequests(map)
            }
        }
        fetchOpenSessionRequests()
    }, [])

    useRestaurantTable(restaurantId, 'service_requests', (payload) => {
        if (payload.eventType === 'INSERT') {
            const { id, request_type, status, table_id } = payload.new
            if (request_type === 'open_session' && ['pending', 'acknowledged'].includes(status) && table_id) {
                setOpenSessionRequests(prev => ({ ...prev, [table_id]: id }))
            }
        } else if (payload.eventType === 'UPDATE') {
            const { id, request_type, status, table_id } = payload.new
            if (request_type === 'open_session') {
                if (status === 'completed' || status === 'cancelled') {
                    setOpenSessionRequests(prev => {
                        const next = { ...prev }
                        for (const tid in next) {
                            if (next[tid] === id) {
                                delete next[tid]
                            }
                        }
                        return next
                    })
                } else if (table_id) {
                    setOpenSessionRequests(prev => ({ ...prev, [table_id]: id }))
                }
            }
        } else if (payload.eventType === 'DELETE') {
            const { id } = payload.old
            setOpenSessionRequests(prev => {
                const next = { ...prev }
                for (const tid in next) {
                    if (next[tid] === id) {
                        delete next[tid]
                    }
                }
                return next
            })
        }
    })

    const [filter, setFilter] = useState<'all' | 'available' | 'reserved' | 'occupied' | 'dirty'>('all')

    const counts = useMemo(() => {
        let all = tables.length
        let available = 0
        let reserved = 0
        let occupied = 0
        let dirty = 0
        for (const t of tables) {
            const status = getEffectiveStatus(t)
            if (status === 'active') occupied++
            else if (status === 'dirty') dirty++
            else if (status === 'reserved') reserved++
            else available++
        }
        return { all, available, reserved, occupied, dirty }
    }, [tables])

    const filteredTables = useMemo(() => {
        if (filter === 'all') return tables
        return tables.filter(t => {
            const status = getEffectiveStatus(t)
            if (filter === 'occupied') return status === 'active'
            return status === filter
        })
    }, [tables, filter])

    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if (payload.eventType === 'INSERT') {
            const { id, session_id, status } = payload.new
            setOrderStatuses(prev => ({ ...prev, [id]: { session_id, status } }))
        } else if (payload.eventType === 'UPDATE') {
            const { id, session_id, status } = payload.new
            if (status === 'delivered' || status === 'cancelled') {
                setOrderStatuses(prev => { const n = { ...prev }; delete n[id]; return n })
            } else {
                setOrderStatuses(prev => ({ ...prev, [id]: { session_id, status } }))
            }
        }
    })

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
        // Alert the floor when a table newly needs cleaning (e.g. payment closed it).
        setTables(prev => {
            const before = prev.find(t => t.id === u.id)
            if (u.table_status === 'dirty' && before && before.table_status !== 'dirty') {
                toast(`Table ${u.label ?? before.label} needs cleaning`, { icon: '🧹', duration: 6000 })
            }
            return prev.map(t => t.id === u.id ? { ...t, ...patch } : t)
        })
        setSelectedTable(prev => prev?.id === u.id ? { ...prev, ...patch } : prev)
    })

    const handleOpenSession = async (tableId: string) => {
        setIsProcessing(true)
        const pendingRequestId = openSessionRequests[tableId]
        let res: { error?: string; success?: boolean; session?: Record<string, unknown> }
        if (pendingRequestId) {
            res = await openSessionFromRequest(pendingRequestId, tableId, restaurantId)
        } else {
            res = await openSession(tableId, restaurantId)
        }
        if (res.error || !res.session) {
            toast.error(res.error || 'Failed to open session')
            setIsProcessing(false)
            return
        }
        if (pendingRequestId) {
            setOpenSessionRequests(prev => {
                const next = { ...prev }
                delete next[tableId]
                return next
            })
        }
        const session = res.session as unknown as Session
        await setTableStatus(tableId, 'available')
        setTables(prev => prev.map(t => t.id === tableId ? { ...t, activeSession: session } : t))
        setSelectedTable(prev => prev?.id === tableId ? { ...prev, activeSession: session } : prev)
        toast.success('Session opened')
        setIsProcessing(false)
    }

    const handleCloseSession = async (sessionId: string) => {
        const ok = await confirm({
            title: 'Close Session?',
            message: 'Customers will no longer be able to order and the table will be cleared.',
            confirmText: 'Close Session',
            isDestructive: true,
        })
        if (!ok) return
        setIsProcessing(true)
        await closeSession(sessionId)
        toast.success('Session closed')
        setIsProcessing(false)
        setSelectedTable(null)
    }

    const handleSetStatus = async (tableId: string, status: 'available' | 'dirty' | 'reserved') => {
        setIsProcessing(true)
        const res = await setTableStatus(tableId, status)
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(status === 'dirty' ? 'Marked dirty' : status === 'reserved' ? 'Reserved' : 'Cleared')
            setTables(prev => prev.map(t => t.id === tableId ? { ...t, table_status: status } : t))
            setSelectedTable(prev => prev?.id === tableId ? { ...prev, table_status: status } : prev)
        }
        setIsProcessing(false)
    }

    const patchTable = (tableId: string, patch: Partial<TableWithSession>) => {
        setTables(prev => prev.map(t => t.id === tableId ? { ...t, ...patch } : t))
        setSelectedTable(prev => prev?.id === tableId ? { ...prev, ...patch } : prev)
    }

    const handleClaimCleaning = async (tableId: string) => {
        setIsProcessing(true)
        patchTable(tableId, { cleaning_claimed_by: userId, cleaning_claimed_at: new Date().toISOString() })
        const res = await claimTableCleaning(tableId)
        if (res.error) {
            patchTable(tableId, { cleaning_claimed_by: null, cleaning_claimed_at: null })
            toast.error(res.conflict ? 'Another waiter already took this table' : res.error)
        } else {
            toast.success('On your way 🧹')
        }
        setIsProcessing(false)
    }

    const handleReleaseCleaning = async (tableId: string) => {
        patchTable(tableId, { cleaning_claimed_by: null, cleaning_claimed_at: null })
        await releaseTableCleaning(tableId)
    }

    const handleMarkClean = async (tableId: string) => {
        setIsProcessing(true)
        const res = await markTableClean(tableId)
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success('Table cleaned ✓')
            patchTable(tableId, { table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        }
        setIsProcessing(false)
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Sticky Sub-tabs / Filters */}
            <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2.5 w-full">
                    {(['all', 'available', 'reserved', 'dirty', 'occupied'] as const).map((key) => {
                        const isActive = filter === key
                        const label = key === 'all' ? 'ALL' : key.charAt(0).toUpperCase() + key.slice(1)
                        const count = counts[key]
                        
                        // Color scheme for active states
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
                                onClick={() => setFilter(key)}
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

            {/* Table Grid (Full Width) */}
            <div className="overflow-hidden rounded-[24px] border border-hairline bg-surface shadow-[0_8px_30px_rgb(0,0,0,0.03)] w-full">


                <div className="p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                    {filteredTables.length === 0 ? (
                        <div className="col-span-full py-12">
                            <EmptyState
                                title="No tables found"
                                description={`There are no tables currently marked as ${filter}.`}
                                icon={UtensilsCrossed}
                            />
                        </div>
                    ) : (
                        filteredTables.map(table => {
                            const status = getEffectiveStatus(table)
                            const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available
                            const isSelected = selectedTable?.id === table.id

                            // Traffic light: order pipeline status for this table's session
                            const sessionId = table.activeSession?.id ?? null
                            const sessionOrders = sessionId
                                ? Object.values(orderStatuses).filter(o => o.session_id === sessionId && !['delivered', 'cancelled'].includes(o.status))
                                : []
                            const orderLight = sessionOrders.some(o => o.status === 'ready')
                                ? 'ready'
                                : sessionOrders.some(o => o.status === 'preparing' || o.status === 'confirmed')
                                    ? 'preparing'
                                    : sessionOrders.length > 0 ? 'pending' : null

                            const trafficLight = {
                                ready:    { dot: 'bg-success animate-pulse', label: '● Ready',   cls: 'text-success-fg' },
                                preparing:{ dot: 'bg-info animate-pulse',    label: '● Cooking', cls: 'text-info-fg' },
                                pending:  { dot: 'bg-warning',               label: '● Waiting', cls: 'text-warning-fg' },
                            }
                            const tl = orderLight ? trafficLight[orderLight] : null
                            const hasOpenRequest = !table.activeSession && !!openSessionRequests[table.id]

                            return (
                                <button
                                    key={table.id}
                                    onClick={() => setSelectedTable(isSelected ? null : table)}
                                    className={`relative aspect-square rounded-[20px] border flex flex-col items-center justify-center transition-all duration-300 ${
                                        hasOpenRequest ? 'border-violet-300 bg-violet-50/10 shadow-[0_0_12px_rgba(139,92,246,0.15)] animate-pulse' : cfg.card
                                    } ${
                                        isSelected ? 'ring-2 ring-offset-2 ring-brand-500 scale-[1.02] z-10 shadow-[0_8px_20px_rgb(251,99,3,0.15)] bg-surface' : 'hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95'
                                    }`}
                                >
                                    <span className={`${getFontSizeClass(table.label || '')} font-extrabold tracking-tight text-ink leading-tight text-center break-words max-w-full px-1.5`}>
                                        {table.label}
                                    </span>
                                    {table.capacity && (
                                        <span className="flex items-center gap-0.5 text-caption text-ink-subtle mt-0.5">
                                            <Users size={9} />{table.capacity}
                                        </span>
                                    )}
                                    {tl ? (
                                        <span className={`text-[9px] font-bold mt-0.5 ${tl.cls}`}>{tl.label}</span>
                                    ) : hasOpenRequest ? (
                                        <span className="text-[9px] font-black text-violet-600 mt-0.5 animate-pulse uppercase tracking-wide">🛎️ Open Session</span>
                                    ) : cfg.label ? (
                                        <span className={`text-[9px] font-bold uppercase tracking-wide mt-0.5 ${cfg.labelCls}`}>{cfg.label}</span>
                                    ) : null}
                                    {/* Session status dot (top-right) */}
                                    {hasOpenRequest ? (
                                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                                        </span>
                                    ) : (
                                        <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                                    )}
                                    {/* Order traffic light dot (top-left) */}
                                    {tl && <span className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full ${tl.dot}`} />}
                                </button>
                            )
                        })
                    )}
                </div>
            </div>

            {/* Modal Overlay for Table Management */}
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
                                <h3 className="text-h3 font-black text-ink">Table {selectedTable.label}</h3>
                                <p className="text-caption text-ink-subtle mt-0.5">
                                    {selectedTable.activeSession
                                        ? 'Occupied'
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
                        <div className="p-6">
                            {selectedTable.activeSession ? (
                                <div className="space-y-4">
                                    <div className="flex justify-center p-4 bg-surface-muted rounded-[var(--r-md)] border border-hairline">
                                        <QRCodeSVG
                                            value={`${baseUrl}/t/${selectedTable.qr_token}?s=${selectedTable.activeSession.session_token}`}
                                            size={180}
                                            level="Q"
                                            marginSize={4}
                                        />
                                    </div>
                                    <p className="text-caption text-center text-ink-subtle">Scan to order · Session valid for 4 hours</p>
                                    <div className="flex flex-col gap-3">
                                        <Button
                                            variant="primary"
                                            block
                                            icon={ShoppingCart}
                                            onClick={() => {
                                                if (isHotel) {
                                                    setShowGuestPicker(true)
                                                    setGuestPickerStep('choose')
                                                    setPhoneInput('')
                                                    setPhoneResult(null)
                                                    setActiveBookingsList([])
                                                } else {
                                                    router.push(`/t/${selectedTable.qr_token}?s=${selectedTable.activeSession!.session_token}&w=1`)
                                                    setSelectedTable(null)
                                                }
                                            }}
                                        >
                                            Order for Table
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            block
                                            icon={PowerOff}
                                            loading={isProcessing}
                                            onClick={async () => {
                                                await handleCloseSession(selectedTable.activeSession!.id)
                                                setSelectedTable(null)
                                            }}
                                            className="text-danger-fg border-danger/30 hover:bg-danger-bg"
                                        >
                                            Close Session &amp; Checkout
                                        </Button>
                                    </div>
                                </div>
                            ) : selectedTable.table_status === 'dirty' ? (
                                (() => {
                                    const claimedBy = selectedTable.cleaning_claimed_by
                                    const mine = claimedBy === userId
                                    const byOther = !!claimedBy && !mine
                                    return (
                                        <div className="space-y-4">
                                            <div className="flex flex-col items-center py-4 text-warning-fg">
                                                <Sparkles size={48} strokeWidth={1.5} />
                                                <p className="text-center text-body font-semibold text-ink mt-3">Needs cleaning</p>
                                                {byOther && (
                                                    <p className="text-center text-caption text-ink-subtle mt-1 flex items-center gap-1.5">
                                                        <Footprints size={13} /> {staffNames[claimedBy!] || 'A colleague'} is on it
                                                    </p>
                                                )}
                                            </div>

                                            {!claimedBy && (
                                                <Button block variant="primary" icon={Footprints} loading={isProcessing} onClick={async () => {
                                                    await handleClaimCleaning(selectedTable.id)
                                                    setSelectedTable(null)
                                                }}>
                                                    I&apos;m Going to Clean
                                                </Button>
                                            )}

                                            {mine && (
                                                <div className="grid grid-cols-2 gap-3">
                                                    <Button block variant="secondary" icon={X} loading={isProcessing} onClick={async () => {
                                                        await handleReleaseCleaning(selectedTable.id)
                                                        setSelectedTable(null)
                                                    }}>
                                                        Cancel
                                                    </Button>
                                                    <Button block variant="primary" icon={Check} loading={isProcessing} onClick={async () => {
                                                        await handleMarkClean(selectedTable.id)
                                                        setSelectedTable(null)
                                                    }}>
                                                        Mark Cleaned
                                                    </Button>
                                                </div>
                                            )}

                                            {byOther && (
                                                <Button block variant="secondary" icon={X} loading={isProcessing} onClick={async () => {
                                                    await handleReleaseCleaning(selectedTable.id)
                                                    setSelectedTable(null)
                                                }}>
                                                    Force Release Cleaning
                                                </Button>
                                            )}
                                        </div>
                                    )
                                })()
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex flex-col items-center py-4 text-[var(--color-primary)]">
                                        <UtensilsCrossed size={48} strokeWidth={1.5} />
                                        <p className="text-center text-body font-semibold text-ink mt-3">Open a new guest session for this table</p>
                                    </div>
                                    
                                    <Button block variant="primary" icon={Power} loading={isProcessing} onClick={async () => {
                                        await handleOpenSession(selectedTable.id)
                                        setSelectedTable(null)
                                    }}>
                                        Open Session
                                    </Button>

                                    <div className="pt-3 border-t border-hairline">
                                        <p className="text-label text-ink-subtle mb-2">Table Status</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {selectedTable.table_status === 'reserved' ? (
                                                <Button block variant="secondary" icon={X} loading={isProcessing} onClick={async () => {
                                                    await handleSetStatus(selectedTable.id, 'available')
                                                    setSelectedTable(null)
                                                }} className="col-span-2">
                                                    Release Reservation
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button block variant="secondary" icon={Sparkles} loading={isProcessing} onClick={async () => {
                                                        await handleSetStatus(selectedTable.id, 'dirty')
                                                        setSelectedTable(null)
                                                    }}>
                                                        Mark Dirty
                                                    </Button>
                                                    <Button block variant="secondary" icon={CalendarClock} loading={isProcessing} onClick={async () => {
                                                        await handleSetStatus(selectedTable.id, 'reserved')
                                                        setSelectedTable(null)
                                                    }}>
                                                        Mark Reserved
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Hotel Guest Picker Modal */}
            {mounted && showGuestPicker && selectedTable?.activeSession && createPortal(
                <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setShowGuestPicker(false)}
                >
                    <div
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink">
                                    {guestPickerStep === 'choose' ? 'Guest Type' : guestPickerStep === 'phone' ? 'Find Guest' : 'Select Room'}
                                </h3>
                                <p className="text-caption text-ink-subtle mt-0.5">Table {selectedTable.label}</p>
                            </div>
                            <button
                                onClick={() => setShowGuestPicker(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6">
                            {guestPickerStep === 'choose' && (
                                <div className="space-y-3">
                                    <p className="text-body text-ink-subtle text-center mb-4">Who is ordering?</p>
                                    <Button
                                        block
                                        variant="primary"
                                        icon={Hotel}
                                        onClick={() => {
                                            setGuestPickerStep('phone')
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
                                        onClick={() => {
                                            router.push(`/t/${selectedTable.qr_token}?s=${selectedTable.activeSession!.session_token}&w=1`)
                                            setSelectedTable(null)
                                            setShowGuestPicker(false)
                                        }}
                                    >
                                        Outside Guest (Direct Order)
                                    </Button>
                                </div>
                            )}

                            {guestPickerStep === 'phone' && (
                                <div className="space-y-4">
                                    <p className="text-body text-ink-subtle text-center">Enter phone number to check if guest has a room booking</p>
                                    <div className="relative">
                                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                                        <input
                                            type="tel"
                                            value={phoneInput}
                                            onChange={e => setPhoneInput(e.target.value)}
                                            placeholder="e.g. 9841234567"
                                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-hairline bg-surface-muted text-ink text-body focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                                            autoFocus
                                        />
                                    </div>
                                    <Button
                                        block
                                        variant="primary"
                                        icon={phoneSearching ? Loader2 : Search}
                                        loading={phoneSearching}
                                        disabled={phoneInput.trim().length < 4}
                                        onClick={async () => {
                                            setPhoneSearching(true)
                                            setPhoneResult(null)
                                            const res = await findBookingByPhone(phoneInput, restaurantId)
                                            if (res.success) {
                                                setPhoneResult(res.booking)
                                            } else {
                                                toast.error(res.error || 'Search failed')
                                            }
                                            setPhoneSearching(false)
                                        }}
                                    >
                                        Search Booking
                                    </Button>

                                    {phoneResult === null && !phoneSearching && phoneInput.trim().length >= 4 && (
                                        <p className="text-caption text-ink-subtle text-center">Press Search to find guest</p>
                                    )}

                                    {phoneResult === undefined && (
                                        <div className="bg-warning/10 border border-warning/20 rounded-xl p-4 text-center">
                                            <p className="text-body font-semibold text-warning-fg">No booking found</p>
                                            <p className="text-caption text-ink-subtle mt-1">Please make sure the phone number matches the one provided during room check-in.</p>
                                        </div>
                                    )}

                                    {phoneResult && (
                                        <div className="bg-success/10 border border-success/20 rounded-xl p-4">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                                                    <UserCheck size={20} className="text-success-fg" />
                                                </div>
                                                <div>
                                                    <p className="text-body font-bold text-ink">{phoneResult.guest_name}</p>
                                                    <p className="text-caption text-ink-subtle">
                                                        Room {(phoneResult as any).rooms?.room_number || '?'} · {phoneResult.guest_phone}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                block
                                                variant="primary"
                                                icon={ShoppingCart}
                                                loading={isProcessing}
                                                onClick={async () => {
                                                    setIsProcessing(true)
                                                    const linkRes = await linkSessionToBooking(selectedTable.activeSession!.id, phoneResult.id)
                                                    if (linkRes.error) {
                                                        toast.error(linkRes.error)
                                                    } else {
                                                        toast.success(`Linked to Room ${(phoneResult as any).rooms?.room_number}`)
                                                    }
                                                    setIsProcessing(false)
                                                    router.push(`/t/${selectedTable.qr_token}?s=${selectedTable.activeSession!.session_token}&w=1`)
                                                    setSelectedTable(null)
                                                    setShowGuestPicker(false)
                                                }}
                                            >
                                                Link to Room &amp; Order
                                            </Button>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-2 mt-4 pt-2 border-t border-hairline">
                                        <button
                                            onClick={() => setGuestPickerStep('choose')}
                                            className="w-full text-center text-caption text-ink-subtle hover:text-ink"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setGuestPickerStep('rooms')
                                                setLoadingBookings(true)
                                                const res = await getActiveBookings(restaurantId)
                                                if (res.success && res.bookings) {
                                                    setActiveBookingsList(res.bookings)
                                                } else {
                                                    toast.error(res.error || 'Failed to load bookings')
                                                }
                                                setLoadingBookings(false)
                                            }}
                                            className="w-full text-center text-[11px] text-brand-500 hover:underline font-semibold mt-1"
                                        >
                                            Or browse checked-in guests list
                                        </button>
                                    </div>
                                </div>
                            )}

                            {guestPickerStep === 'rooms' && (
                                <div className="space-y-3">
                                    {loadingBookings ? (
                                        <div className="flex flex-col items-center py-8 gap-3">
                                            <Loader2 size={32} className="animate-spin text-brand-500" />
                                            <p className="text-caption text-ink-subtle">Loading checked-in guests…</p>
                                        </div>
                                    ) : activeBookingsList.length === 0 ? (
                                        <div className="text-center py-8">
                                            <Bed size={40} className="mx-auto text-ink-subtle mb-3" />
                                            <p className="text-body font-semibold text-ink">No checked-in guests</p>
                                            <p className="text-caption text-ink-subtle mt-1">There are no active room bookings right now</p>
                                        </div>
                                    ) : (
                                        <div className="max-h-[50vh] overflow-y-auto space-y-2 -mx-2 px-2">
                                            {activeBookingsList.map((booking: any) => (
                                                <button
                                                    key={booking.id}
                                                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-hairline bg-surface hover:bg-surface-muted transition-all active:scale-[0.98]"
                                                    onClick={async () => {
                                                        setIsProcessing(true)
                                                        const linkRes = await linkSessionToBooking(selectedTable.activeSession!.id, booking.id)
                                                        if (linkRes.error) {
                                                            toast.error(linkRes.error)
                                                        } else {
                                                            toast.success(`Linked to Room ${booking.rooms?.room_number || '?'}`)
                                                        }
                                                        setIsProcessing(false)
                                                        router.push(`/t/${selectedTable.qr_token}?s=${selectedTable.activeSession!.session_token}&w=1`)
                                                        setSelectedTable(null)
                                                        setShowGuestPicker(false)
                                                    }}
                                                >
                                                    <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
                                                        <Bed size={18} className="text-brand-500" />
                                                    </div>
                                                    <div className="flex-1 text-left min-w-0">
                                                        <p className="text-body font-bold text-ink truncate">{booking.guest_name}</p>
                                                        <p className="text-caption text-ink-subtle">
                                                            Room {booking.rooms?.room_number || '?'} · {booking.guest_phone}
                                                        </p>
                                                    </div>
                                                    <ShoppingCart size={16} className="text-ink-subtle shrink-0" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => setGuestPickerStep('choose')}
                                        className="w-full text-center text-caption text-ink-subtle hover:text-ink mt-2"
                                    >
                                        ← Back
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
