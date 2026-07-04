import { requireRole } from '@/lib/auth'
import { getPlatformAnalytics } from '../actions'
import { BarChart3, TrendingUp, Building2 } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free: 'bg-gray-200',
    basic: 'bg-blue-400',
    pro: 'bg-purple-500',
    enterprise: 'bg-amber-500',
}

const TIER_TEXT: Record<string, string> = {
    free: 'text-gray-600',
    basic: 'text-blue-700',
    pro: 'text-purple-700',
    enterprise: 'text-amber-700',
}

export default async function AnalyticsPage() {
    await requireRole('super_admin')

    const analytics = await getPlatformAnalytics()

    // Build last 12 months array
    const months: string[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const mrrValues = months.map(m => analytics.mrrByMonth[m] || 0)
    const maxMrr = Math.max(...mrrValues, 1)

    // Last 6 months for tenant growth
    const last6Months = months.slice(-6)
    const tenantValues = last6Months.map(m => analytics.tenantsByMonth[m] || 0)
    const maxTenants = Math.max(...tenantValues, 1)

    // Tier breakdown from restaurantStats
    const tierCount: Record<string, number> = {}
    for (const r of analytics.restaurantStats) {
        tierCount[r.tier] = (tierCount[r.tier] || 0) + 1
    }

    const totalRevenue30 = analytics.restaurantStats.reduce((s, r) => s + r.revenue30d, 0)

    // Format month label
    const fmtMonth = (ym: string) => {
        const [y, m] = ym.split('-')
        return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
    }

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Platform Analytics" 
                description="Business intelligence across all restaurant tenants." 
                icon={<BarChart3 size={18} />}
                color="blue"
            />

            {/* MRR Chart */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h2 className="font-semibold text-gray-800">Monthly Subscription Revenue (Last 12 Months)</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Sum of all subscription payments per month</p>
                    </div>
                    <BarChart3 size={18} className="text-indigo-500" />
                </div>
                <div className="flex items-end gap-1 h-32">
                    {months.map((m, i) => {
                        const val = mrrValues[i]
                        const pct = Math.round((val / maxMrr) * 100)
                        return (
                            <div key={m} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex flex-col justify-end h-24">
                                    <div
                                        className="w-full bg-indigo-500 rounded-t-sm transition-all"
                                        style={{ height: `${Math.max(pct, val > 0 ? 4 : 0)}%` }}
                                        title={`${fmtMonth(m)}: Rs. ${val.toLocaleString()}`}
                                    />
                                </div>
                                <span className="text-[9px] text-gray-400 hidden md:block">{fmtMonth(m)}</span>
                            </div>
                        )
                    })}
                </div>
                <div className="flex justify-between mt-2 md:hidden text-[10px] text-gray-400">
                    <span>{fmtMonth(months[0])}</span>
                    <span>{fmtMonth(months[months.length - 1])}</span>
                </div>
            </div>

            {/* Tenant Growth Chart */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h2 className="font-semibold text-gray-800">New Tenant Signups (Last 6 Months)</h2>
                    </div>
                    <TrendingUp size={18} className="text-emerald-500" />
                </div>
                <div className="flex items-end gap-2 h-24">
                    {last6Months.map((m, i) => {
                        const val = tenantValues[i]
                        const pct = Math.round((val / maxTenants) * 100)
                        return (
                            <div key={m} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full flex flex-col justify-end h-16">
                                    <div
                                        className="w-full bg-emerald-500 rounded-t-sm"
                                        style={{ height: `${Math.max(pct, val > 0 ? 8 : 0)}%` }}
                                        title={`${fmtMonth(m)}: ${val} new tenants`}
                                    />
                                </div>
                                <span className="text-[10px] text-gray-500">{fmtMonth(m)}</span>
                                <span className="text-[10px] font-bold text-gray-700">{val}</span>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Tier Breakdown */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                <h2 className="font-semibold text-gray-800 mb-4">Subscription Tier Breakdown</h2>
                <div className="flex flex-wrap gap-4">
                    {Object.entries(tierCount).map(([tier, count]) => (
                        <div key={tier} className="flex-1 min-w-[100px] bg-gray-50 rounded-xl p-4 text-center border border-gray-100">
                            <div className={`w-3 h-3 rounded-full ${TIER_COLORS[tier] || 'bg-gray-300'} mx-auto mb-2`} />
                            <div className={`text-xl font-extrabold ${TIER_TEXT[tier] || 'text-gray-700'}`}>{count}</div>
                            <div className="text-xs text-gray-500 mt-0.5 capitalize">{tier}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Restaurant Performance Table */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.4s' }}>
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                    <div>
                        <h2 className="font-semibold text-gray-800">Restaurant Performance (Last 30 Days)</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Total: Rs. {totalRevenue30.toLocaleString()} revenue · {analytics.restaurantStats.reduce((s, r) => s + r.orders30d, 0)} orders</p>
                    </div>
                    <Building2 size={16} className="text-gray-400" />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">#</th>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-right">Orders (30d)</th>
                                <th className="px-5 py-3 text-right">Revenue (30d)</th>
                                <th className="px-5 py-3 text-right">Avg Order Value</th>
                                <th className="px-5 py-3 text-left">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {analytics.restaurantStats.map((r, i) => {
                                const avgOrderVal = r.orders30d > 0 ? r.revenue30d / r.orders30d : 0
                                return (
                                    <tr key={r.id} className={`group hover:bg-gray-50/50 transition-colors ${r.isSuspended ? 'bg-red-50/30' : ''}`}>
                                        <td className="px-5 py-3 text-gray-400 text-xs font-medium">{i + 1}</td>
                                        <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                                        <td className="px-5 py-3">
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[r.tier] ? `bg-${r.tier === 'enterprise' ? 'amber' : r.tier === 'pro' ? 'purple' : r.tier === 'basic' ? 'blue' : 'gray'}-100 ${TIER_TEXT[r.tier]}` : 'bg-gray-100 text-gray-600'}`}>
                                                {r.tier}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right font-semibold text-gray-900">{r.orders30d}</td>
                                        <td className="px-5 py-3 text-right text-gray-900">Rs. {r.revenue30d.toLocaleString()}</td>
                                        <td className="px-5 py-3 text-right text-gray-500">Rs. {avgOrderVal.toFixed(0)}</td>
                                        <td className="px-5 py-3">
                                            {r.isSuspended
                                                ? <span className="text-xs font-semibold text-red-600">Suspended</span>
                                                : <span className="text-xs font-semibold text-emerald-600">Active</span>
                                            }
                                        </td>
                                    </tr>
                                )
                            })}
                            {analytics.restaurantStats.length === 0 && (
                                <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400">No data yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
