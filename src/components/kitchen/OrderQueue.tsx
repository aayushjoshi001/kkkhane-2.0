'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { playNewOrder } from '@/lib/audio'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Bell, Hourglass, Flame, ChefHat, ChevronDown, CheckSquare, Square, Check, Clock } from 'lucide-react'
import type { OrderStatus, OrderItemStatus, Order, OrderItem, OrderItemModifier, MenuItem, Session, Table } from '@/types/database'
import { setOrderItemsStatus, getKitchenOrders } from '@/app/(staff)/kitchen/actions'
import { rollUpOrderStatus } from '@/lib/orderRollup'
import { EmptyState } from '@/components/ui'

export type KitchenOrderItem = OrderItem & {
    menu_item_id?: string
    menu_items?: Partial<MenuItem>
    order_item_modifiers?: Partial<OrderItemModifier>[]
}

export type KitchenOrder = Order & {
    sessions?: Session & { tables?: Partial<Table> }
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
  id, status, order_type, total_amount, placed_at, customer_note,
  sessions ( tables ( label ) ),
  order_items (
    id, menu_item_id, quantity, unit_price, special_request, status, claimed_by, claimed_at,
    menu_items ( id, name, is_combo ),
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

export default function OrderQueue({ initialOrders, restaurantId, comboItems = [], userId, staffNames = {} }: {
    initialOrders: KitchenOrder[]
    restaurantId: string
    comboItems?: ComboItemRow[]
    userId: string
    staffNames?: Record<string, string>
}) {
    const [orders, setOrders] = useState<KitchenOrder[]>(initialOrders)
    const [now, setNow] = useState(() => Date.now())
    const [activeTab, setActiveTab] = useState<TabKey>('new')
    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const money = useCurrency()
    const supabaseRef = useRef(createClient())

    // Resync: fetch fresh orders from DB on mount and whenever the realtime
    // channel reconnects. This recovers any orders missed during a disconnect
    // (e.g. logout → login, network blip, token refresh).
    const resync = useCallback(async () => {
        const fresh = await getKitchenOrders(restaurantId)
        setOrders(fresh as unknown as KitchenOrder[])
    }, [restaurantId])

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
            const order = data as unknown as KitchenOrder
            let isNew = false
            setOrders(prev => {
                if (prev.some(o => o.id === order.id)) return prev
                isNew = true
                return [...prev, order]
            })
            if (!isNew) return
            // Delay sound + toast 400ms to avoid false alarms: if needs_confirmation=true
            // arrives on a follow-up UPDATE the order will be removed before the 400ms fires.
            setTimeout(() => {
                setOrders(cur => {
                    if (!cur.some(o => o.id === order.id)) return cur // already removed — was a false alarm
                    playNewOrder().catch(() => {})
                    const tbl = order.sessions?.tables?.label
                    const isTakeout = order.order_type === 'takeout'
                    const isDelivery = order.order_type === 'delivery'
                    const sourceLabel = isTakeout ? 'Takeaway' : isDelivery ? 'Delivery' : (tbl ? `Table ${tbl}` : 'Order')
                    toast.custom((t) => (
                        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-2xl px-4 py-3 flex items-start gap-3 border-2 border-amber-300`}>
                            <span className="text-xl mt-0.5">🔔</span>
                            <div>
                                <p className="font-bold text-sm text-amber-700">New Order!</p>
                                <p className="text-xs text-gray-500 mt-0.5">{sourceLabel} · {money(order.total_amount)}</p>
                            </div>
                        </div>
                    ), { duration: 6000, position: 'top-right' })
                    return cur
                })
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
            const fresh = data as unknown as KitchenOrder
            let added = false
            setOrders(prev => {
                if (prev.some(o => o.id === fresh.id)) return prev.map(o => o.id === fresh.id ? fresh : o)
                added = true
                return [...prev, fresh]
            })
            if (added) {
                playNewOrder().catch(() => {})
                const tbl = fresh.sessions?.tables?.label
                const isTakeout = fresh.order_type === 'takeout'
                const isDelivery = fresh.order_type === 'delivery'
                const sourceLabel = isTakeout ? 'Takeaway' : isDelivery ? 'Delivery' : (tbl ? `Table ${tbl}` : 'Order')
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-white shadow-xl rounded-2xl px-4 py-3 flex items-start gap-3 border-2 border-amber-300`}>
                        <span className="text-xl mt-0.5">ðŸ””</span>
                        <div>
                            <p className="font-bold text-sm text-amber-700">New Order!</p>
                            <p className="text-xs text-gray-500 mt-0.5">{sourceLabel} Â· {money(fresh.total_amount)}</p>
                        </div>
                    </div>
                ), { duration: 6000, position: 'top-right' })
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
    // (they go to the waiter) â€” there is no Pass column here.
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
            collapsed={collapsed.has(section.order.id)}
            onToggle={() => toggleCollapse(section.order.id)}
            onApply={applyItemStatus}
        />
    )

    return (
        <div className="h-full flex flex-col bg-[#FBF7F3]">
            {/* Mobile: tab bar */}
            <div className="lg:hidden shrink-0 bg-white border-b border-gray-100 px-2 sm:px-4">
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
                        <div key={key} className="flex-1 min-w-0 flex flex-col">
                            <div className="flex items-center gap-2 pb-3 mb-1 border-b-2" style={{ borderColor: meta.border }}>
                                <Icon size={16} style={{ color: meta.accent }} />
                                <h3 className="font-bold text-gray-800 text-sm">{meta.label}</h3>
                                {list.length > 0 && (
                                    <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: meta.accent }}>
                                        {list.length}
                                    </span>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-3 pr-1 pt-2" style={{ scrollbarWidth: 'thin' }}>
                                {list.map(section => renderTicket(section, key))}
                                {list.length === 0 && (
                                    <div className="pt-16">
                                        <EmptyState icon={Icon} title={emptyTitle(key)} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function itemStatusPill(status: string) {
    if (status === 'preparing') return { label: 'Cookingâ€¦', cls: 'text-[#FB6303]' }
    if (status === 'ready')     return { label: 'Ready', cls: 'text-emerald-600' }
    return { label: 'Pending', cls: 'text-gray-400' }
}

function OrderTicket({ tab, order, items, comboItems, money, now, userId, staffNames, collapsed, onToggle, onApply }: {
    tab: TabKey
    order: KitchenOrder
    items: KitchenOrderItem[]
    comboItems: ComboItemRow[]
    money: (v: number) => string
    now: number
    userId: string
    staffNames: Record<string, string>
    collapsed: boolean
    onToggle: () => void
    onApply: (orderId: string, itemIds: string[], next: OrderItemStatus) => Promise<void>
}) {
    const meta = TAB_META[tab]
    const isCooking = tab === 'cooking'
    
    const tbl = order.sessions?.tables?.label
    const isTakeout = order.order_type === 'takeout'
    const isDelivery = order.order_type === 'delivery'
    const space = isTakeout ? 'Takeaway' : isDelivery ? 'Delivery' : (tbl ? `Table ${tbl}` : 'Order')

    // Selection: New/Queue â†’ all dishes; Cooking â†’ only dishes this chef owns.
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
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ borderLeft: `4px solid ${meta.accent}` }}>
            {/* Header */}
            <button onClick={onToggle} className="w-full text-left px-4 pt-3.5 pb-3">
                <div className="flex items-center gap-2 flex-wrap pr-6 relative">
                    <span className="font-extrabold text-gray-900">#{order.id.slice(0, 4).toUpperCase()}</span>
                    <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full" style={{ background: '#FB6303' }}>{space}</span>
                    <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{items.length} dish{items.length > 1 ? 'es' : ''}</span>
                    {chefLabel && (
                        <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                            <ChefHat size={11} /> {chefLabel}
                        </span>
                    )}
                    <ChevronDown size={18} className={`absolute right-0 top-0.5 text-gray-300 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-gray-400 font-medium">
                    <Clock size={11} />
                    {tab === 'queue' ? `waiting ${waitedMin}m` : timeAgo(order.placed_at)}
                    {!isCooking && selIds.length > 0 && <span className="ml-1" style={{ color: meta.accent }}>Â· {selIds.length} selected</span>}
                </div>
            </button>

            {!collapsed && (
                <div className="px-4 pb-4">
                    {/* Select-all + action (New/Queue) */}
                    {!isCooking && items.length > 0 && (
                        <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-100">
                            {items.length > 1 ? (
                                <button onClick={toggleAll} className="flex items-center gap-2 text-xs font-bold text-gray-500">
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
                                    className={`flex items-center gap-3 py-2 rounded-lg px-1 ${canSelect ? 'cursor-pointer' : 'opacity-70'} ${isSel ? 'bg-orange-50/60' : ''}`}
                                >
                                    {canSelect ? (
                                        isSel ? <CheckSquare size={18} style={{ color: meta.accent }} className="shrink-0" /> : <Square size={18} className="text-gray-300 shrink-0" />
                                    ) : (
                                        <span className="w-[18px] h-[18px] rounded border border-gray-200 shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{item.menu_items?.name}</p>
                                        <p className="text-[11px] text-gray-400">Ã—{item.quantity}{lineTotal > 0 ? ` Â· ${money(lineTotal)}` : ''}{item.special_request ? ` Â· ${item.special_request}` : ''}</p>
                                        {item.menu_items?.is_combo && (
                                            <div className="mt-0.5 pl-2 border-l-2 border-gray-100 text-[10px] text-gray-400 space-y-0.5">
                                                {comboItems.filter(c => c.combo_id === item.menu_item_id).map(c => (
                                                    <div key={c.id}>â€¢ {c.quantity * item.quantity}Ã— {c.menu_items?.name || 'Item'}</div>
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
                            <p className="mt-3 text-center text-xs text-gray-400">Another chef is on these dishes</p>
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
