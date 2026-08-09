'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'react-hot-toast'
import {
    ClipboardCheck, ClipboardList, ChevronDown, CheckSquare, Square,
    Trash2, Loader2, Send, CheckCircle2, XCircle, Phone, MapPin, Plus, Minus, Printer,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useConfirmStore } from '@/lib/stores/confirm'
import { useFeatures } from '@/lib/contexts/FeatureContext'
import { usePrinter } from '@/lib/print/usePrinter'
import { buildStationTicket } from '@/lib/print/templates/stationTicket'
import { OUTSTANDING_PRINT_SELECT, claimForPrinting } from '@/lib/print/printClaims'
import { itemsForStation, STATION_META, type StationKind } from '@/lib/stations'
import {
    confirmOrderItems, deleteUnconfirmedOrderItem, cancelOrder,
    markOrderItemsServed, cancelOrderItem,
} from '@/app/(staff)/waiter/order-actions'
import { getItemDisplayName } from '@/lib/utils'
import { formatTime } from '@/lib/calendar'
import ReasonPicker from '@/components/shared/ReasonPicker'
import type { CancellationKind } from '@/lib/voidReasons'
import { tableLabel, type ActiveOrder, type UnpaidOrder } from './CashierClient'
import type { KitchenOrder } from '@/components/kitchen/OrderQueue'

type AnyOrder = ActiveOrder | UnpaidOrder

interface Props {
    active: ActiveOrder[]
    unpaid: UnpaidOrder[]
    splitSessionIds: Set<string>
    money: (n: number) => string
    onUpdateTakeoutStatus: (orderId: string, status: 'confirmed' | 'cancelled') => Promise<void>
    restaurantName: string
    onCancelOrder?: (orderId: string) => void
    onCancelOrderItem?: (orderId: string, itemId: string, cancelQuantity: number) => void
}

function locationLabel(order: AnyOrder, splitSessionIds: Set<string>): string {
    const roomNumber = order.bookings?.rooms?.room_number || order.sessions?.bookings?.rooms?.room_number
    const hasTable = !!order.session_id && !!order.sessions
    const tblLabel = hasTable ? tableLabel(order.sessions, splitSessionIds) : null

    if (roomNumber && tblLabel && tblLabel !== '?') {
        return `Room ${roomNumber} - Table ${tblLabel}`
    }
    if (roomNumber) return `Room ${roomNumber}`
    if (order.order_type === 'takeout') return `Takeaway · ${order.customer_name || 'Customer'}`
    if (order.order_type === 'delivery') return `Delivery · ${order.customer_name || 'Customer'}`
    if (tblLabel && tblLabel !== '?') return `Table ${tblLabel}`
    return 'Unknown Location'
}

// Small select-all + per-item toggle set, mirroring the pattern already used
// in the kitchen board (OrderQueue.tsx's OrderTicket).
function useSelection(ids: string[]) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(ids))
    const idsKey = ids.join(',')
    // Reset the selection when the order list changes, held in state rather than
    // a ref. Adjusting state during render is the supported way to do this, but
    // it has to be compared against state: a ref written during render is a
    // side effect on a render React is free to discard and replay, and a replay
    // sees the ref already updated and skips the reset -- leaving items ticked
    // that belong to the previous list, on a panel whose tick boxes decide what
    // gets settled.
    const [prevKey, setPrevKey] = useState(idsKey)
    if (prevKey !== idsKey) {
        setPrevKey(idsKey)
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

export default function CashierOrdersPanel({ active, unpaid, splitSessionIds, money, onUpdateTakeoutStatus, restaurantName, onCancelOrder, onCancelOrderItem }: Props) {
    const { confirm } = useConfirmStore()
    const features = useFeatures()
    const { print: printKot } = usePrinter('kot')
    const { print: printBot } = usePrinter('bot')
    const supabaseRef = useRef(createClient())

    const [mounted, setMounted] = useState(false)
    const [cancelItemModal, setCancelItemModal] = useState<{
        orderId: string
        itemId: string
        label: string
        maxQty: number
        unitPrice: number
    } | null>(null)
    const [cancelQty, setCancelQty] = useState(1)
    const [cancelReasonInput, setCancelReasonInput] = useState('')
    // Void vs comp, and the structured code, for the single-item dialog.
    const [cancelItemKind, setCancelItemKind] = useState<CancellationKind>('void')
    const [cancelItemCode, setCancelItemCode] = useState<string | null>(null)

    useEffect(() => {
        setMounted(true)
    }, [])

    const [ordersSubTab, setOrdersSubTab] = useState<'confirmation' | 'status'>('confirmation')
    const [expandedConfirmId, setExpandedConfirmId] = useState<string | null>(null)
    const [expandedStatusId, setExpandedStatusId] = useState<string | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [reprintingId, setReprintingId] = useState<string | null>(null)
    const [cancelReason, setCancelReason] = useState('')
    // Same pair as the item dialog, for the whole-order cancel footer.
    const [cancelOrderKind, setCancelOrderKind] = useState<CancellationKind>('void')
    const [cancelOrderCode, setCancelOrderCode] = useState<string | null>(null)
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

    // ── Grouped Order Status — grouped by location/session/booking ───────────────────
    const groupedStatusCards = useMemo(() => {
        const groups: Record<string, {
            key: string
            title: string
            orderType: string
            placedAt: string
            orders: AnyOrder[]
            totalAmount: number
        }> = {}

        // Dedupe by id, preferring the `unpaid` copy on a clash — `active` and
        // `unpaid` are two separately-updated realtime-patched lists, and a
        // transient race between them (an order mid-transition landing in
        // both at once) would otherwise render the same order.id twice and
        // crash React on the duplicate key.
        const byId = new Map<string, AnyOrder>()
        for (const o of active) byId.set(o.id, o)
        for (const o of unpaid) byId.set(o.id, o)
        const allOrders = Array.from(byId.values()).filter(o => o.status !== 'cancelled')

        for (const order of allOrders) {
            let key = ''
            let title = ''
            const roomNumber = order.bookings?.rooms?.room_number || order.sessions?.bookings?.rooms?.room_number
            const hasTable = !!order.session_id && !!order.sessions
            const tblLabel = hasTable ? tableLabel(order.sessions, splitSessionIds) : null
            const bookingId = order.booking_id || order.sessions?.booking_id

            if (roomNumber && hasTable && tblLabel && tblLabel !== '?') {
                key = `booking-${bookingId || 'b'}-session-${order.session_id}`
                title = `Room ${roomNumber} - Table ${tblLabel}`
            } else if (order.session_id) {
                key = `session-${order.session_id}`
                title = `Table ${tblLabel || '?'}`
            } else if (bookingId) {
                key = `booking-${bookingId}`
                title = roomNumber ? `Room ${roomNumber}` : 'Room Service'
            } else {
                key = `order-${order.id}`
                title = order.order_type === 'takeout'
                    ? `Takeaway · ${order.customer_name || 'Customer'}`
                    : `Delivery · ${order.customer_name || 'Customer'}`
            }

            if (!groups[key]) {
                groups[key] = {
                    key,
                    title,
                    orderType: order.order_type || 'dine_in',
                    placedAt: order.placed_at,
                    orders: [],
                    totalAmount: 0
                }
            }

            const group = groups[key]
            group.orders.push(order)
            group.totalAmount += Number(order.total_amount) || 0
            if (new Date(order.placed_at) < new Date(group.placedAt)) {
                group.placedAt = order.placed_at
            }
        }

        return Object.values(groups).sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime())
    }, [active, unpaid, splitSessionIds])

    function expandConfirm(id: string) {
        const next = expandedConfirmId === id ? null : id
        setExpandedConfirmId(next)
        if (next) {
            requestAnimationFrame(() => confirmRowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        }
    }

    function expandStatus(key: string) {
        const next = expandedStatusId === key ? null : key
        setExpandedStatusId(next)
        if (next) {
            requestAnimationFrame(() => statusRowRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        }
    }

    // Prints a KOT/BOT for the just-confirmed items — the ticket the kitchen
    // never got at placement time since deduction/printing was deferred to
    // this moment. A dedicated fetch because the lightweight list query this
    // panel receives doesn't carry station/modifier detail needed for a ticket.
    async function printConfirmedItems(order: ActiveOrder, itemIds: string[]) {
        if (!features.kotEnabled || itemIds.length === 0) return
        // Claim before printing, like every other auto-print path. This used to
        // print straight out, and confirmOrderItems never stamps kot_printed_at
        // — so these lines stayed "outstanding" and the 60s catch-up poll in
        // CashierClient printed the whole ticket a second time. Harmless while
        // KOT was off for everyone; a duplicate ticket per confirmation now
        // that it is on by default.
        const wonIds = await claimForPrinting(supabaseRef.current, itemIds)
        if (wonIds.length === 0) return // a station board got there first
        const { data: rawItems } = await supabaseRef.current
            .from('order_items')
            .select(`
                id, quantity, unit_price, special_request, station,
                menu_items ( id, name, station, is_combo ),
                menu_item_variations:menu_item_variation_id ( id, name ),
                order_item_modifiers ( modifier_name, price_adjustment )
            `)
            .in('id', wonIds)
        if (!rawItems || rawItems.length === 0) return
        const items = rawItems as unknown as KitchenOrder['order_items'] & object[]

        const printableOrder = { ...order, order_items: items } as unknown as KitchenOrder
        // Route on order_items.station, the value frozen when the line was
        // written — menu_items.station is null whenever an item inherits its
        // station from the category default, which silently sent every
        // inheriting drink to the kitchen roll.
        const foodItems = itemsForStation(printableOrder.order_items, 'kitchen')
        const barItems = itemsForStation(printableOrder.order_items, 'bar')

        if (foodItems.length > 0) {
            void printKot(buildStationTicket(printableOrder, 'kitchen', restaurantName))
                .catch(err => console.error('[Order Confirmation] KOT print failed:', err))
        }
        if (barItems.length > 0) {
            void printBot(buildStationTicket(printableOrder, 'bar', restaurantName))
                .catch(err => console.error('[Order Confirmation] BOT print failed:', err))
        }
    }

    /**
     * Reprint an order's station tickets on demand.
     *
     * Auto-print claims each line so two stations can't both print it, and a
     * claim is set on the printer reporting success — which is not the same as
     * paper existing. QZ Tray hands a job to a queue or a socket and calls that
     * done, so a printer that is offline, out of paper or misrouted still looks
     * like a successful print and the claim never comes back. This is the way
     * out of that: a human decides a ticket is missing and asks again.
     *
     * Deliberately ignores the claim rather than releasing it. Reprinting is an
     * override, not a correction of the record — clearing kot_printed_at would
     * also invite every other connected station to print its own copy.
     */
    async function handleReprintTickets(orderId: string) {
        setReprintingId(orderId)
        try {
            // The list query this panel receives is lightweight and carries no
            // station or modifier detail, so re-read the order as the printer
            // needs to see it.
            const { data, error } = await supabaseRef.current
                .from('orders')
                .select(OUTSTANDING_PRINT_SELECT)
                .eq('id', orderId)
                .single()
            if (error || !data) {
                toast.error('Could not load that order to reprint.')
                return
            }
            const full = data as unknown as KitchenOrder
            // Cancelled lines are not cooked, and unconfirmed ones are not the
            // kitchen's yet — neither belongs on a ticket.
            const printable = (full.order_items || []).filter(i => i.status !== 'cancelled' && !i.needs_confirmation)
            if (printable.length === 0) {
                toast.error('Nothing on this order to print.')
                return
            }
            const scoped = { ...full, order_items: printable }

            for (const station of ['kitchen', 'bar'] as StationKind[]) {
                if (itemsForStation(printable, station).length === 0) continue
                const abbr = STATION_META[station].ticketAbbr
                const send = station === 'bar' ? printBot : printKot
                const result = await send(buildStationTicket(scoped, station, restaurantName))
                if (result.ok) {
                    toast.success(result.usedLocalFallback
                        ? `${abbr} reprinted on this device — its own printer was unreachable.`
                        : `${abbr} reprinted.`)
                } else {
                    toast.error(result.status === 'no-printer-selected'
                        ? `No ${abbr} printer set — open Printer Settings.`
                        : `${abbr} reprint failed (${result.status}).`)
                }
            }
        } finally {
            setReprintingId(null)
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
        if (!cancelOrderCode) { toast.error('Pick a reason first'); return }
        const timeStr = formatTime(order.placed_at)
        const itemsSummary = (order.order_items || []).map(i => `${i.quantity}x ${getItemDisplayName(i)}`).join(', ')
        const isComp = cancelOrderKind === 'comp'
        const ok = await confirm({
            title: isComp ? 'Comp this whole order?' : 'Cancel this particular order?',
            message: `This removes only the specific order placed at ${timeStr} (${itemsSummary}) from ${locationLabel(order, splitSessionIds)}'s bill, and logs its value as ${isComp ? 'a Complimentary & Staff Meals' : 'an Order Cancellation'} expense. Other orders on this bill are untouched. This cannot be undone.`,
            confirmText: isComp ? 'Comp Order' : 'Cancel Order',
            isDestructive: true,
        })
        if (!ok) return
        setBusyId(order.id)
        const res = await cancelOrder(order.id, cancelReason, cancelOrderKind, cancelOrderCode)
        setBusyId(null)
        if (res.error) { toast.error(res.error); return }
        setCancelReason('')
        setCancelOrderCode(null)
        setCancelOrderKind('void')
        setExpandedStatusId(null)
        if (onCancelOrder) {
            onCancelOrder(order.id)
        }
        toast.success(isComp ? 'Order comped' : 'Order cancelled')
    }

    function handleCancelOrderItem(orderId: string, itemId: string, label: string, maxQty: number, unitPrice: number) {
        setCancelQty(1)
        setCancelReasonInput('')
        setCancelItemKind('void')
        setCancelItemCode(null)
        setCancelItemModal({ orderId, itemId, label, maxQty, unitPrice })
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Sub-tabs — same pattern as the Takeaway/Delivery toggle: only one
                section shown at a time, full width. */}
            <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                <div className="grid grid-cols-2 gap-2 sm:gap-4 w-full">
                    {([
                        { key: 'confirmation', label: 'Order Confirmation', count: confirmationOrders.length, icon: ClipboardCheck },
                        { key: 'status', label: 'Order Status', count: groupedStatusCards.length, icon: ClipboardList },
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
                                                {formatTime(order.placed_at)} · {isTakeoutPending
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
                    {groupedStatusCards.length === 0 && (
                        <p className="col-span-full py-12 text-center text-xs text-ink-subtle font-semibold bg-surface rounded-2xl border border-hairline shadow-sm">No open orders right now.</p>
                    )}
                    {groupedStatusCards.map(card => {
                        const totalItems = card.orders.flatMap(o => o.order_items || []).filter(i => i.status !== 'cancelled').length
                        const isExpanded = expandedStatusId === card.key
                        const earliestTime = formatTime(card.placedAt)

                        return (
                            <div 
                                key={card.key} 
                                ref={el => { statusRowRefs.current[card.key] = el }}
                                className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden flex flex-col h-fit"
                            >
                                <button
                                    onClick={() => expandStatus(card.key)}
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-muted/50 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-ink truncate">{card.title}</p>
                                        <p className="text-[11px] text-ink-subtle capitalize">
                                            {card.orders.length} order{card.orders.length !== 1 ? 's' : ''} · {earliestTime} · {totalItems} item{totalItems !== 1 ? 's' : ''} · {money(card.totalAmount)}
                                        </p>
                                    </div>
                                    <ChevronDown size={15} className={`text-ink-subtle shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>
                                {isExpanded && (
                                    <StatusDetail
                                        orders={card.orders}
                                        money={money}
                                        busyId={busyId}
                                        cancelReason={cancelReason}
                                        onReasonChange={setCancelReason}
                                        cancelKind={cancelOrderKind}
                                        onKindChange={setCancelOrderKind}
                                        cancelCode={cancelOrderCode}
                                        onCodeChange={setCancelOrderCode}
                                        onMarkServed={(orderId, ids) => handleMarkServed(orderId, ids)}
                                        onCancelOrder={(order) => handleCancelOrder(order)}
                                        onCancelItem={(orderId, itemId, label, maxQty, unitPrice) => handleCancelOrderItem(orderId, itemId, label, maxQty, unitPrice)}
                                        kotEnabled={features.kotEnabled}
                                        kdsEnabled={features.kdsEnabled ?? true}
                                        reprintingId={reprintingId}
                                        onReprint={(orderId) => handleReprintTickets(orderId)}
                                    />
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {mounted && cancelItemModal && createPortal(
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface w-full max-w-sm rounded-[24px] shadow-2xl border border-hairline p-6 space-y-4 animate-in zoom-in-95 duration-150">
                        <div>
                            <h3 className="text-lg font-black text-ink">
                                {cancelItemKind === 'comp' ? 'Comp Item' : 'Cancel Item'}
                            </h3>
                            <p className="text-xs text-ink-subtle mt-0.5">
                                Select plates of <span className="font-bold text-ink">{cancelItemModal.label}</span> to
                                {cancelItemKind === 'comp' ? ' give free:' : ' cancel:'}
                            </p>
                        </div>

                        {/* Quantity Counter */}
                        <div className="flex items-center justify-center gap-6 py-1">
                            <button
                                type="button"
                                onClick={() => setCancelQty(prev => Math.max(1, prev - 1))}
                                disabled={cancelQty <= 1}
                                className="w-10 h-10 rounded-full border border-hairline flex items-center justify-center text-ink hover:bg-surface-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Minus size={16} />
                            </button>
                            <span className="text-3xl font-black text-ink tabular-nums w-12 text-center select-none">
                                {cancelQty}
                            </span>
                            <button
                                type="button"
                                onClick={() => setCancelQty(prev => Math.min(cancelItemModal.maxQty, prev + 1))}
                                disabled={cancelQty >= cancelItemModal.maxQty}
                                className="w-10 h-10 rounded-full border border-hairline flex items-center justify-center text-ink hover:bg-surface-muted transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Plus size={16} />
                            </button>
                        </div>

                        {/* Waste breakdown banner */}
                        <div className="border border-brand-200/60 dark:border-brand-900/30 bg-brand-100/10 dark:bg-brand-900/10 rounded-xl p-3.5 space-y-1 text-xs">
                            <span className="font-extrabold text-brand-600 dark:text-brand-400 block">This will remove:</span>
                            <div className="flex justify-between font-bold text-ink">
                                <span>{cancelQty}x {cancelItemModal.label}</span>
                                <span className="tabular-nums">{money(cancelItemModal.unitPrice * cancelQty)}</span>
                            </div>
                            <p className="text-[10px] text-ink-subtle leading-relaxed pt-1 border-t border-brand-200/30 dark:border-brand-900/20">
                                {cancelItemKind === 'comp'
                                    ? 'This is logged as a complimentary item, separate from wastage, and cannot be undone.'
                                    : 'This action is logged as stock waste and cannot be undone.'}
                            </p>
                        </div>

                        <ReasonPicker
                            context={cancelItemKind}
                            onKindChange={setCancelItemKind}
                            code={cancelItemCode}
                            onCodeChange={setCancelItemCode}
                            note={cancelReasonInput}
                            onNoteChange={setCancelReasonInput}
                            notePlaceholder="Add detail (optional)"
                        />

                        <div className="flex gap-2.5 pt-1">
                            <button
                                type="button"
                                onClick={() => setCancelItemModal(null)}
                                className="flex-1 px-4 py-2.5 border border-hairline rounded-xl text-xs font-bold hover:bg-surface-muted text-ink transition-all"
                            >
                                Keep Item
                            </button>
                            <button
                                type="button"
                                disabled={!cancelItemCode}
                                onClick={async () => {
                                    const { orderId, itemId, label } = cancelItemModal
                                    const kind = cancelItemKind
                                    setBusyId(orderId)
                                    setCancelItemModal(null)
                                    const res = await cancelOrderItem(orderId, itemId, cancelQty, cancelReasonInput, kind, cancelItemCode)
                                    setBusyId(null)
                                    if (res.error) { toast.error(res.error); return }
                                    setCancelReasonInput('')
                                    setCancelItemCode(null)
                                    if (onCancelOrderItem) {
                                        onCancelOrderItem(orderId, itemId, cancelQty)
                                    }
                                    toast.success(`${cancelQty}x ${label} ${kind === 'comp' ? 'comped' : 'cancelled'}`)
                                }}
                                className="flex-1 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-xs shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {cancelItemKind === 'comp' ? 'Comp' : 'Cancel'} {cancelQty} Plate{cancelQty !== 1 ? 's' : ''}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
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
                            <p className="text-xs font-bold text-ink truncate">{item.quantity}× {getItemDisplayName(item)}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                            {money((item.unit_price || 0) * item.quantity)}
                        </span>
                        <button
                            onClick={() => item.id && onDelete(item.id, getItemDisplayName(item))}
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
                            <p className="text-xs font-bold text-ink truncate">{item.quantity}× {getItemDisplayName(item)}</p>
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

/**
 * One order inside the status detail list.
 *
 * Extracted so useSelection is called from a component body. It used to run
 * inside orders.map(), which made the hook count follow the number of orders --
 * settle one, or let realtime deliver another, and React renders the same
 * component with a different number of hooks and throws. The tick boxes that
 * decide what gets marked served are the last place to want that.
 *
 * The empty-order guard now sits after the hook rather than before it, so the
 * hook still runs unconditionally on every render.
 */
function StatusDetailOrderRow({
    order,
    money,
    busyId,
    cancelKind,
    cancelCode,
    onMarkServed,
    onCancelOrder,
    onCancelItem,
    kotEnabled,
    kdsEnabled,
    reprintingId,
    onReprint,
}: {
    order: AnyOrder
    money: (n: number) => string
    busyId: string | null
    cancelKind: CancellationKind
    cancelCode: string | null
    onMarkServed: (orderId: string, itemIds: string[]) => void
    onCancelOrder: (order: AnyOrder) => void
    onCancelItem: (orderId: string, itemId: string, label: string, maxQty: number, unitPrice: number) => void
    kotEnabled?: boolean
    kdsEnabled?: boolean
    reprintingId: string | null
    onReprint: (orderId: string) => void
}) {
    const items = (order.order_items || []).filter(i => i.status !== 'cancelled')
    const readyIds = items.filter(i => i.status === 'ready' && i.id).map(i => i.id!)
    // Before the early return: a hook must not be skipped on any render.
    const { selected, allSelected, toggleAll, toggle } = useSelection(readyIds)
    if (items.length === 0) return null

    const isBusy = busyId === order.id
    const isReprinting = reprintingId === order.id
    const timeStr = formatTime(order.placed_at)

    return (
        <div className="py-3 first:pt-1.5 last:pb-1.5 space-y-2.5">
            {/* Subheader for the order */}
            <div className="flex items-center justify-between text-[11px] font-bold text-ink-subtle">
                <span>Placed at {timeStr} · {money(Number(order.total_amount) || 0)}</span>
                <div className="flex items-center gap-3">
                    {/* The way back from a print the printer called
                        successful but never put on paper. */}
                    {kotEnabled && (
                        <button
                            onClick={() => onReprint(order.id)}
                            disabled={isReprinting}
                            className="text-ink-subtle hover:text-ink font-extrabold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                            title="Print this order's kitchen/bar ticket again"
                        >
                            {isReprinting
                                ? <Loader2 size={12} className="animate-spin" />
                                : <Printer size={12} />}
                            Reprint
                        </button>
                    )}
                    <button
                        onClick={() => onCancelOrder(order)}
                        disabled={isBusy || !cancelCode}
                        title={!cancelCode ? 'Pick a reason below first' : undefined}
                        className="text-red-500 hover:text-red-700 font-extrabold transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <XCircle size={12} />
                        {cancelKind === 'comp' ? 'Comp Order' : 'Cancel Order'}
                    </button>
                </div>
            </div>

            {/* Items checkboxes/serving logic. Serving from the till
                needs a KDS to have moved items to `ready`; whether
                tickets also print is a separate question. */}
            {kdsEnabled && readyIds.length > 0 && (
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
                    const canServe = kdsEnabled && item.status === 'ready' && item.id
                    return (
                        <div key={item.id} className="flex items-center gap-2.5 bg-surface rounded-xl border border-hairline px-3 py-2">
                            {canServe ? (
                                <button onClick={() => item.id && toggle(item.id)} className="shrink-0 text-brand-500">
                                    {item.id && selected.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-ink-subtle" />}
                                </button>
                            ) : null}
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-ink truncate">{item.quantity}× {getItemDisplayName(item)}</p>
                                {kdsEnabled && <p className="text-[10px] text-ink-subtle capitalize">{item.status}</p>}
                            </div>
                            <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                                {money((item.unit_price || 0) * item.quantity)}
                            </span>
                            {item.id && onCancelItem && (
                                <button
                                    onClick={() => item.id && onCancelItem(order.id, item.id, getItemDisplayName(item), item.quantity, Number(item.unit_price) || 0)}
                                    disabled={isBusy}
                                    className="shrink-0 p-1 rounded-lg text-ink-subtle hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                >
                                    <Trash2 size={13} />
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>

            {kdsEnabled && readyIds.length > 0 && (
                <button
                    onClick={() => onMarkServed(order.id, Array.from(selected))}
                    disabled={isBusy || selected.size === 0}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Mark Served ({selected.size})
                </button>
            )}
        </div>
    )
}

function StatusDetail({
    orders,
    money,
    busyId,
    cancelReason,
    onReasonChange,
    cancelKind,
    onKindChange,
    cancelCode,
    onCodeChange,
    onMarkServed,
    onCancelOrder,
    onCancelItem,
    kotEnabled,
    kdsEnabled,
    reprintingId,
    onReprint,
}: {
    orders: AnyOrder[]
    money: (n: number) => string
    busyId: string | null
    cancelReason: string
    onReasonChange: (v: string) => void
    cancelKind: CancellationKind
    onKindChange: (k: CancellationKind) => void
    cancelCode: string | null
    onCodeChange: (c: string | null) => void
    onMarkServed: (orderId: string, itemIds: string[]) => void
    onCancelOrder: (order: AnyOrder) => void
    onCancelItem: (orderId: string, itemId: string, label: string, maxQty: number, unitPrice: number) => void
    /** Tickets print — gates the reprint affordance only. */
    kotEnabled?: boolean
    /** A KDS advances items to `ready` — gates the serve-from-the-till flow. */
    kdsEnabled?: boolean
    reprintingId: string | null
    onReprint: (orderId: string) => void
}) {
    return (
        <div className="px-4 pb-4 pt-1 bg-surface-muted/30 divide-y divide-hairline divide-dashed">
            {orders.map((order) => (
                <StatusDetailOrderRow
                    key={order.id}
                    order={order}
                    money={money}
                    busyId={busyId}
                    cancelKind={cancelKind}
                    cancelCode={cancelCode}
                    onMarkServed={onMarkServed}
                    onCancelOrder={onCancelOrder}
                    onCancelItem={onCancelItem}
                    kotEnabled={kotEnabled}
                    kdsEnabled={kdsEnabled}
                    reprintingId={reprintingId}
                    onReprint={onReprint}
                />
            ))}

            {/* Reason footer, shared by every Cancel Order button above — picked
                before pressing one, since the action itself is irreversible. */}
            <div className="pt-3">
                <ReasonPicker
                    context={cancelKind}
                    onKindChange={onKindChange}
                    code={cancelCode}
                    onCodeChange={onCodeChange}
                    note={cancelReason}
                    onNoteChange={onReasonChange}
                    notePlaceholder="Add detail (optional)"
                />
            </div>
        </div>
    )
}
