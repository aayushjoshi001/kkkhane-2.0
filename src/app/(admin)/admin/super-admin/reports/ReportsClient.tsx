'use client'

import { useState, useMemo } from 'react'
import { FileText } from 'lucide-react'
import Select from '@/components/ui/Select'

export type Report = {
    id: string
    restaurant_id: string
    report_date: string
    total_orders: number
    total_revenue: number
    avg_order_value: number
    created_at: string
    restaurants: { name: string } | null
}

export default function ReportsClient({ reports, restaurants }: {
    reports: Report[]
    restaurants: { id: string; name: string }[]
}) {
    const [filterRestaurant, setFilterRestaurant] = useState('all')

    const filtered = useMemo(() => {
        if (filterRestaurant === 'all') return reports
        return reports.filter(r => r.restaurant_id === filterRestaurant)
    }, [reports, filterRestaurant])

    const totalRevenue = filtered.reduce((s, r) => s + (r.total_revenue || 0), 0)
    const totalOrders = filtered.reduce((s, r) => s + (r.total_orders || 0), 0)

    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 bg-surface p-6 rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <Select
                    value={filterRestaurant}
                    onChange={e => setFilterRestaurant(e.target.value)}
                    className="rounded-lg border border-hairline-strong px-3 py-2 text-sm bg-surface outline-none focus:ring-2 focus:ring-indigo-200"
                >
                    <option value="all">All Restaurants</option>
                    {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                <div className="ml-auto flex items-center gap-4 text-sm text-ink-subtle">
                    <span><strong className="text-ink">{filtered.length}</strong> reports</span>
                    <span><strong className="text-ink">Rs. {totalRevenue.toLocaleString()}</strong> total</span>
                    <span><strong className="text-ink">{totalOrders}</strong> orders</span>
                </div>
            </div>

            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Report Date</th>
                                <th className="px-5 py-3 text-right">Orders</th>
                                <th className="px-5 py-3 text-right">Revenue</th>
                                <th className="px-5 py-3 text-right">Avg Order</th>
                                <th className="px-5 py-3 text-left">Generated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {filtered.map(r => (
                                <tr key={r.id} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-ink">{r.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3 text-ink-muted font-medium">{r.report_date}</td>
                                    <td className="px-5 py-3 text-right text-ink font-semibold">{r.total_orders}</td>
                                    <td className="px-5 py-3 text-right font-semibold text-ink">Rs. {(r.total_revenue || 0).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-right text-ink-muted">Rs. {(r.avg_order_value || 0).toFixed(0)}</td>
                                    <td className="px-5 py-3 text-ink-subtle text-xs">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-subtle">
                                    <FileText size={32} className="mx-auto mb-2 opacity-40" />
                                    No reports found
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
