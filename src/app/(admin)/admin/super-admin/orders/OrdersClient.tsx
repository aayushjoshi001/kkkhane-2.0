'use client'

import { useState, useMemo } from 'react'
import { ShoppingBag } from 'lucide-react'

export type Order = {
    id: string
    restaurant_id: string
    total_amount: number
    status: string
    placed_at: string
    payment_status: string
    session_id: string
    restaurants: { name: string } | null
    sessions: { tables: { label: string } | null } | null
}

const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
    preparing: 'bg-brand-50 text-orange-700 border-brand-200',
    ready: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
}

export default function OrdersClient({ orders, restaurants }: {
    orders: Order[]
    restaurants: { id: string; name: string }[]
}) {
    const [filterRestaurant, setFilterRestaurant] = useState('all')
    const [filterStatus, setFilterStatus] = useState('all')
    const [filterDate, setFilterDate] = useState('all')
    // Seeded once on mount so the filter memo stays a pure computation.
    const [now] = useState(() => Date.now())

    const filtered = useMemo(() => {
        return orders.filter(o => {
            if (filterRestaurant !== 'all' && o.restaurant_id !== filterRestaurant) return false
            if (filterStatus !== 'all' && o.status !== filterStatus) return false
            if (filterDate === 'today') {
                const today = new Date(now); today.setHours(0, 0, 0, 0)
                if (new Date(o.placed_at) < today) return false
            } else if (filterDate === '7d') {
                if (now - new Date(o.placed_at).getTime() > 7 * 24 * 3600 * 1000) return false
            } else if (filterDate === '30d') {
                if (now - new Date(o.placed_at).getTime() > 30 * 24 * 3600 * 1000) return false
            }
            return true
        })
    }, [orders, filterRestaurant, filterStatus, filterDate, now])

    const totalRevenue = filtered.reduce((s, o) => s + (o.total_amount || 0), 0)

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 bg-surface p-4 rounded-xl border border-hairline-strong shadow-sm">
                <select
                    value={filterRestaurant}
                    onChange={e => setFilterRestaurant(e.target.value)}
                    className="rounded-lg border border-hairline-strong px-3 py-2 text-sm bg-surface outline-none focus:ring-2 focus:ring-indigo-200"
                >
                    <option value="all">All Restaurants</option>
                    {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="rounded-lg border border-hairline-strong px-3 py-2 text-sm bg-surface outline-none focus:ring-2 focus:ring-indigo-200"
                >
                    <option value="all">All Statuses</option>
                    {['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'].map(s => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                </select>
                <select
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    className="rounded-lg border border-hairline-strong px-3 py-2 text-sm bg-surface outline-none focus:ring-2 focus:ring-indigo-200"
                >
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                </select>
                <div className="ml-auto flex items-center gap-4 text-sm text-ink-subtle">
                    <span><strong className="text-ink">{filtered.length}</strong> orders</span>
                    <span><strong className="text-ink">Rs. {totalRevenue.toLocaleString()}</strong> total</span>
                </div>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-surface rounded-2xl border border-hairline-strong shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Order ID</th>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Table</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-left">Payment</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                                <th className="px-5 py-3 text-right">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(o => (
                                <tr key={o.id} className="hover:bg-surface-muted/50">
                                    <td className="px-5 py-3 font-mono text-xs font-medium text-ink-muted">{o.id.slice(0, 8).toUpperCase()}</td>
                                    <td className="px-5 py-3 font-medium text-ink">{(o.restaurants as { name: string } | null)?.name || '—'}</td>
                                    <td className="px-5 py-3 text-ink-subtle">
                                        {(o.sessions as { tables: { label: string } | null } | null)?.tables?.label || 'Takeout'}
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[o.status] || 'bg-surface-muted text-ink-muted border-hairline-strong'}`}>
                                            {o.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-ink-subtle capitalize">{o.payment_status}</td>
                                    <td className="px-5 py-3 text-right font-semibold text-ink">Rs. {(o.total_amount || 0).toFixed(2)}</td>
                                    <td className="px-5 py-3 text-right text-ink-subtle text-xs">
                                        {new Date(o.placed_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-subtle">No orders match your filters</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
                {filtered.map(o => (
                    <div key={o.id} className="bg-surface rounded-xl border border-hairline-strong p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <p className="font-mono text-xs font-bold text-ink-muted">#{o.id.slice(0, 8).toUpperCase()}</p>
                                <p className="font-medium text-ink text-sm mt-0.5">{(o.restaurants as { name: string } | null)?.name}</p>
                                <p className="text-xs text-ink-subtle mt-0.5">{new Date(o.placed_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="font-bold text-ink">Rs. {(o.total_amount || 0).toFixed(2)}</p>
                                <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_COLORS[o.status] || 'bg-surface-muted text-ink-muted border-hairline-strong'}`}>
                                    {o.status}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="text-center py-12 text-ink-subtle">
                        <ShoppingBag size={32} className="mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No orders match your filters</p>
                    </div>
                )}
            </div>
        </div>
    )
}
