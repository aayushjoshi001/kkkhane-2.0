'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
    ClipboardCheck, ClipboardList, ChevronDown, CheckSquare, Square,
    Trash2, Loader2, Send, CheckCircle2, XCircle, Phone, MapPin,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useConfirmStore } from '@/lib/stores/confirm'
import { useFeatures } from '@/lib/contexts/FeatureContext'
import { usePrinter } from '@/lib/print/usePrinter'
import { buildStationTicket } from '@/lib/print/templates/stationTicket'
import {
    confirmOrderItems, deleteUnconfirmedOrderItem, cancelOrder,
    markOrderItemsServed,
} from '@/app/(staff)/waiter/order-actions'
import { tableLabel, type ActiveOrder, type UnpaidOrder } from './CashierClient'
import type { KitchenOrder } from '@/components/kitchen/OrderQueue'

type AnyOrder = ActiveOrder | UnpaidOrder

interface Props {
    active: ActiveOrder[]
    unpaid: UnpaidOrder[]
    splitSessionIds: Set<string>
    money: (n: number) => string
    onUpdateTakeoutStatus: (orderId: string, status: 'confirmed' | 'cancelled') => Promise<void>
}

function locationLabel(order: AnyOrder, splitSessionIds: Set<string>): string {
    const roomNumber = order.bookings?.rooms?.room_number
    if (roomNumber) return `Room ${roomNumber}`
    if (order.order_type === 'takeout') return `Takeaway · ${order.customer_name || 'Customer'}`
    if (order.order_type === 'delivery') return `Delivery · ${order.customer_name || 'Customer'}`
    return `Table ${tableLabel(order.sessions, splitSessionIds)}`
}

// Small select-all + per-item toggle set, mirroring the pattern already used
// in the kitchen board (OrderQueue.tsx's OrderTicket).
function useSelection(ids: string[]) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(ids))
    const idsKey = ids.join(',')
    const prevKeyRef = useRef(idsKey)
    if (prevKeyRef.current !== idsKey) {
        prevKeyRef.current = idsKey
        setSelected(new Set(ids))
    }
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id))
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ids))
    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
    })
    return { selected, allSelected, toggleAll, toggle }
}

export default function CashierOrdersPanel({ active, unpaid, splitSessionIds, money, onUpdateTakeoutStatus }: Props) {
    const { confirm } = useConfirmStore()
    const features = useFeatures()
    const { print: printKot } = usePrinter('kot')
    const { print: printBot } = usePrinter('bot')
    const supabaseRef = useRef(createClient())

    const [ordersSubTab, setOrdersSubTab] = useState<'confirmation' | 'status'>('confirmation')
    const [expandedConfirmId, setExpandedConfirmId] = useState<string | null>(null)
    const [expandedStatusId, setExpandedStatusId] = useState<string | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [cancelReason, setCancelReason] = useState('')
    const confirmRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const statusRowRefs = useRef<Record<string, HTMLDivElement | null>>({})

    // ── Order Confirmation — QR self-orders with an unconfirmed item, plus
    // takeaway/delivery orders still awaiting the cashier's pending→confirmed
    // review (a separate, order-level confirmation mechanism) ─────────────────
    const confirmationOrders = useMemo(
        () => active.filter(o =>
            (o.order_items || []).some(i => i.needs_confirmation) ||
            ((o.order_type === 'takeout' || o.order_type === 'delivery') && o.status === 'pending')
        ),
        [active]
    )

    // ── Order Status — every open order regardless of origin ───────────────────
    const statusOrders = useMemo(
        () => [...active, ...unpaid].filter(o => o.status !== 'cancelled'),
        [active, unpaid]
    )

    function expandConfirm(id: string) {
        const next = expandedConfirmId === id ? null : id
        setExpandedConfirmId(next)
        if (next) {
            requestAnimationFrame(() => confirmRowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        }
    }

    function expandStatus(id: string) {
        const next = expandedStatusId === id ? null : id
        setExpandedStatusId(next)
        if (next) {
            requestAnimationFrame(() => statusRowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        }
    }

    // Prints a KOT/BOT for the just-confirmed items — the ticket the kitchen
    // never got at placement time since deduction/printing was deferred to
    // this moment. A dedicated fetch because the lightweight list query this
    // panel receives doesn't carry station/modifier detail needed for a ticket.
    async function printConfirmedItems(order: ActiveOrder, itemIds: string[]) {
        if (!features.kotEnabled || itemIds.length === 0) return
        const { data: rawItems } = await supabaseRef.current
            .from('order_items')
            .select(`
                id, quantity, unit_price, special_request,
                menu_items ( id, name, station, is_combo ),
                menu_item_variations:menu_item_variation_id ( id, name ),
                order_item_modifiers ( modifier_name, price_adjustment )
            `)
            .in('id', itemIds)
        if (!rawItems || rawItems.length === 0) return
        const items = rawItems as unknown as { menu_items?: { station?: string | null } | null }[]

        const printableOrder = { ...order, order_items: items } as unknown as KitchenOrder
        const foodItems = items.filter(i => i.menu_items?.station !== 'bar')
        const barItems = items.filter(i => i.menu_items?.station === 'bar')

        if (foodItems.length > 0) {
            void printKot(buildStationTicket(printableOrder, 'kitchen'))
                .catch(err => console.error('[Order Confirmation] KOT print failed:', err))
        }
        if (barItems.length > 0) {
            void printBot(buildStationTicket(printableOrder, 'bar'))
                .catch(err => console.error('[Order Confirmation] BOT print failed:', err))
        }
    }

    async function handleConfirmItems(order: ActiveOrder, itemIds: string[]) {
        if (itemIds.length === 0) { toast.error('Select at least one item'); return }
        const ok = await confirm({
            title: 'Send to kitchen?',
            message: `Confirm ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} for ${locationLabel(order, splitSessionIds)}? This sends them to the kitchen immediately.`,
            confirmText: 'Confirm & Send',
        })
        if (!ok) return

        setBusyId(order.id)
        const res = await confirmOrderItems(order.id, itemIds)
        setBusyId(null)
        if (res.error) { toast.error(res.error); return }
        toast.success('Sent to kitchen ✓')
        void printConfirmedItems(order, itemIds)
    }

    async function handleTakeoutConfirm(orderId: string) {
        setBusyId(orderId)
        await onUpdateTakeoutStatus(orderId, 'confirmed')
        setBusyId(null)
    }

    async function handleTakeoutCancel(order: ActiveOrder) {
        const ok = await confirm({
            title: 'Cancel this order?',
            message: `Cancel this ${order.order_type} order for ${order.customer_name || 'the customer'}? This action cannot be undone.`,
            confirmText: 'Cancel Order',
            isDestructive: true,
        })
        if (!ok) return
        setBusyId(order.id)
        await onUpdateTakeoutStatus(order.id, 'cancelled')
        setBusyId(null)
    }

    async function handleDeleteItem(orderId: string, itemId: string, label: string) {
        const ok = await confirm({
            title: 'Remove item?',
            message: `Remove "${label}" from this order? It was never sent to the kitchen, so nothing is charged.`,
            confirmText: 'Remove',
            isDestructive: true,
        })
        if (!ok) return
        const res = await deleteUnconfirmedOrderItem(orderId, itemId)
        if (res.error) { toast.error(res.error); return }
        toast.success('Item removed')
    }

    async function handleMarkServed(orderId: string, itemIds: string[]) {
        if (itemIds.length === 0) { toast.error('Select at least one ready item'); return }
        setBusyId(orderId)
        const res = await markOrderItemsServed(orderId, itemIds)
        setBusyId(null)
        if (res.error) { toast.error(res.error); return }
        toast.success('Marked served ✓')
    }

    async function handleCancelOrder(order: AnyOrder) {
        const ok = await confirm({
            title: 'Cancel this order?',
            message: `This removes the order from ${locationLabel(order, splitSessionIds)}'s bill and logs its value as an Order Cancellation expense. This cannot be undone.`,
            confirmText: 'Cancel Order',
            isDestructive: true,
        })
        if (!ok) return
        setBusyId(order.id)
        const res = await cancelOrder(order.id, cancelReason)
        setBusyId(null)
        if (res.error) { toast.error(res.error); return }
        setCancelReason('')
        setExpandedStatusId(null)
        toast.success('Order cancelled')
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Sub-tabs — same pattern as the Takeaway/Delivery toggle: only one
                section shown at a time, full width. */}
            <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                <div className="grid grid-cols-2 gap-2 sm:gap-4 w-full">
                    {([
                        { key: 'confirmation', label: 'Order Confirmation', count: confirmationOrders.length, icon: ClipboardCheck },
                        { key: 'status', label: 'Order Status', count: statusOrders.length, icon: ClipboardList },
                    ] as const).map(({ key, label, count, icon: Icon }) => {
                        const isActive = ordersSubTab === key
                        const activeColors = {
                            confirmation: 'bg-amber-500 text-white',
                            status: 'bg-[var(--brand-500)] text-white',
                        }
                        return (
                            <button
                                key={key}
                                onClick={() => setOrdersSubTab(key)}
                                className={`relative flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                    isActive
                                        ? activeColors[key]
                                        : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                }`}
                            >
                                <Icon size={14} />
                                <span>{label}</span>
                                {count > 0 && (
                                    <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                        isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                    }`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </div>

            {ordersSubTab === 'confirmation' && (
                <div className="bg-surface rounded-[24px] border border-hairline shadow-sm overflow-hidden">
                    <div className="divide-y divide-gray-50">
                        {confirmationOrders.length === 0 && (
                            <p className="px-4 py-12 text-center text-xs text-ink-subtle font-semibold">No orders awaiting confirmation.</p>
                        )}
                        {confirmationOrders.map(order => {
                            const isTakeoutPending = (order.order_type === 'takeout' || order.order_type === 'delivery') && order.status === 'pending'
                            const pendingItems = (order.order_items || []).filter(i => i.needs_confirmation)
                            const isExpanded = expandedConfirmId === order.id
                            return (
                                <div key={order.id} ref={el => { confirmRowRefs.current[order.id] = el }}>
                                    <button
                                        onClick={() => expandConfirm(order.id)}
                                        className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left hover:bg-surface-muted/50 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-ink truncate">{locationLabel(order, splitSessionIds)}</p>
                                            <p className="text-[11px] text-ink-subtle">
                                                {isTakeoutPending
                                                    ? 'Awaiting confirmation'
                                                    : `${pendingItems.length} item${pendingItems.length !== 1 ? 's' : ''} pending`}
                                            </p>
                                        </div>
                                        <ChevronDown size={15} className={`text-ink-subtle shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isExpanded && (
                                        isTakeoutPending ? (
                                            <TakeoutConfirmDetail
                                                order={order}
                                                money={money}
                                                busy={busyId === order.id}
                                                onConfirm={() => handleTakeoutConfirm(order.id)}
                                                onCancel={() => handleTakeoutCancel(order)}
                                            />
                                        ) : (
                                            <ConfirmationDetail
                                                order={order}
                                                items={pendingItems}
                                                money={money}
                                                busy={busyId === order.id}
                                                onConfirm={(ids) => handleConfirmItems(order, ids)}
                                                onDelete={(itemId, label) => handleDeleteItem(order.id, itemId, label)}
                                            />
                                        )
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {ordersSubTab === 'status' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                    {statusOrders.length === 0 && (
                        <p className="col-span-full py-12 text-center text-xs text-ink-subtle font-semibold bg-surface rounded-2xl border border-hairline shadow-sm">No open orders right now.</p>
                    )}
                    {statusOrders.map(order => {
                        const items = order.order_items || []
                        const isExpanded = expandedStatusId === order.id
                        return (
                            <div 
                                key={order.id} 
                                ref={el => { statusRowRefs.current[order.id] = el }}
                                className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden flex flex-col h-fit"
                            >
                                <button
                                    onClick={() => expandStatus(order.id)}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-muted/50 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-ink truncate">{locationLabel(order, splitSessionIds)}</p>
                                        <p className="text-[11px] text-ink-subtle capitalize">{order.status} · {items.length} item{items.length !== 1 ? 's' : ''} · {money(Number(order.total_amount) || 0)}</p>
                                    </div>
                                    <ChevronDown size={15} className={`text-ink-subtle shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>
                                {isExpanded && (
                                    <StatusDetail
                                        order={order}
                                        items={items}
                                        money={money}
                                        busy={busyId === order.id}
                                        reason={cancelReason}
                                        onReasonChange={setCancelReason}
                                        onMarkServed={(ids) => handleMarkServed(order.id, ids)}
                                        onCancel={() => handleCancelOrder(order)}
                                        kotEnabled={features.kotEnabled}
                                    />
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function ConfirmationDetail({ order, items, money, busy, onConfirm, onDelete }: {
    order: ActiveOrder
    items: NonNullable<ActiveOrder['order_items']>
    money: (n: number) => string
    busy: boolean
    onConfirm: (itemIds: string[]) => void
    onDelete: (itemId: string, label: string) => void
}) {
    const ids = items.map(i => i.id!).filter(Boolean)
    const { selected, allSelected, toggleAll, toggle } = useSelection(ids)

    return (
        <div className="px-4 pb-4 pt-1 bg-surface-muted/30 space-y-2.5">
            <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-[11px] font-bold text-ink-subtle hover:text-ink transition-colors"
            >
                {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                Select All
            </button>
            <div className="space-y-1.5">
                {items.map(item => (
                    <div key={item.id} className="flex items-center gap-2.5 bg-surface rounded-xl border border-hairline px-3 py-2">
                        <button onClick={() => item.id && toggle(item.id)} className="shrink-0 text-brand-500">
                            {item.id && selected.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-ink-subtle" />}
                        </button>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-ink truncate">{item.quantity}× {item.menu_items?.name || 'Item'}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                            {money((item.unit_price || 0) * item.quantity)}
                        </span>
                        <button
                            onClick={() => item.id && onDelete(item.id, item.menu_items?.name || 'Item')}
                            className="shrink-0 p-1 rounded-lg text-ink-subtle hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </div>
            <button
                onClick={() => onConfirm(Array.from(selected))}
                disabled={busy || selected.size === 0}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Confirm Selected ({selected.size})
            </button>
        </div>
    )
}

// Order-level confirmation for a pending takeaway/delivery order — a
// separate mechanism from the item-level QR flow above (these were placed
// as a whole, not confirmed item by item), so it's just a straight
// confirm/cancel over the full order.
function TakeoutConfirmDetail({ order, money, busy, onConfirm, onCancel }: {
    order: ActiveOrder
    money: (n: number) => string
    busy: boolean
    onConfirm: () => void
    onCancel: () => void
}) {
    const items = order.order_items || []
    return (
        <div className="px-4 pb-4 pt-1 bg-surface-muted/30 space-y-2.5">
            <div className="space-y-1 text-xs text-ink-muted bg-surface p-3 rounded-xl border border-hairline">
                <p className="font-bold text-ink text-sm">{order.customer_name || 'Customer'}</p>
                {order.customer_phone && (
                    <p className="font-mono flex items-center gap-1.5"><Phone size={11} />{order.customer_phone}</p>
                )}
                {order.order_type === 'delivery' && order.delivery_address && (
                    <p className="text-ink-subtle italic mt-1 flex items-start gap-1.5">
                        <MapPin size={11} className="mt-0.5 shrink-0" />
                        {order.delivery_address}
                    </p>
                )}
            </div>
            <div className="space-y-1.5">
                {items.map(item => (
                    <div key={item.id} className="flex items-center gap-2.5 bg-surface rounded-xl border border-hairline px-3 py-2">
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-ink truncate">{item.quantity}× {item.menu_items?.name || 'Item'}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                            {money((item.unit_price || 0) * item.quantity)}
                        </span>
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between text-xs font-bold pt-1">
                <span className="text-ink-muted">Total</span>
                <span className="text-brand-600 tabular-nums">{money(Number(order.total_amount) || 0)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
                <button
                    onClick={onCancel}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <XCircle size={13} />
                    Cancel Order
                </button>
                <button
                    onClick={onConfirm}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Confirm Order
                </button>
            </div>
        </div>
    )
}

function StatusDetail({ order, items, money, busy, reason, onReasonChange, onMarkServed, onCancel, kotEnabled }: {
    order: AnyOrder
    items: NonNullable<AnyOrder['order_items']>
    money: (n: number) => string
    busy: boolean
    reason: string
    onReasonChange: (v: string) => void
    onMarkServed: (itemIds: string[]) => void
    onCancel: () => void
    kotEnabled?: boolean
}) {
    const readyIds = items.filter(i => i.status === 'ready' && i.id).map(i => i.id!)
    const { selected, allSelected, toggleAll, toggle } = useSelection(readyIds)

    return (
        <div className="px-4 pb-4 pt-1 bg-surface-muted/30 space-y-2.5">
            {!kotEnabled && readyIds.length > 0 && (
                <button
                    onClick={toggleAll}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-ink-subtle hover:text-ink transition-colors"
                >
                    {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                    Select All Ready
                </button>
            )}
            <div className="space-y-1.5">
                {items.map(item => {
                    const canServe = !kotEnabled && item.status === 'ready' && item.id
                    return (
                        <div key={item.id} className="flex items-center gap-2.5 bg-surface rounded-xl border border-hairline px-3 py-2">
                            {canServe ? (
                                <button onClick={() => item.id && toggle(item.id)} className="shrink-0 text-brand-500">
                                    {item.id && selected.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-ink-subtle" />}
                                </button>
                            ) : null}
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-ink truncate">{item.quantity}× {item.menu_items?.name || 'Item'}</p>
                                {!kotEnabled && <p className="text-[10px] text-ink-subtle capitalize">{item.status}</p>}
                            </div>
                            <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                                {money((item.unit_price || 0) * item.quantity)}
                            </span>
                        </div>
                    )
                })}
            </div>
            {!kotEnabled && readyIds.length > 0 && (
                <button
                    onClick={() => onMarkServed(Array.from(selected))}
                    disabled={busy || selected.size === 0}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Mark Served ({selected.size})
                </button>
            )}

            <div className="pt-2 border-t border-dashed border-hairline space-y-2">
                <input
                    type="text"
                    value={reason}
                    onChange={e => onReasonChange(e.target.value)}
                    placeholder="Cancellation reason (optional)"
                    className="w-full text-xs border-hairline rounded-lg px-3 py-2 border bg-surface text-ink placeholder:text-ink-subtle"
                />
                <button
                    onClick={onCancel}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                    Cancel Order
                </button>
            </div>
        </div>
    )
}
