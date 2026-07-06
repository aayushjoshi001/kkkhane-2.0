'use client'

import { useWindowVirtualizer } from '@tanstack/react-virtual'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid, markOrderItemsServed, claimOrder, releaseOrder, claimOrderItems, releaseOrderItems } from '@/app/(staff)/waiter/order-actions'
import { playOrderReady, playNewOrder } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Package, ChefHat, Banknote, Clock, Footprints, X, CheckSquare, Square, Check, Utensils } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import TableChip from '@/components/ui/TableChip'
import FeedSection from '@/components/ui/FeedSection'
import EmptyState from '@/components/ui/EmptyState'
import { Badge, StatusBadge } from '@/components/ui/Badge'
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
  order_items ( id, quantity, status, claimed_by, menu_items ( name ) )
` as const

function tableLabel(order: WaiterOrder) {
    return order.sessions?.tables?.label || '?'
}

function readyCountForUser(order: WaiterOrder, userId: string) {
    return (order.order_items || []).filter(i => i.status === 'ready' && (!i.claimed_by || i.claimed_by === userId)).length
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
                            <p className="text-xs text-ink-subtle mt-0.5">{tbl ? `Table ${tbl}` : 'Takeout'}</p>
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

            const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const fresh = data as unknown as WaiterOrder
            const prev = ordersRef.current.find(o => o.id === fresh.id)
            const prevReady = prev ? readyCountForUser(prev, userId) : 0
            const newReady = readyCountForUser(fresh, userId)

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

    const handleClaimItems = async (orderId: string, itemIds: string[]) => {
        if (itemIds.length === 0) return
        setClaimingId(orderId)
        const snapshot = ordersRef.current
        setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o
            const items = (o.order_items || []).map(it =>
                itemIds.includes(it.id) ? { ...it, claimed_by: userId } : it)
            return { ...o, order_items: items }
        }))
        const res = await claimOrderItems(orderId, itemIds)
        if (res?.error) {
            setOrders(snapshot)
            toast.error(res.error)
        } else {
            toast.success('Dishes claimed!')
        }
        setClaimingId(null)
    }

    const handleReleaseItems = async (orderId: string, itemIds: string[]) => {
        if (itemIds.length === 0) return
        setClaimingId(orderId)
        const snapshot = ordersRef.current
        setOrders(prev => prev.map(o => {
            if (o.id !== orderId) return o
            const items = (o.order_items || []).map(it =>
                itemIds.includes(it.id) ? { ...it, claimed_by: null } : it)
            return { ...o, order_items: items }
        }))
        const res = await releaseOrderItems(orderId, itemIds)
        if (res?.error) {
            setOrders(snapshot)
            toast.error(res.error)
        } else {
            toast.success('Claims released!')
        }
        setClaimingId(null)
    }

    const handleServeItems = async (orderId: string, itemIds: string[]) => {
        if (itemIds.length === 0) return
        setServingId(orderId)
        const snapshot = ordersRef.current
        setOrders(prev => prev
            .map(o => {
                if (o.id !== orderId) return o
                const items = (o.order_items || []).map(it =>
                    itemIds.includes(it.id) ? { ...it, status: 'served' as OrderItemStatus } : it)
                return { ...o, order_items: items }
            })
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

    // Filter live orders list to ONLY show orders containing ready items for this user
    const visibleOrders = useMemo(() => {
        return orders.filter(o => readyCountForUser(o, userId) > 0)
    }, [orders, userId])

    const sortedOrders = useMemo(() => {
        return [...visibleOrders].sort((a, b) => {
            const readyA = readyCountForUser(a, userId), readyB = readyCountForUser(b, userId)
            if (readyA !== readyB) return readyB - readyA
            const scoreA = STATUS_ORDER[a.status] ?? 0
            const scoreB = STATUS_ORDER[b.status] ?? 0
            if (scoreA !== scoreB) return scoreB - scoreA
            return new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime()
        })
    }, [visibleOrders, userId])

    const totalReadyItems = visibleOrders.reduce((sum, o) => sum + readyCountForUser(o, userId), 0)

    const parentRef = useRef<HTMLDivElement>(null)
    const virtualizer = useWindowVirtualizer({
        count: sortedOrders.length,
        estimateSize: () => 300,
        overscan: 3,
    })

    if (visibleOrders.length === 0) {
        return (
            <FeedSection icon={Package} title="Live Orders">
                <Card padding={24}>
                    <EmptyState icon={ChefHat} title="No active orders" description="Incoming ready orders will appear here in real time." />
                </Card>
            </FeedSection>
        )
    }

    return (
        <FeedSection
            icon={Package}
            title="Live Orders"
            count={visibleOrders.length}
            tone="neutral"
            action={totalReadyItems > 0 ? <Badge tone="success" dot>{totalReadyItems} item{totalReadyItems > 1 ? 's' : ''} ready</Badge> : undefined}
        >
            <div ref={parentRef}>
                <div 
                    style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }} 
                >
                    {virtualizer.getVirtualItems().map((virtualItem) => {
                        const order = sortedOrders[virtualItem.index]
                        return (
                            <div
                                key={order.id}
                                data-index={virtualItem.index}
                                ref={virtualizer.measureElement}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualItem.start}px)`,
                                    paddingBottom: '12px'
                                }}
                            >
                                <WaiterOrderCard
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
                                    onClaimItems={handleClaimItems}
                                    onReleaseItems={handleReleaseItems}
                                    onServeItems={handleServeItems}
                                    onCashAndDeliver={handleCashAndDeliver}
                                />
                            </div>
                        )
                    })}
                </div>
            </div>
        </FeedSection>
    )
}

function itemServeMeta(status: OrderItemStatus, isClaimedByMe: boolean) {
    if (status === 'ready') {
        return isClaimedByMe 
            ? { label: 'Serving', color: 'var(--color-primary)' }
            : { label: 'Ready', color: 'var(--success)' }
    }
    switch (status) {
        case 'served':    return { label: 'Served', color: 'var(--ink-muted)' }
        case 'preparing': return { label: 'Cooking', color: 'var(--info)' }
        case 'cancelled': return { label: 'Cancelled', color: 'var(--danger)' }
        default:          return { label: 'Queued', color: 'var(--ink-muted)' }
    }
}

function WaiterOrderCard({
    order, userId, staffNames, money, now,
    claiming, serving, cashProcessing, busy,
    onClaim, onRelease, onClaimItems, onReleaseItems, onServeItems, onCashAndDeliver,
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
    onClaimItems: (orderId: string, itemIds: string[]) => void
    onReleaseItems: (orderId: string, itemIds: string[]) => void
    onServeItems: (orderId: string, itemIds: string[]) => void
    onCashAndDeliver: (orderId: string) => void
}) {
    const label = tableLabel(order)
    
    // Only show items that are ready AND (unclaimed or claimed by current user)
    const items = useMemo(() => {
        return (order.order_items || []).filter(item => {
            return item.status === 'ready' && (!item.claimed_by || item.claimed_by === userId)
        })
    }, [order.order_items, userId])

    const readyItems = useMemo(() => items.filter(i => i.status === 'ready'), [items])
    const hasReady = readyItems.length > 0
    const allReady = order.status === 'ready'

    const claimedBy = order.claimed_by
    const mineClaim = claimedBy === userId
    const claimedByOther = !!claimedBy && !mineClaim
    const claimerName = claimedBy ? staffNames[claimedBy] : undefined

    const ts = order.ready_at || order.placed_at
    const isStale = now - new Date(ts).getTime() > STALE_MS

    // Selection over the ready items, defaulting to all.
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
    }, [readyKey, readyItems])

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    
    const allSelected = readyItems.length > 0 && readyItems.every(i => selected.has(i.id))
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(readyItems.map(i => i.id)))
    
    const selectedReady = readyItems.filter(i => selected.has(i.id)).map(i => i.id)
    const selectedUnclaimed = readyItems.filter(i => selected.has(i.id) && !i.claimed_by).map(i => i.id)
    const selectedClaimedByMe = readyItems.filter(i => selected.has(i.id) && i.claimed_by === userId).map(i => i.id)

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
                        <span className="text-caption font-bold text-ink-subtle block uppercase tracking-wider">{order.payment_status}</span>
                    </div>
                </div>

                {/* Items list */}
                <div className="bg-surface-muted rounded-[var(--r-md)] p-3 mb-4">
                    {readyItems.length > 1 && (
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
                            const isClaimedByMe = item.claimed_by === userId
                            const meta = itemServeMeta(item.status, isClaimedByMe)
                            const selectable = item.status === 'ready' && (!item.claimed_by || isClaimedByMe)
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

                {/* Actions */}
                <div className="pt-2 space-y-2">
                    {/* 1. Unclaimed items serving action */}
                    {selectedUnclaimed.length > 0 && (
                        <Button
                            variant="primary"
                            size="lg"
                            block
                            onClick={() => onClaimItems(order.id, selectedUnclaimed)}
                            disabled={claiming || busy}
                            loading={claiming}
                            icon={Footprints}
                        >
                            I&apos;m serving selected ({selectedUnclaimed.length})
                        </Button>
                    )}

                    {/* 2. Claimed items serving action */}
                    {selectedClaimedByMe.length > 0 && (
                        <>
                            <Button
                                variant="primary"
                                size="lg"
                                block
                                onClick={() => onServeItems(order.id, selectedClaimedByMe)}
                                disabled={serving || busy}
                                loading={serving}
                                icon={Utensils}
                            >
                                Mark Served ({selectedClaimedByMe.length})
                            </Button>
                            <button
                                onClick={() => onReleaseItems(order.id, selectedClaimedByMe)}
                                disabled={claiming || busy}
                                className="text-caption text-ink-muted hover:text-ink flex items-center gap-1 mx-auto"
                            >
                                <X size={12} /> Release claim for selected ({selectedClaimedByMe.length})
                            </button>
                        </>
                    )}

                    {/* Wait state */}
                    {readyItems.length === 0 && (
                        <p className="text-small text-ink-subtle flex items-center gap-1.5 justify-center py-1">
                            <ChefHat size={14} /> Waiting on the kitchen…
                        </p>
                    )}

                    {/* Deliver / Cash action */}
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
                </div>
            </div>
        </Card>
    )
}
