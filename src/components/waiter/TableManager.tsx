'use client'

import { useState, useEffect } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { openSession, closeSession, setTableStatus, claimTableCleaning, releaseTableCleaning, markTableClean } from '@/app/(staff)/waiter/actions'
import { Users, QrCode, PowerOff, Power, Sparkles, CalendarClock, UtensilsCrossed, Footprints, Check, X } from 'lucide-react'
import type { Table, Session } from '@/types/database'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import { Card, Button, EmptyState } from '@/components/ui'

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

export default function TableManager({ initialTables, restaurantId, appUrl, initialOrders = [], userId, staffNames = {} }: {
    initialTables: TableWithSession[]
    restaurantId: string
    appUrl: string
    initialOrders?: { id: string; session_id: string | null; status: string }[]
    userId: string
    staffNames?: Record<string, string>
}) {
    const [tables, setTables] = useState<TableWithSession[]>(initialTables)
    const [selectedTable, setSelectedTable] = useState<TableWithSession | null>(null)
    const [isProcessing, setIsProcessing] = useState(false)
    const { confirm } = useConfirmStore()

    // Track order statuses per order ID → { session_id, status }
    const [orderStatuses, setOrderStatuses] = useState<Record<string, { session_id: string | null; status: string }>>(() => {
        const m: Record<string, { session_id: string | null; status: string }> = {}
        for (const o of initialOrders) m[o.id] = { session_id: o.session_id, status: o.status }
        return m
    })

    // Use actual browser origin so QR codes encode the live URL, not localhost
    const [baseUrl, setBaseUrl] = useState(appUrl)
    useEffect(() => { setBaseUrl(window.location.origin) }, [])

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
        const res = await openSession(tableId, restaurantId)
        if (res.error || !res.session) {
            toast.error(res.error || 'Failed to open session')
            setIsProcessing(false)
            return
        }
        // Optimistically flip the table to active so the card updates instantly,
        // even if the Realtime INSERT event is delayed or never arrives.
        const session = res.session as Session
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Table Grid */}
            <div className="lg:col-span-2 overflow-hidden rounded-[24px] border border-hairline bg-surface shadow-[0_8px_30px_rgb(0,0,0,0.03)]">
                <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <UtensilsCrossed size={15} className="text-ink-subtle" />
                        <h2 className="text-h3 text-ink">Floor Plan</h2>
                    </div>
                    <div className="flex items-center gap-3 text-caption text-ink-subtle">
                        {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'available').map(([key, cfg]) => (
                            <span key={key} className="flex items-center gap-1">
                                <span className={`w-2 h-2 rounded-full ${cfg.dot.replace(' animate-pulse', '')}`} />
                                {cfg.label}
                            </span>
                        ))}
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-ink-subtle" />Available
                        </span>
                    </div>
                </div>

                <div className="p-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {tables.map(table => {
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

                        return (
                            <button
                                key={table.id}
                                onClick={() => setSelectedTable(isSelected ? null : table)}
                                className={`relative aspect-square rounded-[20px] border flex flex-col items-center justify-center transition-all duration-300 ${cfg.card} ${
                                    isSelected ? 'ring-2 ring-offset-2 ring-brand-500 scale-[1.02] z-10 shadow-[0_8px_20px_rgb(251,99,3,0.15)] bg-white' : 'hover:-translate-y-1 hover:shadow-md hover:bg-white active:scale-95'
                                }`}
                            >
                                <span className="text-[28px] font-black tracking-tight text-ink">{table.label}</span>
                                {table.capacity && (
                                    <span className="flex items-center gap-0.5 text-caption text-ink-subtle mt-0.5">
                                        <Users size={9} />{table.capacity}
                                    </span>
                                )}
                                {tl ? (
                                    <span className={`text-[9px] font-bold mt-0.5 ${tl.cls}`}>{tl.label}</span>
                                ) : cfg.label ? (
                                    <span className={`text-[9px] font-bold uppercase tracking-wide mt-0.5 ${cfg.labelCls}`}>{cfg.label}</span>
                                ) : null}
                                {/* Session status dot (top-right) */}
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                                {/* Order traffic light dot (top-left) */}
                                {tl && <span className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full ${tl.dot}`} />}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Action Panel */}
            <div className="overflow-hidden sticky top-20 h-fit rounded-[24px] border border-hairline bg-surface shadow-[0_8px_30px_rgb(0,0,0,0.06)]">
                {selectedTable ? (
                    <div>
                        <div className="px-5 py-4 border-b border-hairline">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-h3 text-ink">Table {selectedTable.label}</h3>
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
                                <div className={`w-3 h-3 rounded-full ${(STATUS_CONFIG[getEffectiveStatus(selectedTable) as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available).dot}`} />
                            </div>
                        </div>

                        <div className="p-5">
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
                                    <Button
                                        variant="secondary"
                                        block
                                        icon={PowerOff}
                                        loading={isProcessing}
                                        onClick={() => handleCloseSession(selectedTable.activeSession!.id)}
                                        className="text-danger-fg border-danger/30 hover:bg-danger-bg"
                                    >
                                        Close Session &amp; Checkout
                                    </Button>
                                </div>
                            ) : selectedTable.table_status === 'dirty' ? (
                                // Dirty table — cleaning ownership flow. "I am going" claims it;
                                // only the claiming waiter may then Mark Clean.
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
                                                <Button block variant="primary" icon={Footprints} loading={isProcessing} onClick={() => handleClaimCleaning(selectedTable.id)}>
                                                    I'm Going to Clean
                                                </Button>
                                            )}

                                            {mine && (
                                                <div className="space-y-2">
                                                    <Button block icon={Check} loading={isProcessing} onClick={() => handleMarkClean(selectedTable.id)}>
                                                        Mark Clean
                                                    </Button>
                                                    <button
                                                        onClick={() => handleReleaseCleaning(selectedTable.id)}
                                                        className="text-caption text-ink-muted hover:text-ink flex items-center gap-1 mx-auto"
                                                    >
                                                        <X size={12} /> Release
                                                    </button>
                                                </div>
                                            )}

                                            {byOther && (
                                                <p className="text-center text-caption text-ink-muted">Only {staffNames[claimedBy!] || 'the assigned waiter'} can mark this clean.</p>
                                            )}
                                        </div>
                                    )
                                })()
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex flex-col items-center py-4 text-ink-subtle/40">
                                        <QrCode size={64} strokeWidth={1} />
                                        <p className="text-center text-caption text-ink-subtle mt-3">Seat customers and open a session to generate an ordering QR code.</p>
                                    </div>
                                    <Button
                                        block
                                        icon={Power}
                                        loading={isProcessing}
                                        onClick={() => handleOpenSession(selectedTable.id)}
                                    >
                                        Open Session
                                    </Button>

                                    <div className="pt-3 border-t border-hairline">
                                        <p className="text-label text-ink-subtle mb-2">Table Status</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { status: 'available' as const, icon: <span className="w-2.5 h-2.5 rounded-full bg-ink-subtle block" />, label: 'Clear',   cls: 'border-hairline text-ink-muted hover:bg-surface-muted' },
                                                { status: 'dirty' as const,     icon: <Sparkles size={12} />,      label: 'Dirty',   cls: 'border-warning/25 text-warning-fg hover:bg-warning-bg' },
                                                { status: 'reserved' as const,  icon: <CalendarClock size={12} />, label: 'Reserve', cls: 'border-info/25 text-info-fg hover:bg-info-bg' },
                                            ].map(({ status, icon, label, cls }) => (
                                                <button
                                                    key={status}
                                                    onClick={() => handleSetStatus(selectedTable.id, status)}
                                                    disabled={isProcessing || (!selectedTable.table_status || selectedTable.table_status === status) && status === 'available'}
                                                    className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-[var(--r-md)] border text-caption font-semibold disabled:opacity-40 transition-colors ${cls}`}
                                                >
                                                    {icon}{label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <EmptyState
                        icon={UtensilsCrossed}
                        title="Select a table"
                        description="Tap any table to manage it"
                        className="h-64"
                    />
                )}
            </div>
        </div>
    )
}
