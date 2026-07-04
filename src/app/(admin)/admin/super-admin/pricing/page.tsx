import { requireRole } from '@/lib/auth'
import { getAllPricingRulesOverview } from '../actions'
import { DollarSign, CheckCircle, XCircle } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free: 'bg-gray-100 text-gray-600',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

export default async function PricingPage() {
    await requireRole('super_admin')

    const result = await getAllPricingRulesOverview()
    const rows = (result.data || []) as Array<{
        restaurant_id: string
        restaurant: { name: string; subscription_tier: string } | null
        dynamicPricingEnabled: boolean
        activeRules: number
    }>

    const enabledCount = rows.filter(r => r.dynamicPricingEnabled).length
    const totalRules = rows.reduce((s, r) => s + r.activeRules, 0)

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Dynamic Pricing" 
                description="Read-only overview of dynamic pricing feature across all tenants." 
                icon={<DollarSign size={18} />}
                color="purple"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{rows.length}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Restaurants</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl sm:text-3xl font-extrabold text-purple-600 tabular-nums">{enabledCount}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">With Pricing Enabled</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{totalRules}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Active Rules</div>
                </div>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-gray-50 bg-gray-50/50">
                    <h2 className="text-[1.15rem] font-bold text-gray-900">Feature Status Per Restaurant</h2>
                    <p className="text-[13px] text-gray-500 mt-0.5">Dynamic pricing is available on Pro and Enterprise tiers</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-center">Dynamic Pricing</th>
                                <th className="px-5 py-3 text-right">Active Rules</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map(r => (
                                <tr key={r.restaurant_id} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-900">{r.restaurant?.name || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[r.restaurant?.subscription_tier || 'free']}`}>
                                            {r.restaurant?.subscription_tier || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        {r.dynamicPricingEnabled
                                            ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                                            : <XCircle size={14} className="text-gray-300 mx-auto" />
                                        }
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        {r.activeRules > 0
                                            ? <span className="font-semibold text-purple-700">{r.activeRules}</span>
                                            : <span className="text-gray-400">0</span>
                                        }
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-400">No data</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
