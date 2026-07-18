'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { playNewOrder } from '@/lib/audio'
import { toast } from 'react-hot-toast'
import { timeAgo, getKOTSourceLabel, getItemKOTDisplay } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Bell, Hourglass, Flame, ChefHat, ChevronDown, CheckSquare, Square, Check, Clock, Printer } from 'lucide-react'
import type { OrderStatus, OrderItemStatus, Order, OrderItem, OrderItemModifier, MenuItem, Session, Table, Booking } from '@/types/database'
import { setOrderItemsStatus, getKitchenOrders } from '@/app/(staff)/kitchen/actions'
import { rollUpOrderStatus } from '@/lib/orderRollup'
import EmptyState from '@/components/ui/EmptyState'
import { usePrinter } from '@/lib/print/usePrinter'
import { ensureConnected } from '@/lib/print/qzClient'
import { buildStationTicket } from '@/lib/print/templates/stationTicket'
import { STATION_META, itemsForStation, type StationKind } from '@/lib/stations'
import KotPrintFallback from './KotPrintFallback'

// A network (LAN) KOT printer lives in the kitchen, so the browser-print
// fallback would come out of THIS desktop (typically the counter) — the wrong
// station. Before falling back, retry a transient network failure (QZ Tray
// restarting, printer momentarily unreachable) a few times.
const KOT_PRINT_MAX_RETRIES = 2
const KOT_PRINT_RETRY_MS = 2500
// How often the headless print screen re-checks the QZ Tray connection.
const QZ_HEALTH_POLL_MS = 15000

export type KitchenOrderItem = OrderItem & {
    menu_item_id?: string
    menu_items?: Partial<MenuItem>
    menu_item_variations?: { name: string } | null
    order_item_modifiers?: Partial<OrderItemModifier>[]
}

export type KitchenOrder = Order & {
    sessions?: (Session & {
        tables?: (Table & {
            rooms?: { id: string; room_number: string } | null
            sessions?: { id: string; seat_number: number; status: string }[] | null
        }) | null
    }) | null
    bookings?: {
        id: string
        rooms?: { id: string; room_number: string } | null
    } | null
    order_items?: KitchenOrderItem[]
    order_type?: 'dine_in' | 'takeout' | 'delivery'
}

export type ComboItemRow = {
    id: string
    combo_id: string
    item_id?: string
    quantity: number
    menu_items?: { name?: string | null } | null
}

// A pending dish auto-moves from New Orders to Queue after this long, derived
// from placed_at on a ticking clock (no extra status, no background job).
const QUEUE_AFTER_MS = 2 * 60 * 1000

const ORDER_SELECT = `
  id, status, order_type, total_amount, placed_at, customer_note, booking_id,
  bookings:booking_id (
    id,
    rooms:room_id ( id, room_number )
  ),
  sessions (
    id,
    seat_number,
    booking_id,
    tables:table_id (
      id,
      label,
      room_id,
      rooms:room_id ( id, room_number ),
      sessions ( id, seat_number, status )
    )
  ),
  order_items (
    id, menu_item_id, quantity, unit_price, special_request, status, station, claimed_by, claimed_at,
    menu_items ( id, name, is_combo ),
    menu_item_variations:menu_item_variation_id ( id, name ),
    order_item_modifiers ( modifier_name, price_adjustment )
  )
` as const

type Section = { order: KitchenOrder; items: KitchenOrderItem[] }
type TabKey = 'new' | 'queue' | 'cooking'

const TAB_META: Record<TabKey, { label: string; icon: typeof Bell; accent: string; soft: string; border: string }> = {
    new:     { label: 'New Orders', icon: Bell,      accent: '#f59e0b', soft: '#FEF3C7', border: '#FCD34D' },
    queue:   { label: 'Queue',      icon: Hourglass, accent: '#FB6303', soft: '#FFEAD9', border: '#FDBA8C' },
    cooking: { label: 'Cooking',    icon: Flame,     accent: '#ef4444', soft: '#FEE2E2', border: '#FCA5A5' },
}

export default function OrderQueue({ initialOrders, restaurantId, comboItems = [], userId, staffNames = {}, station = 'kitchen' }: {
    initialOrders: KitchenOrder[]
    restaurantId: string
    comboItems?: ComboItemRow[]
    userId: string
    staffNames?: Record<string, string>
    /** Which station this board serves. Kitchen sees food lines, bar sees drinks. */
    station?: StationKind
}) {
    const stationMeta = STATION_META[station]
    // Project an order down to just this station's lines. Orders with none of
    // our lines (e.g. an all-food order on the bar board) drop out entirely, so
    // the kitchen never sees a drink and the bar never sees a burger.
    const projectStation = useCallback((list: KitchenOrder[]): KitchenOrder[] =>
        list.reduce<KitchenOrder[]>((acc, o) => {
            const mine = itemsForStation(o.order_items, station)
            if (mine.length) acc.push({ ...o, order_items: mine })
            return acc
        }, []), [station])

    const [orders, setOrders] = useState<KitchenOrder[]>(() => projectStation(initialOrders))
    const [now, setNow] = useState(() => Date.now())
    const [activeTab, setActiveTab] = useState<TabKey>('new')
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const [printOnlyMode, setPrintOnlyMode] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem(`print_only_${station}`) === 'true'
        }
        return false
    })
    const money = useCurrency()
    const supabaseRef = useRef(createClient())
    const { print: printKot, networkPrinter } = usePrinter(stationMeta.printerRole)
    // Queued, not a single slot — QZ Tray being down for the whole shift means
    // every order fails to print at once, and a single slot would silently
    // drop all but the most recent order's fallback ticket.
    const [kotFallbackQueue, setKotFallbackQueue] = useState<KitchenOrder[]>([])
    const dequeueKotFallback = useCallback(() => setKotFallbackQueue(q => q.slice(1)), [])

    // Pending retry timers, cleared on unmount so a queued retry can't fire
    // (and setState) after the screen is gone.
    const retryTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
    useEffect(() => () => { retryTimers.current.forEach(clearTimeout); retryTimers.current.clear() }, [])

    // Live QZ Tray connection status for the headless print screen. A dead agent
    // is the #1 silent cause of "orders aren't printing" — surfacing it stops
    // tickets from quietly diverting to the browser fallback unnoticed. Only
    // polls while in print-only mode.
    const [qzConnected, setQzConnected] = useState<boolean | null>(null)
    useEffect(() => {
        if (!printOnlyMode) return
        let cancelled = false
        const check = () => { void ensureConnected().then((r) => { if (!cancelled) setQzConnected(r.ok) }) }
        check()
        const id = setInterval(check, QZ_HEALTH_POLL_MS)
        return () => { cancelled = true; clearInterval(id) }
    }, [printOnlyMode])

    // Latest committed board, readable synchronously from realtime callbacks. A
    // setState updater's local flag is NOT reliably set by the time you read it
    // right after the call, so the old `isNew`/`stillPresent`/`added` gates often
    // read false and skipped the auto-print entirely — the order still landed on
    // the board (the updater ran later) but the ticket never printed.
    const ordersRef = useRef<KitchenOrder[]>(orders)
    useEffect(() => { ordersRef.current = orders }, [orders])

    // Orders already sent to the printer — dedupes the ticket across the INSERT
    // event, any confirming UPDATE, and reconnect resyncs, so each KOT prints
    // exactly once. Seeded with the initial board so existing tickets never
    // reprint when the kitchen screen loads.
    const printedRef = useRef<Set<string>>(new Set((initialOrders || []).map(o => o.id)))

    // Auto-print the KOT. Falls back to a browser print if QZ Tray isn't
    // connected/trusted on this kitchen screen yet. Called as a plain
    // function (never from inside a setState updater — React 18 StrictMode
    // double-invokes those in dev, which would double-print every ticket).
    const printKotWithFallback = useCallback((order: KitchenOrder) => {
        // `order` is already projected to this station's lines, so an all-food
        // order reaching the bar board has an empty item list — nothing to print.
        if (!(order.order_items || []).length) return
        // Hoisted function declaration so it can recurse for retries without a
        // use-before-declared reference to the surrounding useCallback.
        function attemptPrint(attempt: number) {
            void printKot(buildStationTicket(order, station)).then((result) => {
                if (result.ok) return
                // Retry transient failures on a LAN printer before falling back to
                // the local browser print (which prints at this desktop, not the
                // kitchen). Don't retry no-printer-selected or a trust block —
                // those need a human, not another attempt.
                const transient = result.status === 'not-running' || result.status === 'print-failed'
                if (networkPrinter && transient && attempt < KOT_PRINT_MAX_RETRIES) {
                    const t = setTimeout(() => {
                        retryTimers.current.delete(t)
                        attemptPrint(attempt + 1)
                    }, KOT_PRINT_RETRY_MS)
                    retryTimers.current.add(t)
                    return
                }
                setKotFallbackQueue(q => [...q, order])
                toast.error(
                    result.status === 'no-printer-selected'
                        ? `No ${stationMeta.ticketAbbr} printer set — printed via browser instead. Set one in Printer Settings.`
                        : networkPrinter
                            ? `${stationMeta.ticketAbbr} printer unreachable after ${KOT_PRINT_MAX_RETRIES + 1} tries — printed on this device instead.`
                            : `${stationMeta.ticketAbbr} printer not connected — printed via browser instead.`
                )
            })
        }
        attemptPrint(0)
    }, [printKot, station, stationMeta.ticketAbbr, networkPrinter])

    // Print a KOT exactly once per order id, regardless of whether the INSERT
    // event or a later confirming UPDATE surfaced it first.
    const maybePrintKot = useCallback((order: KitchenOrder) => {
        if (printedRef.current.has(order.id)) return
        printedRef.current.add(order.id)
        printKotWithFallback(order)
    }, [printKotWithFallback])

    // Resync: fetch fresh orders from DB on mount and whenever the realtime
    // channel reconnects. This recovers any orders missed during a disconnect
    // (e.g. logout → login, network blip, token refresh).
    const resync = useCallback(async () => {
        const fresh = await getKitchenOrders(restaurantId)
        setOrders(projectStation(fresh as unknown as KitchenOrder[]))
    }, [restaurantId, projectStation])

    useEffect(() => {
        resync() // always refresh on mount
    }, [resync])

    useEffect(() => {
        const i = setInterval(() => setNow(Date.now()), 10_000)
        return () => clearInterval(i)
    }, [])

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        const orderType = (payload.new as { order_type?: string } | null)?.order_type
        const isTakeoutDelivery = orderType === 'takeout' || orderType === 'delivery'
        const needsConfirmation = (payload.new as { needs_confirmation?: boolean } | null)?.needs_confirmation === true
        
        if (payload.eventType === 'INSERT') {
            // Skip unconfirmed or takeout/delivery pending orders.
            if (needsConfirmation || (isTakeoutDelivery && payload.new.status === 'pending')) return
            const { data } = await supabaseRef.current.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const [order] = projectStation([data as unknown as KitchenOrder])
            // No lines for this station (e.g. an all-food order on the bar board).
            if (!order) return
            setOrders(prev => prev.some(o => o.id === order.id) ? prev : [...prev, order])
            // Delay sound + toast + print 400ms to avoid false alarms: if
            // needs_confirmation=true arrives on a follow-up UPDATE the order is
            // removed before the 400ms fires. Presence is read from ordersRef (the
            // committed board) rather than a setState-updater flag, so the print
            // actually fires; maybePrintKot dedupes it to exactly one ticket.
            setTimeout(() => {
                if (!ordersRef.current.some(o => o.id === order.id)) return // removed — false alarm
                playNewOrder().catch(() => {})
                const sourceLabel = getKOTSourceLabel(order)
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-surface shadow-xl rounded-2xl px-4 py-3 flex items-start gap-3 border-2 border-amber-300`}>
                        <span className="text-xl mt-0.5">🔔</span>
                        <div>
                            <p className="font-bold text-sm text-amber-700">New Order!</p>
                            <p className="text-xs text-ink-subtle mt-0.5">{sourceLabel} · {money(order.total_amount)}</p>
                        </div>
                    </div>
                ), { duration: 6000, position: 'top-right' })
                maybePrintKot(order)
            }, 400)
        } else if (payload.eventType === 'UPDATE') {
            const newStatus = payload.new.status as string
            const isTakeoutDeliveryPending = isTakeoutDelivery && newStatus === 'pending'
            
            if (newStatus === 'delivered' || newStatus === 'cancelled' || needsConfirmation || isTakeoutDeliveryPending) {
                setOrders(prev => prev.filter(o => o.id !== payload.new.id))
                return
            }
            const { data } = await supabaseRef.current.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const [fresh] = projectStation([data as unknown as KitchenOrder])
            if (!fresh) {
                // Order lost its lines for this station — drop it from the board.
                setOrders(prev => prev.filter(o => o.id !== payload.new.id))
                return
            }
            // Whether this order was already on the board (read from the committed
            // board via ref, not a setState-updater flag — the old `added` flag was
            // read before the updater ran, so the print here silently never fired).
            const wasPresent = ordersRef.current.some(o => o.id === fresh.id)
            setOrders(prev => prev.some(o => o.id === fresh.id) ? prev.map(o => o.id === fresh.id ? fresh : o) : [...prev, fresh])
            if (!wasPresent) {
                playNewOrder().catch(() => {})
                const sourceLabel = getKOTSourceLabel(fresh)
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-surface shadow-xl rounded-2xl px-4 py-3 flex items-start gap-3 border-2 border-amber-300`}>
                        <span className="text-xl mt-0.5">🔔</span>
                        <div>
                            <p className="font-bold text-sm text-amber-700">New Order!</p>
                            <p className="text-xs text-ink-subtle mt-0.5">{sourceLabel} · {money(fresh.total_amount)}</p>
                        </div>
                    </div>
                ), { duration: 6000, position: 'top-right' })
                // Covers orders that only become kitchen-visible via an UPDATE
                // (e.g. leaving needs_confirmation). maybePrintKot dedupes against
                // the INSERT path so a single order never prints twice.
                maybePrintKot(fresh)
            }
        }
    }, resync)

    const applyItemStatus = async (orderId: string, itemIds: string[], nextStatus: OrderItemStatus) => {
        if (itemIds.length === 0) return
        const snapshot = orders
        const nowIso = new Date().toISOString()
        setOrders(cur => cur.map(o => {
            if (o.id !== orderId) return o
            const items = (o.order_items || []).map(it =>
                itemIds.includes(it.id)
                    ? { ...it, status: nextStatus, ...(nextStatus === 'preparing' ? { claimed_by: userId, claimed_at: nowIso } : {}) }
                    : it)
            const rolled = rollUpOrderStatus(items.map(i => i.status as OrderItemStatus))
            return { ...o, order_items: items, status: (rolled ?? o.status) as OrderStatus }
        }))
        const res = await setOrderItemsStatus(orderId, itemIds, nextStatus, userId)
        if (res?.error) {
            setOrders(snapshot)
            toast.error(res.conflict
                ? (nextStatus === 'ready' ? 'Only the chef who started a dish can mark it ready' : 'Those items were just updated by someone else')
                : 'Could not update items')
        }
    }

    // Bucket each order's dishes by their own state. Ready dishes leave the kitchen
    // (they go to the waiter) — there is no Pass column here.
    const { newO, queueO, cookO } = useMemo(() => {
        const sorted = [...orders].sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime())
        const newO: Section[] = [], queueO: Section[] = [], cookO: Section[] = []
        for (const o of sorted) {
            const its = o.order_items || []
            const pending = its.filter(i => i.status === 'pending')
            // Only show THIS chef's preparing items in the Cooking column.
            // Other chefs' claimed dishes must be invisible to this staff member —
            // they appear in those chefs' own Cooking tabs.
            const myPreparing = its.filter(
                i => i.status === 'preparing' && (!i.claimed_by || i.claimed_by === userId)
            )
            if (pending.length) {
                const aged = now - new Date(o.placed_at).getTime() >= QUEUE_AFTER_MS
                ;(aged ? queueO : newO).push({ order: o, items: pending })
            }
            if (myPreparing.length) cookO.push({ order: o, items: myPreparing })
        }
        return { newO, queueO, cookO }
    }, [orders, now])

    const sections: Record<TabKey, Section[]> = { new: newO, queue: queueO, cooking: cookO }
    const active = sections[activeTab]

    const toggleCollapse = (id: string) =>
        setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

    const emptyTitle = (key: TabKey) =>
        key === 'new' ? 'No new orders right now' : key === 'queue' ? 'Queue is clear' : 'Nothing cooking'

    const renderTicket = (section: Section, key: TabKey) => (
        <OrderTicket
            key={section.order.id}
            tab={key}
            order={section.order}
            items={section.items}
            comboItems={comboItems}
            money={money}
            now={now}
            userId={userId}
            staffNames={staffNames}
            stationAccent={stationMeta.accent}
            collapsed={collapsed.has(section.order.id)}
            onToggle={() => toggleCollapse(section.order.id)}
            onApply={applyItemStatus}
        />
    )

    return (
        <div className="h-full flex flex-col bg-[#FBF7F3]">
            <KotPrintFallback order={kotFallbackQueue[0] ?? null} station={station} onDone={dequeueKotFallback} />

            {/* Top Bar with Print-Only Mode Switch */}
            <div className="shrink-0 bg-surface border-b border-hairline px-4 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <h1 className="font-black text-sm uppercase tracking-wider text-ink">
                        {stationMeta.ticketAbbr} Control Board
                    </h1>
                </div>
                
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={printOnlyMode}
                            onChange={(e) => {
                                const val = e.target.checked
                                setPrintOnlyMode(val)
                                localStorage.setItem(`print_only_${station}`, String(val))
                            }}
                            className="w-4 h-4 rounded text-brand-500 border-hairline focus:ring-brand-500 accent-[#FB6303]"
                        />
                        <span className="text-xs font-black uppercase tracking-wider text-ink-muted">
                            KOT Print-Only Mode
                        </span>
                    </label>
                </div>
            </div>

            {printOnlyMode ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface m-6 rounded-3xl border border-hairline shadow-sm max-w-2xl mx-auto my-auto h-[400px]">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${qzConnected === false ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500 animate-pulse'}`}>
                        <Printer size={32} />
                    </div>
                    <h3 className="text-lg font-black text-ink">KOT Auto-Print Service Active</h3>
                    <p className="text-sm text-ink-subtle mt-2 max-w-sm">
                        This tab is running in headless printer mode. Incoming orders will print automatically. Order cards are hidden to maximize browser performance.
                    </p>

                    {/* Live health — a dead QZ Tray silently diverts every ticket to
                        the browser fallback, so make its status impossible to miss. */}
                    <div className="mt-5 flex flex-col items-center gap-2">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${
                            qzConnected === false ? 'text-red-600 bg-red-50 border-red-200'
                            : qzConnected ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                            : 'text-ink-subtle bg-surface-muted border-hairline'
                        }`}>
                            <span className={`w-2 h-2 rounded-full ${qzConnected === false ? 'bg-red-500' : qzConnected ? 'bg-emerald-500' : 'bg-ink-subtle'}`} />
                            {qzConnected === false ? 'QZ Tray not running — tickets will print on THIS device'
                                : qzConnected ? 'QZ Tray connected' : 'Checking QZ Tray…'}
                        </span>
                        {networkPrinter ? (
                            <span className="text-[11px] text-ink-subtle">
                                Sending {stationMeta.ticketAbbr} to {networkPrinter.target.host}:{networkPrinter.target.port}
                            </span>
                        ) : (
                            <span className="text-[11px] text-amber-600">
                                No network printer configured — using this device’s local printer
                            </span>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* Mobile: tab bar */}
                    <div className="lg:hidden shrink-0 bg-surface border-b border-hairline px-2 sm:px-4">
                        <div className="max-w-2xl mx-auto grid grid-cols-3">
                            {(Object.keys(TAB_META) as TabKey[]).map(key => {
                                const meta = TAB_META[key]
                                const Icon = meta.icon
                                const isActive = activeTab === key
                                const count = sections[key].length
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setActiveTab(key)}
                                        className="relative py-3 flex flex-col items-center gap-1 transition-colors"
                                        style={{ color: isActive ? meta.accent : '#9ca3af' }}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <Icon size={16} />
                                            {count > 0 && (
                                                <span className="text-[11px] font-extrabold min-w-4.5 h-4.5 px-1 rounded-full inline-flex items-center justify-center text-white"
                                                      style={{ background: isActive ? meta.accent : '#cbd5e1' }}>
                                                    {count}
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-xs font-bold">{meta.label}</span>
                                        {isActive && <span className="absolute bottom-0 left-3 right-3 h-0.75 rounded-t-full" style={{ background: meta.accent }} />}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Mobile: active section list */}
                    <div className="lg:hidden flex-1 overflow-y-auto px-3 sm:px-4 py-4">
                        <div className="max-w-2xl mx-auto space-y-3">
                            {active.map(section => renderTicket(section, activeTab))}
                            {active.length === 0 && (
                                <div className="pt-16">
                                    <EmptyState icon={TAB_META[activeTab].icon} title={emptyTitle(activeTab)} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Desktop: three columns side by side */}
                    <div className="hidden lg:flex flex-1 overflow-hidden gap-4 p-5">
                        {(Object.keys(TAB_META) as TabKey[]).map(key => {
                            const meta = TAB_META[key]
                            const Icon = meta.icon
                            const list = sections[key]
                            return (
                                <VirtualColumn
                                    key={key}
                                    tabKey={key}
                                    meta={meta}
                                    list={list}
                                    renderTicket={(section) => renderTicket(section, key)}
                                    emptyTitle={emptyTitle(key)}
                                />
                            )
                        })}
                    </div>
                </>
            )}
        </div>
        )
    }
    
    function VirtualColumn({ tabKey, meta, list, renderTicket, emptyTitle }: { tabKey: TabKey, meta: any, list: Section[], renderTicket: (s: Section) => React.ReactNode, emptyTitle: string }) {
        const Icon = meta.icon
        const parentRef = useRef<HTMLDivElement>(null)
        const virtualizer = useVirtualizer({
            count: list.length,
            getScrollElement: () => parentRef.current,
            estimateSize: () => 200,
            overscan: 3,
        })
    
        return (
            <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-2 pb-3 mb-1 border-b-2" style={{ borderColor: meta.border }}>
                    <Icon size={16} style={{ color: meta.accent }} />
                    <h3 className="font-bold text-ink text-sm">{meta.label}</h3>
                    {list.length > 0 && (
                        <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: meta.accent }}>
                            {list.length}
                        </span>
                    )}
                </div>
                <div ref={parentRef} className="flex-1 overflow-y-auto pr-1 pt-2" style={{ scrollbarWidth: 'thin' }}>
                    {list.length === 0 ? (
                        <div className="pt-16">
                            <EmptyState icon={Icon} title={emptyTitle} />
                        </div>
                    ) : (
                        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                            {virtualizer.getVirtualItems().map((vRow) => (
                                <div
                                    key={list[vRow.index].order.id}
                                    data-index={vRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${vRow.start}px)`,
                                        paddingBottom: '12px'
                                    }}
                                >
                                    {renderTicket(list[vRow.index])}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        )
    }
function itemStatusPill(status: string) {
    if (status === 'preparing') return { label: 'Cooking…', cls: 'text-brand-500' }
    if (status === 'ready')     return { label: 'Ready', cls: 'text-emerald-600' }
    return { label: 'Pending', cls: 'text-ink-subtle' }
}

function OrderTicket({ tab, order, items, comboItems, money, now, userId, staffNames, stationAccent, collapsed, onToggle, onApply }: {
    tab: TabKey
    order: KitchenOrder
    items: KitchenOrderItem[]
    comboItems: ComboItemRow[]
    money: (v: number) => string
    now: number
    userId: string
    staffNames: Record<string, string>
    stationAccent: string
    collapsed: boolean
    onToggle: () => void
    onApply: (orderId: string, itemIds: string[], next: OrderItemStatus) => Promise<void>
}) {
    const meta = TAB_META[tab]
    const isCooking = tab === 'cooking'
    
    const space = getKOTSourceLabel(order)

    // Selection: New/Queue → all dishes; Cooking → only dishes this chef owns.
    const ownItem = (it: KitchenOrderItem) => !it.claimed_by || it.claimed_by === userId
    const selectable = useMemo(
        () => isCooking ? items.filter(it => !it.claimed_by || it.claimed_by === userId) : items,
        [items, isCooking, userId]
    )
    const selectableIds = useMemo(() => selectable.map(i => i.id), [selectable])

    const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds))
    const prevRef = useRef<string[]>(selectableIds)
    useEffect(() => {
        const prev = prevRef.current
        setSelected(p => {
            const n = new Set<string>()
            for (const id of selectableIds) if (!prev.includes(id) || p.has(id)) n.add(id)
            return n
        })
        prevRef.current = selectableIds
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectableIds.join(',')])

    const [busy, setBusy] = useState(false)
    const selIds = selectable.filter(i => selected.has(i.id)).map(i => i.id)
    const allSel = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
    const toggleAll = () => setSelected(allSel ? new Set() : new Set(selectableIds))
    const toggle = (id: string) => setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

    const run = async (next: OrderItemStatus) => {
        if (selIds.length === 0 || busy) return
        setBusy(true)
        await onApply(order.id, selIds, next)
        setBusy(false)
    }

    // Chef ownership label for the cooking card.
    const owners = Array.from(new Set(items.map(i => i.claimed_by).filter(Boolean))) as string[]
    const chefLabel = isCooking && owners.length === 1
        ? `Chef ${owners[0] === userId ? 'You' : (staffNames[owners[0]] || '')} cooking`.replace(/\s+/g, ' ').trim()
        : isCooking && owners.length > 1 ? 'Multiple chefs' : null

    const waitedMin = Math.floor((now - new Date(order.placed_at).getTime()) / 60000)

    return (
        <div className="bg-surface rounded-2xl shadow-sm overflow-hidden" style={{ borderLeft: `4px solid ${meta.accent}` }}>
            {/* Header */}
            <button onClick={onToggle} className="w-full text-left px-4 pt-3.5 pb-3">
                <div className="flex items-center gap-2 flex-wrap pr-6 relative">
                    <span className="font-extrabold text-ink">#{order.id.slice(0, 4).toUpperCase()}</span>
                    <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full" style={{ background: stationAccent }}>{space}</span>
                    <span className="text-[11px] font-semibold text-ink-subtle bg-surface-muted px-2 py-0.5 rounded-full">{items.length} dish{items.length > 1 ? 'es' : ''}</span>
                    {chefLabel && (
                        <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <ChefHat size={11} /> {chefLabel}
                        </span>
                    )}
                    <ChevronDown size={18} className={`absolute right-0 top-0.5 text-gray-300 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ink-subtle font-medium">
                    <Clock size={11} />
                    {tab === 'queue' ? `waiting ${waitedMin}m` : timeAgo(order.placed_at)}
                    {!isCooking && selIds.length > 0 && <span className="ml-1" style={{ color: meta.accent }}>· {selIds.length} selected</span>}
                </div>
            </button>

            {!collapsed && (
                <div className="px-4 pb-4">
                    {/* Select-all + action (New/Queue) */}
                    {!isCooking && items.length > 0 && (
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-hairline">
                            {items.length > 1 ? (
                                <button onClick={toggleAll} className="flex items-center gap-2 text-xs font-bold text-ink-subtle">
                                    {allSel ? <CheckSquare size={16} style={{ color: meta.accent }} /> : <Square size={16} className="text-gray-300" />}
                                    Select All Dishes
                                </button>
                            ) : (
                                <div />
                            )}
                            <CookButton accent={meta.accent} count={selIds.length} busy={busy} disabled={selIds.length === 0} onClick={() => run('preparing')} />
                        </div>
                    )}

                    {/* Items */}
                    <div className="space-y-1">
                        {items.map(item => {
                            const mine = ownItem(item)
                            const canSelect = isCooking ? mine : true
                            const isSel = selected.has(item.id)
                            const pill = itemStatusPill(item.status)
                            const lineTotal = Number(item.unit_price ?? 0) * item.quantity
                            return (
                                <div
                                    key={item.id}
                                    onClick={canSelect ? () => toggle(item.id) : undefined}
                                    className={`flex items-center gap-3 py-2 rounded-lg px-1 ${canSelect ? 'cursor-pointer' : 'opacity-70'} ${isSel ? 'bg-brand-50/60' : ''}`}
                                >
                                    {canSelect ? (
                                        isSel ? <CheckSquare size={18} style={{ color: meta.accent }} className="shrink-0" /> : <Square size={18} className="text-gray-300 shrink-0" />
                                    ) : (
                                        <span className="w-[18px] h-[18px] rounded border border-hairline-strong shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        {(() => {
                                            const { name, note } = getItemKOTDisplay(item, order.order_type)
                                            return (
                                                <>
                                                    <p className="font-semibold text-ink text-sm leading-tight truncate">{name}</p>
                                                    <p className="text-[11px] text-ink-subtle">×{item.quantity}{lineTotal > 0 ? ` · ${money(lineTotal)}` : ''}{note ? ` · ${note}` : ''}</p>
                                                </>
                                            )
                                        })()}
                                        {item.menu_items?.is_combo && (
                                            <div className="mt-0.5 pl-2 border-l-2 border-hairline text-[10px] text-ink-subtle space-y-0.5">
                                                {comboItems.filter(c => c.combo_id === item.menu_item_id).map(c => (
                                                    <div key={c.id}>• {c.quantity * item.quantity}× {c.menu_items?.name || 'Item'}</div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <span className={`text-[11px] font-semibold italic shrink-0 ${pill.cls}`}>{pill.label}</span>
                                </div>
                            )
                        })}
                    </div>

                    {order.customer_note && (
                        <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                            <span className="font-bold uppercase tracking-wide text-[9px] text-amber-500 block">Note</span>
                            {order.customer_note}
                        </div>
                    )}

                    {/* Mark Ready (Cooking, owner) */}
                    {isCooking && (
                        selectable.length > 0 ? (
                            <button
                                onClick={() => run('ready')}
                                disabled={selIds.length === 0 || busy}
                                className="mt-3 w-full py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-40 transition active:scale-[0.99]"
                                style={{ background: '#10b981' }}
                            >
                                <Check size={16} /> Mark Ready{selIds.length ? ` (${selIds.length})` : ''}
                            </button>
                        ) : (
                            <p className="mt-3 text-center text-xs text-ink-subtle">Another chef is on these dishes</p>
                        )
                    )}
                </div>
            )}
        </div>
    )
}

function CookButton({ accent, count, busy, disabled, onClick }: {
    accent: string; count: number; busy: boolean; disabled: boolean; onClick: () => void
}) {
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onClick() }}
            disabled={disabled || busy}
            className="flex items-center gap-1.5 text-white text-xs font-bold px-3.5 py-2 rounded-full disabled:opacity-40 transition active:scale-95"
            style={{ background: accent }}
        >
            <Bell size={14} /> Cook{count ? ` ${count}` : ''}
        </button>
    )
}
