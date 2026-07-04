import { requireRole } from '@/lib/auth'
import { getAllLoyaltyOverview } from '../actions'
import { Heart, CheckCircle, XCircle } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free: 'bg-gray-100 text-gray-600',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

export default async function LoyaltyPage() {
    await requireRole('super_admin')

    const result = await getAllLoyaltyOverview()
    const rows = (result.data || []) as Array<{
        restaurant_id: string
        points_per_dollar: number
        redemption_threshold: number
        redemption_value: number
        is_active: boolean
        memberCount: number
        restaurants: { name: string; subscription_tier: string } | null
    }>

    const activeCount = rows.filter(r => r.is_active).length
    const totalMembers = rows.reduce((s, r) => s + r.memberCount, 0)

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Loyalty Programs" 
                description="Platform-wide loyalty program overview across all tenants." 
                icon={<Heart size={18} />}
                color="emerald"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-pink-600 tabular-nums">{activeCount}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Active Programs</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{totalMembers}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Members</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{rows.length}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Restaurants Configured</div>
                </div>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-gray-800">Loyalty Overview</h2>
                    <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Loyalty is available on Pro and Enterprise tiers</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-center">Active</th>
                                <th className="px-5 py-3 text-right">Members</th>
                                <th className="px-5 py-3 text-right">Pts / Rs.</th>
                                <th className="px-5 py-3 text-right">Redeem At</th>
                                <th className="px-5 py-3 text-right">Redeem Value</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {rows.map(r => (
                                <tr key={r.restaurant_id} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-900">{r.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[r.restaurants?.subscription_tier || 'free']}`}>
                                            {r.restaurants?.subscription_tier || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        {r.is_active
                                            ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                                            : <XCircle size={14} className="text-gray-300 mx-auto" />
                                        }
                                    </td>
                                    <td className="px-5 py-3 text-right font-semibold text-gray-900">{r.memberCount}</td>
                                    <td className="px-5 py-3 text-right text-gray-600">{r.points_per_dollar}</td>
                                    <td className="px-5 py-3 text-right text-gray-600">{r.redemption_threshold} pts</td>
                                    <td className="px-5 py-3 text-right text-gray-600">Rs. {r.redemption_value}</td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                                    <Heart size={32} className="mx-auto mb-2 opacity-40" />
                                    No loyalty programs configured
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
