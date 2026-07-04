import { requireRole } from '@/lib/auth'
import { getAllPromoCodesAcrossRestaurants } from '../actions'
import { Tag, CheckCircle, XCircle } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free: 'bg-gray-100 text-gray-600',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

const PROMO_TYPE_LABEL: Record<string, string> = {
    percentage_off: '% Off',
    amount_off: 'Rs. Off',
    free_item: 'Free Item',
    bogo: 'BOGO',
}

export default async function PromosPage() {
    await requireRole('super_admin')

    const result = await getAllPromoCodesAcrossRestaurants()
    const promos = (result.data || []) as unknown as Array<{
        id: string
        restaurant_id: string
        code: string
        promo_type: string
        value: number
        current_uses: number
        max_uses: number | null
        valid_until: string | null
        is_active: boolean
        restaurants: { name: string } | null
    }>

    const activeCount = promos.filter(p => p.is_active).length
    const totalUses = promos.reduce((s, p) => s + (p.current_uses || 0), 0)

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Promo Codes" 
                description="All promo codes across every restaurant tenant." 
                icon={<Tag size={18} />}
                color="orange"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{promos.length}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Promo Codes</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tabular-nums">{activeCount}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Active</div>
                </div>
                <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-gray-900 tabular-nums">{totalUses}</div>
                    <div className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Total Uses</div>
                </div>
            </div>

            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-gray-800">All Promo Codes</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Code</th>
                                <th className="px-5 py-3 text-left">Type</th>
                                <th className="px-5 py-3 text-right">Value</th>
                                <th className="px-5 py-3 text-right">Uses</th>
                                <th className="px-5 py-3 text-left">Expires</th>
                                <th className="px-5 py-3 text-center">Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {promos.map(p => (
                                <tr key={p.id} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-900">{p.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3 font-mono font-bold text-gray-800 text-xs">{p.code}</td>
                                    <td className="px-5 py-3 text-gray-600 text-xs">{PROMO_TYPE_LABEL[p.promo_type] || p.promo_type}</td>
                                    <td className="px-5 py-3 text-right font-semibold text-gray-900">
                                        {p.promo_type === 'percentage_off' ? `${p.value}%` : `Rs. ${p.value}`}
                                    </td>
                                    <td className="px-5 py-3 text-right text-gray-600">
                                        {p.current_uses}{p.max_uses ? `/${p.max_uses}` : ''}
                                    </td>
                                    <td className="px-5 py-3 text-gray-500 text-xs">
                                        {p.valid_until ? new Date(p.valid_until).toLocaleDateString('en-IN') : '—'}
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        {p.is_active
                                            ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                                            : <XCircle size={14} className="text-gray-300 mx-auto" />
                                        }
                                    </td>
                                </tr>
                            ))}
                            {promos.length === 0 && (
                                <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                                    <Tag size={32} className="mx-auto mb-2 opacity-40" />
                                    No promo codes found
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
