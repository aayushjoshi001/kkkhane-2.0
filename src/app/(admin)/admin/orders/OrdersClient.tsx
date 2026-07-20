'use client'

import { useMemo, useState } from 'react'
import { ShoppingBag, Search, X } from 'lucide-react'
import { useCurrency, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { toNepaliDate } from '@/lib/nepaliDate'
import RefundOrderButton from './RefundOrderButton'
import Select from '@/components/ui/Select'

export type AdminOrder = {
    id: string
    status: string
    payment_status: string
    total_amount: number | null
    refunded_amount: number | null
    placed_at: string
    customer_note: string | null
    sessions: { tables: { label: string } | null } | null
    order_items: { id: string; quantity: number; menu_items: { name: string } | null }[]
}

const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    confirmed: 'bg-brand-50 text-brand-700 border-brand-200',
    preparing: 'bg-amber-50 text-amber-700 border-amber-200',
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    delivered: 'bg-success-bg/50 text-success-fg border-success-bg',
    cancelled: 'bg-danger-bg/50 text-danger-fg border-danger-bg',
}

const PAY_COLORS: Record<string, string> = {
    unpaid: 'text-amber-600',
    paid: 'text-success-fg',
    refunded: 'text-danger-fg',
}

const STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']
const PAYMENTS = ['unpaid', 'paid', 'refunded']

const selectClass = 'h-10 rounded-[var(--r-md)] border border-hairline px-4 text-sm bg-surface outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]'

export default function OrdersClient({ orders, canRefund }: { orders: AdminOrder[]; canRefund: boolean }) {
    const [search, setSearch] = useState('')
    const money = useCurrency()
    const bsEnabled = useFeatureEnabled('bsDateEnabled')
    const [status, setStatus] = useState('all')
    const [payment, setPayment] = useState('all')
    const [dateRange, setDateRange] = useState('all')
    // Seeded once on mount so the filter memo stays a pure computation.
    const [now] = useState(() => Date.now())

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return orders.filter(o => {
            if (status !== 'all' && o.status !== status) return false
            if (payment !== 'all' && o.payment_status !== payment) return false
            if (dateRange === 'today') {
                const today = new Date(now); today.setHours(0, 0, 0, 0)
                if (new Date(o.placed_at) < today) return false
            } else if (dateRange === '7d') {
                if (now - new Date(o.placed_at).getTime() > 7 * 24 * 3600 * 1000) return false
            } else if (dateRange === '30d') {
                if (now - new Date(o.placed_at).getTime() > 30 * 24 * 3600 * 1000) return false
            }
            if (q) {
                const idMatch = o.id.toLowerCase().includes(q)
                const tableMatch = (o.sessions?.tables?.label || '').toLowerCase().includes(q)
                const itemMatch = o.order_items?.some(i => (i.menu_items?.name || '').toLowerCase().includes(q))
                if (!idMatch && !tableMatch && !itemMatch) return false
            }
            return true
        })
    }, [orders, search, status, payment, dateRange, now])

    const revenue = filtered.reduce((s, o) => s + (o.payment_status === 'refunded' ? 0 : (o.total_amount ?? 0)), 0)
    const hasActiveFilters = search.trim() !== '' || status !== 'all' || payment !== 'all' || dateRange !== 'all'

    const clearFilters = () => { setSearch(''); setStatus('all'); setPayment('all'); setDateRange('all') }

    return (
        <div className="bg-surface rounded-card shadow-sm border border-hairline overflow-hidden">
            {/* Header + summary */}
            <div className="p-5 md:p-6 border-b border-hairline bg-surface-muted/30 flex flex-wrap items-center gap-3 justify-between">
                <h3 className="text-base md:text-lg font-bold text-ink flex items-center gap-2">
                    <ShoppingBag size={20} className="text-ink-subtle" /> All Orders
                    <span className="text-sm font-medium text-ink-subtle/70">({filtered.length}{filtered.length !== orders.length ? ` of ${orders.length}` : ''})</span>
                </h3>
                <div className="text-sm text-ink-subtle bg-surface px-4 py-2 rounded-full border border-hairline shadow-inner">
                    Total: <strong className="text-ink ml-1 tabular-nums">{money(revenue)}</strong>
                </div>
            </div>

            {/* Filters */}
            <div className="p-4 border-b border-hairline flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center bg-surface">
                <div className="relative flex-1 min-w-[180px]">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search order #, table or item…"
                        className="w-full h-10 pl-10 pr-4 rounded-[var(--r-md)] border border-hairline text-sm bg-surface outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                    />
                </div>
                <div className="grid grid-cols-3 sm:flex gap-3">
                    <Select value={status} onChange={e => setStatus(e.target.value)} className={selectClass} aria-label="Filter by status">
                        <option value="all">All Status</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </Select>
                    <Select value={payment} onChange={e => setPayment(e.target.value)} className={selectClass} aria-label="Filter by payment">
                        <option value="all">All Payment</option>
                        {PAYMENTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                    </Select>
                    <Select value={dateRange} onChange={e => setDateRange(e.target.value)} className={selectClass} aria-label="Filter by date">
                        <option value="all">All Time</option>
                        <option value="today">Today</option>
                        <option value="7d">Last 7 Days</option>
                        <option value="30d">Last 30 Days</option>
                    </Select>
                </div>
                {hasActiveFilters && (
                    <button onClick={clearFilters} className="h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-[var(--r-md)] text-sm font-bold text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring">
                        <X size={14} /> Clear
                    </button>
                )}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto max-h-[70vh] overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm text-left">
                    <thead className="text-[10px] text-ink-subtle uppercase tracking-wider bg-surface-muted/50 border-b border-hairline font-bold sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="px-6 py-4">Order</th>
                            <th className="px-6 py-4">Table</th>
                            <th className="px-6 py-4">Items</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Payment</th>
                            <th className="px-6 py-4">Time</th>
                            <th className="px-6 py-4 text-right">Amount</th>
                            {canRefund && <th className="px-6 py-4" />}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {filtered.map((order) => {
                            const tableLabel = order.sessions?.tables?.label || '—'
                            const itemCount = order.order_items?.length || 0
                            const itemNames = order.order_items?.map((i) => `${i.quantity}x ${i.menu_items?.name}`).join(', ') || '—'
                            const refundable = canRefund && ['paid', 'unpaid'].includes(order.payment_status) && order.status !== 'cancelled'

                            return (
                                <tr key={order.id} className={`hover:bg-surface-muted/30 transition-colors ${order.payment_status === 'refunded' ? 'opacity-50' : ''}`}>
                                    <td className="px-6 py-4 font-mono font-bold text-ink text-xs tracking-wide">
                                        #{order.id.substring(0, 8).toUpperCase()}
                                    </td>
                                    <td className="px-6 py-4 font-bold text-ink">{tableLabel}</td>
                                    <td className="px-6 py-4 text-ink-subtle max-w-xs truncate" title={itemNames}>
                                        <span className="font-bold">{itemCount}</span> item{itemCount !== 1 ? 's' : ''}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] tracking-wide font-bold uppercase border ${STATUS_COLORS[order.status] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                                            {order.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[11px] tracking-wide font-bold uppercase ${PAY_COLORS[order.payment_status] || 'text-ink-subtle'}`}>
                                            {order.payment_status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-ink-subtle text-xs whitespace-nowrap">
                                        <span className="tabular-nums">{bsEnabled ? toNepaliDate(new Date(order.placed_at), 'MMMM DD, YYYY', 'en') : new Date(order.placed_at).toLocaleDateString()}</span> <span className="mx-1 opacity-50">·</span> <span className="tabular-nums">{new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-ink whitespace-nowrap">
                                        <span className={`tabular-nums ${order.payment_status === 'refunded' ? 'line-through text-ink-subtle' : ''}`}>
                                            {money(order.total_amount ?? 0)}
                                        </span>
                                    </td>
                                    {canRefund && (
                                        <td className="px-4 py-4 text-right">
                                            {refundable && (
                                                <RefundOrderButton orderId={order.id} paymentStatus={order.payment_status} totalAmount={order.total_amount ?? 0} refundedAmount={order.refunded_amount ?? 0} />
                                            )}
                                        </td>
                                    )}
                                </tr>
                            )
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={canRefund ? 8 : 7} className="px-6 py-16 text-center text-ink-subtle font-bold">
                                {orders.length === 0 ? 'No orders found.' : 'No orders match your filters.'}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-hairline">
                {filtered.map((order) => {
                    const tableLabel = order.sessions?.tables?.label || '—'
                    const itemNames = order.order_items?.map((i) => `${i.quantity}x ${i.menu_items?.name}`).join(', ') || ''
                    const refundable = canRefund && ['paid', 'unpaid'].includes(order.payment_status) && order.status !== 'cancelled'

                    return (
                        <div key={order.id} className={`p-5 space-y-3 ${order.payment_status === 'refunded' ? 'opacity-50' : ''}`}>
                            <div className="flex items-center justify-between">
                                <div className="font-mono text-xs font-bold text-ink tracking-wide">#{order.id.substring(0, 8).toUpperCase()}</div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-bold uppercase tracking-wide ${PAY_COLORS[order.payment_status] || 'text-ink-subtle'}`}>
                                        {order.payment_status}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${STATUS_COLORS[order.status] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                                        {order.status}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-bold text-ink-subtle">Table {tableLabel}</span>
                                <span className={`font-bold tabular-nums ${order.payment_status === 'refunded' ? 'line-through text-ink-subtle' : 'text-ink'}`}>
                                    {money(order.total_amount ?? 0)}
                                </span>
                            </div>
                            {itemNames && <p className="text-xs text-ink-subtle/70 truncate">{itemNames}</p>}
                            <div className="flex items-center justify-between pt-1">
                                <div className="text-[11px] text-ink-subtle tabular-nums font-medium">
                                    {bsEnabled ? toNepaliDate(new Date(order.placed_at), 'MMMM DD, YYYY', 'en') : new Date(order.placed_at).toLocaleDateString()} <span className="opacity-50 mx-1">·</span> {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                                {refundable && <RefundOrderButton orderId={order.id} paymentStatus={order.payment_status} totalAmount={order.total_amount ?? 0} refundedAmount={order.refunded_amount ?? 0} />}
                            </div>
                        </div>
                    )
                })}
                {filtered.length === 0 && (
                    <div className="p-8 text-center text-ink-subtle font-bold">
                        {orders.length === 0 ? 'No orders found.' : 'No orders match your filters.'}
                    </div>
                )}
            </div>
        </div>
    )
}
