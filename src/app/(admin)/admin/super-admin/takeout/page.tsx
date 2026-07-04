import { requireRole } from '@/lib/auth'
import { getAllTakeoutOrdersAcrossRestaurants } from '../actions'
import { Truck } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
    placed: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
    preparing: 'bg-orange-50 text-orange-700 border-orange-200',
    ready_for_pickup: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    picked_up: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-red-50 text-red-700 border-red-200',
}

export default async function TakeoutPage() {
    await requireRole('super_admin')

    const result = await getAllTakeoutOrdersAcrossRestaurants(200)
    const orders = (result.data || []) as unknown as Array<{
        id: string
        restaurant_id: string
        customer_name: string
        customer_phone: string
        status: string
        total_amount: number
        placed_at: string
        payment_status: string
        restaurants: { name: string } | null
    }>

    const activeCount = orders.filter(o => !['picked_up', 'cancelled'].includes(o.status)).length

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Takeout Orders" 
                description="Platform-wide takeout order overview across all restaurants." 
                icon={<Truck size={18} />}
                color="orange"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{orders.length}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Orders</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-orange-600 tabular-nums">{activeCount}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Active Orders</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">
                        Rs. {orders.reduce((s, o) => s + (o.total_amount || 0), 0).toLocaleString()}
                    </div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Revenue</div>
                </div>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-gray-800">All Takeout Orders</h2>
                </div>

                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Customer</th>
                                <th className="px-5 py-3 text-left">Phone</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                                <th className="px-5 py-3 text-right">Placed At</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {orders.map(o => (
                                <tr key={o.id} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-900">{o.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3 text-gray-700">{o.customer_name}</td>
                                    <td className="px-5 py-3 text-gray-500 font-mono text-xs">{o.customer_phone}</td>
                                    <td className="px-5 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                            {o.status.replace('_', ' ')}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-semibold text-gray-900">Rs. {(o.total_amount || 0).toFixed(2)}</td>
                                    <td className="px-5 py-3 text-right text-gray-500 text-xs">
                                        {new Date(o.placed_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                </tr>
                            ))}
                            {orders.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-gray-400">No takeout orders yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y divide-gray-100">
                    {orders.map(o => (
                        <div key={o.id} className="p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div>
                                    <p className="font-medium text-gray-900 text-sm">{o.restaurants?.name}</p>
                                    <p className="text-xs text-gray-600 mt-0.5">{o.customer_name} · {o.customer_phone}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">{new Date(o.placed_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="font-bold text-gray-900 text-sm">Rs. {(o.total_amount || 0).toFixed(2)}</p>
                                    <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                                        {o.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {orders.length === 0 && (
                        <div className="p-12 text-center text-gray-400">
                            <Truck size={32} className="mx-auto mb-2 opacity-40" />
                            <p className="text-sm">No takeout orders</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
