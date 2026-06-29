
'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid, markOrderItemsServed, claimOrder, releaseOrder } from '@/app/(staff)/waiter/order-actions'
import { playOrderReady, playNewOrder } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Package, ChefHat, Banknote, Clock, Footprints, X, CheckSquare, Square, Check, Utensils } from 'lucide-react'
import { Card, Button, Badge, StatusBadge, TableChip, FeedSection, EmptyState } from '@/components/ui'
import type { Order, OrderItem, MenuItem, Session, Table, OrderStatus, OrderItemStatus } from '@/types/database'

export type WaiterOrderItem = OrderItem & { menu_items?: Partial<MenuItem> }

export type WaiterOrder = Order & {
    sessions?: Session & { tables?: Partial<Table> }
    order_items?: WaiterOrderItem[]
}

const ORDER_SELECT = `
  id, status, total_amount, placed_at, ready_at, customer_note, payment_status, session_id,
  claimed_by, claimed_at,
  sessions ( id, tables ( label ) ),
  order_items ( id, quantity, status, menu_items ( name ) )
` as const

function tableLabel(order: WaiterOrder) {
    return order.sessions?.tables?.label || '?'
}

function readyCount(order: WaiterOrder) {
    return (order.order_items || []).filter(i => i.status === 'ready').length
}

const STATUS_ORDER: Record<string, number> = { ready: 3, preparing: 2, confirmed: 1, pending: 1 }
const STALE_MS = 15 * 60 * 1000

export default function WaiterOrderFeed({ initialOrders, restaurantId, userId, staffNames = {} }: {
    initialOrders: WaiterOrder[]
    restaurantId: string
    userId: string
    staffNames?: Record<string, string>
}) {
    const [orders, setOrders] = useState<WaiterOrder[]>(initialOrders)
    const money = useCurrency()
    const ordersRef = useRef(orders)
    const [servingId, setServingId] = useState<string | null>(null)
    const [claimingId, setClaimingId] = useState<string | null>(null)
    const [cashProcessingId, setCashProcessingId] = useState<string | null>(null)
    const [now, setNow] = useState(() => Date.now())
    const supabaseRef = useRef(createClient())

    useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i) }, [])
    useEffect(() => { ordersRef.current = orders }, [orders])

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        const supabase = supabaseRef.current
        if (payload.eventType === 'INSERT') {
            const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (data) {
                const order = data as unknown as WaiterOrder
                // Skip replayed/duplicate INSERTs (reconnect, multiple tabs, or a
                // row already present in initialOrders).
                if (ordersRef.current.some(o => o.id === order.id)) return
                setOrders(prev => prev.some(o => o.id === order.id) ? prev : [order, ...prev])
                playNewOrder().catch(() => {})
                playVoice('waiter_new_order')
                navigator.vibrate?.(300)
                const tbl = order.sessions?.tables?.label
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-xl px-4 py-3 flex items-start gap-3 border border-amber-200`}>
                        <span className="text-xl mt-0.5">🛎️</span>
                        <div>
                            <p className="font-bold text-sm text-amber-700">New Order</p>
                            <p className="text-xs text-ink-subtle mt-0.5">{tbl ? `Table ${tbl}` : 'Takeout'} · {money(order.total_amount)}</p>
                        </div>
                    </div>
                ), { duration: 5000, position: 'top-right' })
            }
            return
        }

        if (payload.eventType === 'UPDATE') {
            const newStatus = payload.new.status as OrderStatus
            if (newStatus === 'delivered' || newStatus === 'cancelled') {
                setOrders(prev => prev.filter(o => o.id !== payload.new.id))
                return
            }

            // Refetch the full row — item statuses change without the order leaving
            // its bucket (e.g. 1 of 3 items just turned ready). Comparing the ready
            // count before/after tells us whether to alert the floor.
            const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const fresh = data as unknown as WaiterOrder
            const prev = ordersRef.current.find(o => o.id === fresh.id)
            const prevReady = prev ? readyCount(prev) : 0
            const newReady = readyCount(fresh)

            // Name the specific dishes that just crossed into 'ready' so the waiter
            // knows exactly what to pick up — not just a count.
            const prevReadyIds = new Set((prev?.order_items || []).filter(i => i.status === 'ready').map(i => i.id))
            const justReady = (fresh.order_items || []).filter(i => i.status === 'ready' && !prevReadyIds.has(i.id))
            const dishLine = justReady
                .map(i => `${i.quantity}× ${i.menu_items?.name ?? 'Item'}`)
                .join(', ')

            setOrders(cur => cur.some(o => o.id === fresh.id)
                ? cur.map(o => o.id === fresh.id ? fresh : o)
                : [fresh, ...cur])

            if (newReady > prevReady) {
                playOrderReady().catch(() => {})
                playVoice('waiter_order_ready')
                navigator.vibrate?.([200, 100, 200])
                const tbl = fresh.sessions?.tables?.label
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-xl px-4 py-3 flex items-start gap-3 border-2 border-emerald-300`}>
                        <span className="text-xl mt-0.5">✅</span>
                        <div>
                            <p className="font-bold text-sm text-emerald-700">Ready to Serve!</p>
                            <p className="text-xs text-ink-subtle mt-0.5">{tbl ? `Table ${tbl}` : 'Takeout'} · {dishLine || `${newReady} item${newReady > 1 ? 's' : ''} up`}</p>
                        </div>
                    </div>
                ), { duration: 8000, position: 'top-right' })
            }
        }
    })

    const handleClaim = async (orderId: string) => {
        setClaimingId(orderId)
        // Optimistically show it as mine; realtime + server reconcile the truth.
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, claimed_by: userId, claimed_at: new Date().toISOString() } : o))
        const res = await claimOrder(orderId)
        if (res?.error) {
            const winner = res.claimedById ?? null
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, claimed_by: winner } : o))
            const name = winner ? staffNames[winner] : undefined
            toast.error(name ? `${name} already claimed this order` : 'This order was already claimed')
        }
        setClaimingId(null)
    }

    const handleRelease = async (orderId: string) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, claimed_by: null, claimed_at: null } : o))
        const res = await releaseOrder(orderId)
        if (res?.error) toast.error('Could not release order')
    }

    const handleServeItems = async (orderId: string, itemIds: string[]) => {
        if (itemIds.length === 0) return
        setServingId(orderId)
        const snapshot = ordersRef.current
        // Optimistically mark the items served and re-bucket the order.
        setOrders(prev => prev
            .map(o => {
                if (o.id !== orderId) return o
                const items = (o.order_items || []).map(it =>
                    itemIds.includes(it.id) ? { ...it, status: 'served' as OrderItemStatus } : it)
                return { ...o, order_items: items }
            })
            // If everything is served the order is delivered — drop it from the feed.
            .filter(o => o.id !== orderId || (o.order_items || []).some(it => it.status !== 'served' && it.status !== 'cancelled'))
        )
        const res = await markOrderItemsServed(orderId, itemIds)
        if (res?.error) {
            setOrders(snapshot)
            toast.error(res.conflict ? 'Those items were just served by someone else' : 'Could not mark items served')
        } else if (res.delivered) {
            toast.success('Order fully served ✅')
        } else {
            toast.success('Items served ✓')
        }
        setServingId(null)
    }

    const handleCashAndDeliver = async (orderId: string) => {
        setCashProcessingId(orderId)
        setOrders(prev => prev.filter(o => o.id !== orderId))
        const res = await markDeliveredAndCashPaid(orderId)
        if (res.error) toast.error(res.error)
        else toast.success(res.tableClosed ? 'Cash received — table closed ✅' : 'Cash received ✓')
        setCashProcessingId(null)
    }

    // Sort: most ready items first, then by status weight, then newest.
    const sortedOrders = useMemo(() => {
        return [...orders].sort((a, b) => {
            const readyA = readyCount(a), readyB = readyCount(b)
            if (readyA !== readyB) return readyB - readyA
            const scoreA = STATUS_ORDER[a.status] ?? 0
            const scoreB = STATUS_ORDER[b.status] ?? 0
            if (scoreA !== scoreB) return scoreB - scoreA
            return new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime()
        })
    }, [orders])

    if (orders.length === 0) {
        return (
            <FeedSection icon={Package} title="Live Orders">
                <Card padding={24}>
                    <EmptyState icon={ChefHat} title="No active orders" description="Incoming orders will appear here in real time." />
                </Card>
            </FeedSection>
        )
    }

    const totalReadyItems = orders.reduce((sum, o) => sum + readyCount(o), 0)

    return (
        <FeedSection
            icon={Package}
            title="Live Orders"
            count={orders.length}
            tone="neutral"
            action={totalReadyItems > 0 ? <Badge tone="success" dot>{totalReadyItems} item{totalReadyItems > 1 ? 's' : ''} ready</Badge> : undefined}
        >
            <div className="grid gap-3">
                {sortedOrders.map((order) => (
                    <WaiterOrderCard
                        key={order.id}
                        order={order}
                        userId={userId}
                        staffNames={staffNames}
                        money={money}
                        now={now}
                        claiming={claimingId === order.id}
                        serving={servingId === order.id}
                        cashProcessing={cashProcessingId === order.id}
                        busy={!!servingId || !!cashProcessingId}
                        onClaim={handleClaim}
                        onRelease={handleRelease}
                        onServeItems={handleServeItems}
                        onCashAndDeliver={handleCashAndDeliver}
                    />
                ))}
            </div>
        </FeedSection>
    )
}

function itemServeMeta(status: OrderItemStatus) {
    switch (status) {
        case 'ready':     return { label: 'Ready', color: 'var(--success)' }
        case 'served':    return { label: 'Served', color: 'var(--ink-muted)' }
        case 'preparing': return { label: 'Cooking', color: 'var(--info)' }
        case 'cancelled': return { label: 'Cancelled', color: 'var(--danger)' }
        default:          return { label: 'Queued', color: 'var(--ink-muted)' }
    }
}

function WaiterOrderCard({
    order, userId, staffNames, money, now,
    claiming, serving, cashProcessing, busy,
    onClaim, onRelease, onServeItems, onCashAndDeliver,
}: {
    order: WaiterOrder
    userId: string
    staffNames: Record<string, string>
    money: (n: number) => string
    now: number
    claiming: boolean
    serving: boolean
    cashProcessing: boolean
    busy: boolean
    onClaim: (orderId: string) => void
    onRelease: (orderId: string) => void
    onServeItems: (orderId: string, itemIds: string[]) => void
    onCashAndDeliver: (orderId: string) => void
}) {
    const label = tableLabel(order)
    const items = useMemo(() => order.order_items || [], [order.order_items])
    const readyItems = useMemo(() => items.filter(i => i.status === 'ready'), [items])
    const hasReady = readyItems.length > 0
    const allReady = order.status === 'ready' // every item ready (rolled up)

    const claimedBy = order.claimed_by
    const mineClaim = claimedBy === userId
    const claimedByOther = !!claimedBy && !mineClaim
    const claimerName = claimedBy ? staffNames[claimedBy] : undefined

    const ts = order.ready_at || order.placed_at
    const isStale = now - new Date(ts).getTime() > STALE_MS

    // Selection over the ready items, defaulting to all (Select All convenience).
    const [selected, setSelected] = useState<Set<string>>(() => new Set(readyItems.map(i => i.id)))
    const readyKey = readyItems.map(i => i.id).join(',')
    const prevReadyIdsRef = useRef<string[]>(readyItems.map(i => i.id))
    useEffect(() => {
        const currentIds = readyItems.map(i => i.id)
        const prevIds = prevReadyIdsRef.current
        setSelected(prev => {
            const next = new Set<string>()
            for (const id of currentIds) {
                const isNew = !prevIds.includes(id)
                if (isNew || prev.has(id)) next.add(id)
            }
            return next
        })
        prevReadyIdsRef.current = currentIds
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readyKey])

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    const allSelected = readyItems.length > 0 && readyItems.every(i => selected.has(i.id))
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(readyItems.map(i => i.id)))
    const selectedReady = readyItems.filter(i => selected.has(i.id)).map(i => i.id)

    return (
        <Card padding={false} className={`${hasReady ? 'border-success/30' : ''} ${claimedByOther ? 'opacity-60' : ''}`.trim() || undefined}>
            <div className="p-4 md:p-5">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <TableChip label={label} size="lg" />
                            <StatusBadge status={order.status} />
                            {hasReady && !allReady && <Badge tone="success" dot>{readyItems.length} ready</Badge>}
                            {isStale && hasReady && <Badge tone="danger" className="animate-pulse">Cold warning!</Badge>}
                        </div>
                        <div className="text-small text-ink-subtle flex items-center gap-2">
                            <Clock size={12} /> {timeAgo(order.placed_at)}
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="text-display block text-ink">{money(order.total_amount)}</span>
                        <span className="text-caption text-ink-muted">{order.payment_status}</span>
                    </div>
                </div>

                {/* Items — ready ones are selectable once the order is claimed by me */}
                <div className="bg-surface-muted rounded-[var(--r-md)] p-3 mb-4">
                    {mineClaim && readyItems.length > 1 && (
                        <button
                            onClick={toggleAll}
                            className="w-full flex items-center gap-2 text-xs font-bold text-ink-subtle pb-2 mb-2 border-b border-ink/10"
                        >
                            {allSelected ? <CheckSquare size={15} className="text-success" /> : <Square size={15} />}
                            {allSelected ? 'All ready items selected' : 'Select all ready'}
                            <span className="ml-auto font-mono">{selectedReady.length}/{readyItems.length}</span>
                        </button>
                    )}
                    <ul className="space-y-1.5 text-body">
                        {items.map(item => {
                            const meta = itemServeMeta(item.status)
                            const selectable = mineClaim && item.status === 'ready'
                            const isSel = selected.has(item.id)
                            return (
                                <li
                                    key={item.id}
                                    className={`flex items-center gap-3 text-ink ${selectable ? 'cursor-pointer' : ''}`}
                                    onClick={selectable ? () => toggle(item.id) : undefined}
                                >
                                    {selectable ? (
                                        <span className="shrink-0">{isSel ? <CheckSquare size={17} className="text-success" /> : <Square size={17} className="text-ink-muted" />}</span>
                                    ) : item.status === 'served' ? (
                                        <Check size={17} className="text-ink-muted shrink-0" />
                                    ) : (
                                        <span className="w-[17px] shrink-0" />
                                    )}
                                    <span className="font-bold text-ink-muted w-6 text-right tabular">{item.quantity}×</span>
                                    <span className={`font-medium ${item.status === 'served' ? 'line-through text-ink-muted' : ''}`}>{item.menu_items?.name}</span>
                                    <span className="ml-auto text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                                </li>
                            )
                        })}
                    </ul>
                </div>

                {order.customer_note && (
                    <div className="mb-4">
                        <Badge tone="warning" className="w-full justify-start p-3 whitespace-normal italic">
                            &ldquo;{order.customer_note}&rdquo;
                        </Badge>
                    </div>
                )}

                {/* Claimed by a colleague */}
                {claimedByOther && (
                    <div className="flex items-center justify-between gap-2 pt-2">
                        <span className="text-small text-ink-subtle flex items-center gap-1.5">
                            <Footprints size={14} /> {claimerName || 'A colleague'} is on the way
                        </span>
                        {hasReady && (
                            <Button variant="secondary" size="sm" onClick={() => onClaim(order.id)} loading={claiming}>
                                Take over
                            </Button>
                        )}
                    </div>
                )}

                {/* Unclaimed but has ready items — first to tap owns the trip */}
                {!claimedBy && hasReady && (
                    <div className="pt-2">
                        <Button variant="primary" size="lg" block onClick={() => onClaim(order.id)} loading={claiming} icon={Footprints}>
                            I&apos;m going
                        </Button>
                    </div>
                )}

                {/* Mine — serve selected ready items, or wait on the kitchen */}
                {mineClaim && (
                    <div className="pt-2 space-y-2">
                        {hasReady ? (
                            <Button
                                variant="primary"
                                size="lg"
                                block
                                onClick={() => onServeItems(order.id, selectedReady)}
                                disabled={selectedReady.length === 0 || busy}
                                loading={serving}
                                icon={Utensils}
                            >
                                Mark Served{selectedReady.length ? ` (${selectedReady.length})` : ''}
                            </Button>
                        ) : (
                            <p className="text-small text-ink-subtle flex items-center gap-1.5 justify-center py-1">
                                <ChefHat size={14} /> Waiting on the kitchen…
                            </p>
                        )}
                        {allReady && (
                            <Button
                                variant="secondary"
                                size="lg"
                                block
                                onClick={() => onCashAndDeliver(order.id)}
                                disabled={busy}
                                loading={cashProcessing}
                                icon={Banknote}
                            >
                                Serve all + Take Cash
                            </Button>
                        )}
                        <button
                            onClick={() => onRelease(order.id)}
                            className="text-caption text-ink-muted hover:text-ink flex items-center gap-1 mx-auto"
                        >
                            <X size={12} /> Release claim
                        </button>
                    </div>
                )}
            </div>
        </Card>
    )
}
