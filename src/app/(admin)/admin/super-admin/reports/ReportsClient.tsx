'use client'

import { useState, useMemo } from 'react'
import { FileText } from 'lucide-react'

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
            <div className="flex flex-wrap gap-3 bg-white p-6 rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <select
                    value={filterRestaurant}
                    onChange={e => setFilterRestaurant(e.target.value)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-200"
                >
                    <option value="all">All Restaurants</option>
                    {restaurants.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <div className="ml-auto flex items-center gap-4 text-sm text-gray-500">
                    <span><strong className="text-gray-900">{filtered.length}</strong> reports</span>
                    <span><strong className="text-gray-900">Rs. {totalRevenue.toLocaleString()}</strong> total</span>
                    <span><strong className="text-gray-900">{totalOrders}</strong> orders</span>
                </div>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Report Date</th>
                                <th className="px-5 py-3 text-right">Orders</th>
                                <th className="px-5 py-3 text-right">Revenue</th>
                                <th className="px-5 py-3 text-right">Avg Order</th>
                                <th className="px-5 py-3 text-left">Generated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map(r => (
                                <tr key={r.id} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-900">{r.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3 text-gray-700 font-medium">{r.report_date}</td>
                                    <td className="px-5 py-3 text-right text-gray-900 font-semibold">{r.total_orders}</td>
                                    <td className="px-5 py-3 text-right font-semibold text-gray-900">Rs. {(r.total_revenue || 0).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-right text-gray-600">Rs. {(r.avg_order_value || 0).toFixed(0)}</td>
                                    <td className="px-5 py-3 text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">
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
