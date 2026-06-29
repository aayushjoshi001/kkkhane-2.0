'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { playNewOrder } from '@/lib/audio'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Clock, ChefHat, CheckCircle2, CheckSquare, Square, Check, ListOrdered, Printer, LayoutPanelLeft, Hourglass, User } from 'lucide-react'
import type { OrderStatus, OrderItemStatus, Order, OrderItem, OrderItemModifier, MenuItem, Session, Table } from '@/types/database'
import { setOrderItemsStatus } from '@/app/(staff)/kitchen/actions'
import { rollUpOrderStatus } from '@/lib/orderRollup'
import { AgingTimer, EmptyState } from '@/components/ui'

export type KitchenOrderItem = OrderItem & {
    menu_item_id?: string
    menu_items?: Partial<MenuItem>
    order_item_modifiers?: Partial<OrderItemModifier>[]
}

export type KitchenOrder = Order & {
    sessions?: Session & { tables?: Partial<Table> }
    order_items?: KitchenOrderItem[]
}

// A combo's constituent line, as fetched in KitchenPage.
export type ComboItemRow = {
    id: string
    combo_id: string
    item_id?: string
    quantity: number
    menu_items?: { name?: string | null } | null
}

// A dish waiting in New Orders auto-moves to the Queue section after this long
// without a chef clicking Cook. Derived purely from placed_at on a ticking clock,
// so there is no extra status to persist or background job to run.
const QUEUE_AFTER_MS = 2 * 60 * 1000

const ORDER_SELECT = `
  id, status, total_amount, placed_at, customer_note,
  sessions ( tables ( label ) ),
  order_items (
    id, menu_item_id, quantity, special_request, status, claimed_by, claimed_at,
    menu_items ( id, name, is_combo ),
    order_item_modifiers ( modifier_name, price_adjustment )
  )
` as const

type Section = { order: KitchenOrder; items: KitchenOrderItem[] }

export default function OrderQueue({ initialOrders, restaurantId, comboItems = [], userId, staffNames = {} }: {
    initialOrders: KitchenOrder[]
    restaurantId: string
    comboItems?: ComboItemRow[]
    userId: string
    staffNames?: Record<string, string>
}) {
    const [orders, setOrders] = useState<KitchenOrder[]>(initialOrders)
    const [now, setNow] = useState(() => Date.now())
    const money = useCurrency()
    const supabaseRef = useRef(createClient())

    // Tick so pending dishes re-bucket from New Orders into Queue at the 2-min mark
    // without needing a server round-trip or a realtime event.
    useEffect(() => {
        const i = setInterval(() => setNow(Date.now()), 10_000)
        return () => clearInterval(i)
    }, [])

    // Live order changes via the shared per-restaurant channel.
    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        // Takeout orders live in the dedicated TakeoutQueue — ignore them here.
        if ((payload.new as { order_type?: string } | null)?.order_type === 'takeout') return
        // Mode 2: orders awaiting waiter confirmation aren't in the kitchen yet.
        const needsConfirmation = (payload.new as { needs_confirmation?: boolean } | null)?.needs_confirmation === true
        if (payload.eventType === 'INSERT') {
            if (needsConfirmation) return
            const supabase = supabaseRef.current
            const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const order = data as unknown as KitchenOrder
            // Realtime can replay an INSERT (reconnect, multiple tabs) or deliver one
            // already present in initialOrders — guard against duplicate rows/keys.
            let isNew = false
            setOrders(prev => {
                if (prev.some(o => o.id === order.id)) return prev
                isNew = true
                return [...prev, order]
            })
            if (!isNew) return
            playNewOrder().catch(() => {})
            const tbl = order.sessions?.tables?.label
            toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full shadow-2xl rounded-card px-4 py-3 flex items-start gap-3 border border-yellow-500/30`}
                     style={{ background: '#1a1d27' }}>
                    <span className="text-xl mt-0.5">🔔</span>
                    <div>
                        <p className="font-bold text-sm text-yellow-400">New Order!</p>
                        <p className="text-xs text-dark-muted mt-0.5">{tbl ? `Table ${tbl}` : 'Takeout'} · {money(order.total_amount)}</p>
                    </div>
                </div>
            ), { duration: 6000, position: 'top-right' })
        } else if (payload.eventType === 'UPDATE') {
            const newStatus = payload.new.status as string
            // Gone from the kitchen: finished, cancelled, or still awaiting confirmation.
            if (newStatus === 'delivered' || newStatus === 'cancelled' || needsConfirmation) {
                setOrders(prev => prev.filter(o => o.id !== payload.new.id))
                return
            }
            // Refetch the full row. An item's status/owner may have changed without the
            // order leaving the board (1 of 3 cooking), OR a waiter just confirmed it —
            // in which case it's new to the kitchen and we add it (with a chime).
            const supabase = supabaseRef.current
            const { data } = await supabase.from('orders').select(ORDER_SELECT).eq('id', payload.new.id).single()
            if (!data) return
            const fresh = data as unknown as KitchenOrder
            let added = false
            setOrders(prev => {
                if (prev.some(o => o.id === fresh.id)) return prev.map(o => o.id === fresh.id ? fresh : o)
                added = true
                return [...prev, fresh]
            })
            if (added) playNewOrder().catch(() => {})
        }
    })

    // Advance a selected subset of an order's items, re-bucketing optimistically.
    // For Cook (→preparing) we also stamp ownership locally so the cooking card
    // shows "you" immediately; the server reconciles on conflict.
    const applyItemStatus = async (orderId: string, itemIds: string[], nextStatus: OrderItemStatus) => {
        if (itemIds.length === 0) return
        const snapshot = orders
        const nowIso = new Date().toISOString()
        setOrders(cur => cur.map(o => {
            if (o.id !== orderId) return o
            const items = (o.order_items || []).map(it =>
                itemIds.includes(it.id)
                    ? {
                        ...it,
                        status: nextStatus,
                        ...(nextStatus === 'preparing' ? { claimed_by: userId, claimed_at: nowIso } : {}),
                    }
                    : it)
            const rolled = rollUpOrderStatus(items.map(i => i.status as OrderItemStatus))
            return { ...o, order_items: items, status: (rolled ?? o.status) as OrderStatus }
        }))
        const res = await setOrderItemsStatus(orderId, itemIds, nextStatus, userId)
        if (res?.error) {
            setOrders(snapshot)
            toast.error(
                res.conflict
                    ? (nextStatus === 'ready' ? 'Only the chef who started a dish can mark it ready' : 'Those items were just updated by someone else')
                    : 'Could not update items'
            )
        }
    }

    // Bucket every order's items into the four sections by the dish's own state.
    // An order can appear in several columns at once (a partial ticket in each).
    const { newO, queueO, cookO, passO } = useMemo(() => {
        const sorted = [...orders].sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime())
        const newO: Section[] = [], queueO: Section[] = [], cookO: Section[] = [], passO: Section[] = []
        for (const o of sorted) {
            const its = o.order_items || []
            const pending = its.filter(i => i.status === 'pending')
            const preparing = its.filter(i => i.status === 'preparing')
            const ready = its.filter(i => i.status === 'ready')
            if (pending.length) {
                const aged = now - new Date(o.placed_at).getTime() >= QUEUE_AFTER_MS
                ;(aged ? queueO : newO).push({ order: o, items: pending })
            }
            if (preparing.length) cookO.push({ order: o, items: preparing })
            if (ready.length) passO.push({ order: o, items: ready })
        }
        return { newO, queueO, cookO, passO }
    }, [orders, now])

    const tocItems = useMemo(() => {
        // Everything still to be cooked (pending or preparing), wherever it sits.
        const items = orders
            .flatMap(o => o.order_items || [])
            .filter(it => it.status === 'pending' || it.status === 'preparing')
        const grouped = new Map<string, {
            name: string,
            quantity: number,
            modifiers: string,
            special_request: string | null,
            constituents?: { name: string; quantity: number }[]
        }>()

        for (const item of items) {
            if (!item.menu_items?.name) continue

            const mods = (item.order_item_modifiers || [])
                .map(m => m.modifier_name)
                .sort()
                .join(', ')

            const key = `${item.menu_items.name}|${mods}|${item.special_request || ''}`

            const constituents = item.menu_items?.is_combo
                ? comboItems
                    .filter(c => c.combo_id === item.menu_item_id)
                    .map(c => ({
                        name: c.menu_items?.name || 'Item',
                        quantity: c.quantity
                    }))
                : undefined

            if (!grouped.has(key)) {
                grouped.set(key, {
                    name: item.menu_items.name,
                    quantity: item.quantity,
                    modifiers: mods,
                    special_request: item.special_request,
                    constituents: constituents ? constituents.map(c => ({ ...c, quantity: c.quantity * item.quantity })) : undefined
                })
            } else {
                const entry = grouped.get(key)!
                entry.quantity += item.quantity
                if (entry.constituents && constituents) {
                    entry.constituents = entry.constituents.map(c => {
                        const match = constituents.find(mc => mc.name === c.name)
                        return match ? { ...c, quantity: c.quantity + (match.quantity * item.quantity) } : c
                    })
                }
            }
        }

        return Array.from(grouped.values()).sort((a, b) => b.quantity - a.quantity)
    }, [orders, comboItems])

    const [activeTab, setActiveTab] = useState<'new' | 'queue' | 'cooking' | 'pass' | 'toc'>('new')
    const [showTOCDesktop, setShowTOCDesktop] = useState(false)

    // Column accents: New=warning (amber), Queue=danger (overdue red),
    // Cooking=info (blue — never brand orange for status), Pass=success (green).
    const COLS = [
        {
            key: 'new' as const,
            label: 'New Orders',
            icon: Clock,
            color: 'var(--warning)',
            borderColor: 'color-mix(in srgb, var(--warning) 28%, transparent)',
            bgColor: 'color-mix(in srgb, var(--warning) 12%, transparent)',
            sections: newO,
            emptyLabel: 'No new dishes',
        },
        {
            key: 'queue' as const,
            label: 'Queue',
            icon: Hourglass,
            color: 'var(--danger)',
            borderColor: 'color-mix(in srgb, var(--danger) 28%, transparent)',
            bgColor: 'color-mix(in srgb, var(--danger) 12%, transparent)',
            sections: queueO,
            emptyLabel: 'Queue is clear',
        },
        {
            key: 'cooking' as const,
            label: 'Cooking',
            icon: ChefHat,
            color: 'var(--info)',
            borderColor: 'color-mix(in srgb, var(--info) 28%, transparent)',
            bgColor: 'color-mix(in srgb, var(--info) 12%, transparent)',
            sections: cookO,
            emptyLabel: 'Nothing cooking',
        },
        {
            key: 'pass' as const,
            label: 'Pass',
            icon: CheckCircle2,
            color: 'var(--success)',
            borderColor: 'color-mix(in srgb, var(--success) 28%, transparent)',
            bgColor: 'color-mix(in srgb, var(--success) 12%, transparent)',
            sections: passO,
            emptyLabel: 'Pass is clear ✓',
        },
    ]

    return (
        <div className="h-full flex flex-col bg-dark-bg print:bg-white print:text-black">
            {/* Mobile tab bar */}
            <div className="flex md:hidden gap-1.5 px-2 pt-3 pb-2 shrink-0 print:hidden overflow-x-auto">
                {COLS.map(col => {
                    const Icon = col.icon
                    const isActive = activeTab === col.key
                    return (
                        <button
                            key={col.key}
                            onClick={() => setActiveTab(col.key)}
                            className="flex-1 min-w-[72px] py-2.5 rounded-card text-xs font-bold flex items-center justify-center gap-1.5 transition-all border"
                            style={isActive
                                ? { background: col.bgColor, borderColor: col.borderColor, color: col.color }
                                : { background: 'var(--dark-surface)', borderColor: 'var(--dark-border)', color: 'var(--dark-muted)' }
                            }
                        >
                            <Icon size={13} />
                            {col.label.split(' ')[0]}
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                                  style={{ background: 'rgba(255,255,255,0.1)', color: isActive ? col.color : 'rgba(255,255,255,0.3)' }}>
                                {col.sections.length}
                            </span>
                        </button>
                    )
                })}
                <button
                    onClick={() => setActiveTab('toc')}
                    className="flex-1 min-w-[64px] py-2.5 rounded-card text-xs font-bold flex items-center justify-center gap-1.5 transition-all border"
                    style={activeTab === 'toc'
                        ? { background: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)', color: '#3b82f6' }
                        : { background: 'var(--dark-surface)', borderColor: 'var(--dark-border)', color: 'var(--dark-muted)' }
                    }
                >
                    <ListOrdered size={13} />
                    TOC
                </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                {/* Columns Container */}
                <div className={`flex-1 overflow-x-auto flex flex-col md:flex-row p-3 md:p-5 gap-3 md:gap-5 print:hidden ${activeTab === 'toc' ? 'hidden md:flex' : 'flex'}`}>

                {COLS.map(col => {
                    const Icon = col.icon
                    const isVisible = activeTab === col.key
                    return (
                        <div key={col.key}
                             className={`flex-none w-full md:w-[320px] lg:w-[340px] flex flex-col gap-3 ${isVisible ? 'flex' : 'hidden md:flex'}`}>
                            {/* Column header — desktop only */}
                            <div className="hidden md:flex items-center justify-between pb-3 border-b border-dark-border">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-[var(--r-md)] flex items-center justify-center"
                                         style={{ background: col.bgColor }}>
                                        <Icon size={15} style={{ color: col.color }} />
                                    </div>
                                    <h2 className="font-bold text-dark-ink">{col.label}</h2>
                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                          style={{ background: col.bgColor, color: col.color }}>
                                        {col.sections.length}
                                    </span>
                                </div>
                                {col.key === 'pass' && (
                                    <div className="flex items-center gap-3">
                                        {col.sections.length > 0 && (
                                            <span className="text-[10px] text-dark-muted">Awaiting waiter</span>
                                        )}
                                        <button
                                            onClick={() => setShowTOCDesktop(!showTOCDesktop)}
                                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--r-md)] text-xs font-bold border transition-colors"
                                            style={{
                                                background: showTOCDesktop ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                                                borderColor: showTOCDesktop ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)',
                                                color: showTOCDesktop ? '#60a5fa' : 'rgba(255,255,255,0.6)'
                                            }}
                                        >
                                            <LayoutPanelLeft size={13} />
                                            {showTOCDesktop ? 'Hide TOC' : 'Show TOC'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Tickets */}
                            <div className="flex-1 overflow-y-auto space-y-3 pb-6"
                                 style={{ scrollbarWidth: 'none' }}>
                                {col.sections.map(section => {
                                    const key = section.order.id
                                    if (col.key === 'pass') {
                                        return (
                                            <ReadyTicket
                                                key={key}
                                                order={section.order}
                                                items={section.items}
                                                comboItems={comboItems}
                                                accentColor={col.color}
                                                borderColor={col.borderColor}
                                                bgColor={col.bgColor}
                                            />
                                        )
                                    }
                                    if (col.key === 'cooking') {
                                        return (
                                            <CookingTicket
                                                key={key}
                                                order={section.order}
                                                items={section.items}
                                                comboItems={comboItems}
                                                userId={userId}
                                                staffNames={staffNames}
                                                accentColor={col.color}
                                                borderColor={col.borderColor}
                                                bgColor={col.bgColor}
                                                onApply={applyItemStatus}
                                            />
                                        )
                                    }
                                    return (
                                        <CookTicket
                                            key={key}
                                            order={section.order}
                                            items={section.items}
                                            comboItems={comboItems}
                                            accentColor={col.color}
                                            borderColor={col.borderColor}
                                            bgColor={col.bgColor}
                                            queued={col.key === 'queue'}
                                            now={now}
                                            onApply={applyItemStatus}
                                        />
                                    )
                                })}
                                {col.sections.length === 0 && (
                                    <EmptyState dark icon={Icon} title={col.emptyLabel} />
                                )}
                            </div>
                        </div>
                    )
                })}
                </div>

                {/* TOC Sidebar / Panel */}
                <div
                    className={`flex flex-col h-full shrink-0 border-dark-border print:w-full print:border-none ${activeTab === 'toc' ? 'block w-full' : (showTOCDesktop ? 'hidden md:flex md:w-[320px] lg:w-[360px] md:border-l' : 'hidden')} print:block`}
                >
                    <div className="flex items-center justify-between p-4 border-b border-dark-border shrink-0 print:border-black/10 print:pb-2">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-[var(--r-md)] flex items-center justify-center bg-blue-500/10 print:hidden">
                                <ListOrdered size={15} className="text-blue-500" />
                            </div>
                            <h2 className="font-bold text-dark-ink print:text-black print:text-xl">Consolidated (TOC)</h2>
                        </div>
                        <button onClick={() => window.print()} className="p-2 hover:bg-white/5 rounded-[var(--r-md)] text-dark-muted transition print:hidden">
                            <Printer size={16} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 print:space-y-1 print:p-0 print:pt-4" style={{ scrollbarWidth: 'none' }}>
                        {tocItems.map((item, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 rounded-card border border-dark-border bg-dark-surface print:border-black/10 print:bg-transparent print:p-2 print:rounded-none">
                                <span className="font-extrabold text-lg w-8 shrink-0 tabular-nums mt-0.5 text-blue-400 print:text-black">
                                    {item.quantity}×
                                </span>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-dark-ink text-[15px] leading-snug print:text-black">{item.name}</p>
                                    {item.modifiers && (
                                        <p className="text-xs text-dark-muted mt-0.5 print:text-black/60">{item.modifiers}</p>
                                    )}
                                    {item.special_request && (
                                        <p className="text-xs text-yellow-400/80 italic mt-0.5 font-medium print:text-black/80">↳ {item.special_request}</p>
                                    )}
                                    {item.constituents && (
                                        <div className="mt-1 pl-3 border-l border-dark-border text-xs text-dark-muted space-y-0.5 print:text-black/70 print:border-black/20">
                                            {item.constituents.map((c, idx) => (
                                                <div key={idx}>
                                                    • {c.quantity}× {c.name}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {tocItems.length === 0 && (
                            <div className="text-center py-12 print:hidden">
                                <ListOrdered size={28} className="mx-auto mb-2 text-dark-muted" />
                                <p className="text-sm font-medium text-dark-muted">Nothing to prep</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

function ItemBody({ item, comboItems, chefName }: {
    item: KitchenOrderItem
    comboItems: ComboItemRow[]
    chefName?: string
}) {
    return (
        <div className="flex-1 min-w-0">
            <p className="font-semibold text-dark-ink text-[15px] leading-snug">{item.menu_items?.name}</p>
            {item.menu_items?.is_combo && (
                <div className="mt-1 pl-3 border-l-2 border-dark-border text-xs text-dark-muted space-y-0.5">
                    {comboItems
                        .filter(c => c.combo_id === item.menu_item_id)
                        .map(c => (
                            <div key={c.id}>
                                • {c.quantity * item.quantity}× {c.menu_items?.name || 'Item'}
                            </div>
                        ))
                    }
                </div>
            )}
            {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                <p className="text-xs text-dark-muted mt-0.5">
                    {item.order_item_modifiers.map((m, i) => (
                        <span key={i}>{m.modifier_name}{i < (item.order_item_modifiers?.length ?? 0) - 1 ? ', ' : ''}</span>
                    ))}
                </p>
            )}
            {item.special_request && (
                <p className="text-xs text-yellow-400/80 italic mt-0.5 font-medium">↳ {item.special_request}</p>
            )}
            {chefName && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mt-1 text-dark-muted">
                    <User size={10} /> {chefName}
                </span>
            )}
        </div>
    )
}

/** Header shared by every ticket — table + aging timer. */
function TicketHeader({ order, accentColor, borderColor, bgColor, trailing }: {
    order: KitchenOrder
    accentColor: string
    borderColor: string
    bgColor: string
    trailing?: React.ReactNode
}) {
    const tbl = order.sessions?.tables?.label || '?'
    return (
        <div className="px-4 py-2.5 flex items-center justify-between border-b" style={{ borderColor, background: bgColor }}>
            <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }} />
                <span className="font-bold text-dark-ink">Table {tbl}</span>
            </div>
            {trailing}
        </div>
    )
}

/** Hook: multi-select over a list of selectable item ids, default all-selected,
 *  reconciling as items advance out of the section or new ones arrive. */
function useItemSelection(selectableIds: string[]) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(selectableIds))
    const key = selectableIds.join(',')
    const prevRef = useRef<string[]>(selectableIds)
    useEffect(() => {
        const prevIds = prevRef.current
        setSelected(prev => {
            const next = new Set<string>()
            for (const id of selectableIds) {
                const isNew = !prevIds.includes(id)
                if (isNew || prev.has(id)) next.add(id)
            }
            return next
        })
        prevRef.current = selectableIds
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])
    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })
    const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds))
    return { selected, toggle, allSelected, toggleAll }
}

/**
 * New Orders / Queue ticket — its pending dishes can be selected and Cooked.
 * Clicking Cook claims the selected dishes for the current chef and moves only
 * those to the Cooking section; un-cooked siblings stay behind.
 */
function CookTicket({ order, items, comboItems = [], accentColor, borderColor, bgColor, queued, now, onApply }: {
    order: KitchenOrder
    items: KitchenOrderItem[]
    comboItems?: ComboItemRow[]
    accentColor: string
    borderColor: string
    bgColor: string
    queued?: boolean
    now: number
    onApply: (orderId: string, itemIds: string[], next: OrderItemStatus) => Promise<void>
}) {
    const ids = useMemo(() => items.map(i => i.id), [items])
    const { selected, toggle, allSelected, toggleAll } = useItemSelection(ids)
    const [busy, setBusy] = useState(false)
    const selIds = items.filter(i => selected.has(i.id)).map(i => i.id)

    const waitedMin = Math.floor((now - new Date(order.placed_at).getTime()) / 60000)

    const cook = async () => {
        if (selIds.length === 0 || busy) return
        setBusy(true)
        await onApply(order.id, selIds, 'preparing')
        setBusy(false)
    }

    return (
        <div className="rounded-card overflow-hidden border bg-dark-surface" style={{ borderColor }}>
            <TicketHeader
                order={order}
                accentColor={accentColor}
                borderColor={borderColor}
                bgColor={bgColor}
                trailing={queued
                    ? <span className="flex items-center gap-1 text-[11px] font-bold" style={{ color: accentColor }}>
                        <Hourglass size={12} /> Waiting {waitedMin}m
                      </span>
                    : <AgingTimer since={order.placed_at} dark warnAfter={5} dangerAfter={10} />}
            />

            {items.length > 1 && (
                <button
                    onClick={toggleAll}
                    className="w-full px-4 py-2 flex items-center gap-2 text-xs font-bold border-b border-dark-border text-dark-muted hover:bg-white/5 transition-colors"
                >
                    {allSelected ? <CheckSquare size={15} style={{ color: accentColor }} /> : <Square size={15} />}
                    {allSelected ? 'All dishes selected' : 'Select all'}
                    <span className="ml-auto font-mono">{selIds.length}/{items.length}</span>
                </button>
            )}

            <div className="p-4 space-y-2.5">
                {items.map((item) => {
                    const isSel = selected.has(item.id)
                    return (
                        <div key={item.id} className="flex items-start gap-2.5 cursor-pointer" onClick={() => toggle(item.id)}>
                            <div className="shrink-0 mt-0.5">
                                {isSel
                                    ? <CheckSquare size={18} style={{ color: accentColor }} />
                                    : <Square size={18} className="text-dark-muted" />}
                            </div>
                            <span className="font-bold text-sm w-6 shrink-0 tabular-nums mt-0.5" style={{ color: accentColor }}>
                                {item.quantity}×
                            </span>
                            <ItemBody item={item} comboItems={comboItems} />
                        </div>
                    )
                })}

                {order.customer_note && (
                    <div className="mt-3 px-3 py-2 rounded-card border border-yellow-500/20 text-yellow-400/80 text-xs"
                         style={{ background: 'rgba(245,158,11,0.06)' }}>
                        <span className="font-bold text-[9px] uppercase tracking-widest block mb-0.5 text-yellow-500/60">Note</span>
                        {order.customer_note}
                    </div>
                )}

                <div className="pt-2">
                    <button
                        onClick={cook}
                        disabled={selIds.length === 0 || busy}
                        className="w-full py-3 rounded-card font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 border disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                            background: 'color-mix(in srgb, var(--info) 12%, transparent)',
                            borderColor: 'color-mix(in srgb, var(--info) 28%, transparent)',
                            color: 'var(--info)',
                        }}
                    >
                        <ChefHat size={16} />
                        Cook{selIds.length ? ` (${selIds.length})` : ''}
                    </button>
                </div>
            </div>
        </div>
    )
}

/**
 * Cooking ticket — preparing dishes, each tagged with the chef who owns it.
 * Only dishes owned by the current chef (or never claimed) are selectable, and
 * Mark Ready acts only on those. Other chefs' dishes are visible but locked.
 */
function CookingTicket({ order, items, comboItems = [], userId, staffNames, accentColor, borderColor, bgColor, onApply }: {
    order: KitchenOrder
    items: KitchenOrderItem[]
    comboItems?: ComboItemRow[]
    userId: string
    staffNames: Record<string, string>
    accentColor: string
    borderColor: string
    bgColor: string
    onApply: (orderId: string, itemIds: string[], next: OrderItemStatus) => Promise<void>
}) {
    const isMine = (it: KitchenOrderItem) => !it.claimed_by || it.claimed_by === userId
    const mineItems = useMemo(() => items.filter(it => !it.claimed_by || it.claimed_by === userId), [items, userId])
    const mineIds = useMemo(() => mineItems.map(i => i.id), [mineItems])
    const { selected, toggle, allSelected, toggleAll } = useItemSelection(mineIds)
    const [busy, setBusy] = useState(false)
    const selIds = mineItems.filter(i => selected.has(i.id)).map(i => i.id)

    const markReady = async () => {
        if (selIds.length === 0 || busy) return
        setBusy(true)
        await onApply(order.id, selIds, 'ready')
        setBusy(false)
    }

    return (
        <div className="rounded-card overflow-hidden border bg-dark-surface" style={{ borderColor }}>
            <TicketHeader
                order={order}
                accentColor={accentColor}
                borderColor={borderColor}
                bgColor={bgColor}
                trailing={<AgingTimer since={order.placed_at} dark warnAfter={5} dangerAfter={10} />}
            />

            {mineItems.length > 1 && (
                <button
                    onClick={toggleAll}
                    className="w-full px-4 py-2 flex items-center gap-2 text-xs font-bold border-b border-dark-border text-dark-muted hover:bg-white/5 transition-colors"
                >
                    {allSelected ? <CheckSquare size={15} style={{ color: accentColor }} /> : <Square size={15} />}
                    {allSelected ? 'All my dishes selected' : 'Select all mine'}
                    <span className="ml-auto font-mono">{selIds.length}/{mineItems.length}</span>
                </button>
            )}

            <div className="p-4 space-y-2.5">
                {items.map((item) => {
                    const mine = isMine(item)
                    const isSel = selected.has(item.id)
                    const ownerName = item.claimed_by
                        ? (item.claimed_by === userId ? 'You' : (staffNames[item.claimed_by] || 'Another chef'))
                        : undefined
                    return (
                        <div
                            key={item.id}
                            className={`flex items-start gap-2.5 ${mine ? 'cursor-pointer' : 'opacity-60'}`}
                            onClick={mine ? () => toggle(item.id) : undefined}
                        >
                            <div className="shrink-0 mt-0.5">
                                {mine
                                    ? (isSel ? <CheckSquare size={18} style={{ color: accentColor }} /> : <Square size={18} className="text-dark-muted" />)
                                    : <span className="inline-block w-[18px] h-[18px] rounded border border-dark-border" />}
                            </div>
                            <span className="font-bold text-sm w-6 shrink-0 tabular-nums mt-0.5" style={{ color: accentColor }}>
                                {item.quantity}×
                            </span>
                            <ItemBody item={item} comboItems={comboItems} chefName={ownerName} />
                        </div>
                    )
                })}

                {order.customer_note && (
                    <div className="mt-3 px-3 py-2 rounded-card border border-yellow-500/20 text-yellow-400/80 text-xs"
                         style={{ background: 'rgba(245,158,11,0.06)' }}>
                        <span className="font-bold text-[9px] uppercase tracking-widest block mb-0.5 text-yellow-500/60">Note</span>
                        {order.customer_note}
                    </div>
                )}

                <div className="pt-2">
                    {mineItems.length > 0 ? (
                        <button
                            onClick={markReady}
                            disabled={selIds.length === 0 || busy}
                            className="w-full py-3 rounded-card font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 border disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                                borderColor: 'color-mix(in srgb, var(--success) 28%, transparent)',
                                color: 'color-mix(in srgb, var(--success) 75%, white)',
                            }}
                        >
                            <CheckCircle2 size={16} />
                            Mark Ready{selIds.length ? ` (${selIds.length})` : ''}
                        </button>
                    ) : (
                        <p className="text-center text-xs text-dark-muted py-2 flex items-center justify-center gap-1.5">
                            <User size={13} /> Another chef is on these
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Read-only Pass ticket — ready dishes awaiting the waiter. */
function ReadyTicket({ order, items, comboItems = [], accentColor, borderColor, bgColor }: {
    order: KitchenOrder
    items: KitchenOrderItem[]
    comboItems?: ComboItemRow[]
    accentColor: string
    borderColor: string
    bgColor: string
}) {
    return (
        <div className="rounded-card overflow-hidden border bg-dark-surface" style={{ borderColor }}>
            <TicketHeader
                order={order}
                accentColor={accentColor}
                borderColor={borderColor}
                bgColor={bgColor}
                trailing={<span className="text-caption font-mono font-semibold tabular text-dark-muted">{timeAgo(order.placed_at)}</span>}
            />

            <div className="p-4 space-y-2.5">
                {items.map((item) => (
                    <div key={item.id} className="flex items-start gap-2.5">
                        <Check size={18} style={{ color: 'var(--success)' }} className="shrink-0 mt-0.5" />
                        <span className="font-bold text-sm w-6 shrink-0 tabular-nums mt-0.5" style={{ color: accentColor }}>
                            {item.quantity}×
                        </span>
                        <ItemBody item={item} comboItems={comboItems} />
                    </div>
                ))}

                <div className="pt-2">
                    <div className="flex items-center justify-center gap-2 py-2.5 rounded-card border text-sm font-semibold"
                         style={{
                             background: 'color-mix(in srgb, var(--success) 10%, transparent)',
                             borderColor: 'color-mix(in srgb, var(--success) 28%, transparent)',
                             color: 'color-mix(in srgb, var(--success) 70%, white)',
                         }}>
                        <CheckCircle2 size={15} /> Ready — awaiting pickup
                    </div>
                </div>
            </div>
        </div>
    )
}
