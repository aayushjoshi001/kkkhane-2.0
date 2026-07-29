import { requireRole } from '@/lib/auth'
import { getAllSubscriptionPayments, getAllRestaurants } from '../actions'
import { CreditCard, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free: 'bg-surface-muted text-ink-muted',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

const METHOD_LABELS: Record<string, string> = {
    cash: 'Cash', esewa: 'eSewa', khalti: 'Khalti', bank_transfer: 'Bank Transfer', fonepay: 'FonePay',
}

export default async function PaymentsPage() {
    await requireRole('super_admin')

    const [paymentsResult, restaurantsResult] = await Promise.all([
        getAllSubscriptionPayments(200),
        getAllRestaurants(),
    ])

    const payments = (paymentsResult.data || []) as unknown as Array<{
        id: string
        restaurant_id: string
        amount: number
        payment_method: string
        reference_code: string | null
        notes: string | null
        created_at: string
        restaurants: { name: string; subscription_tier: string; subscription_expires_at: string | null; subscription_status: string } | null
    }>

    const restaurants = (restaurantsResult.data || []) as Array<{
        id: string
        name: string
        subscription_tier: string
        subscription_status: string
        subscription_expires_at: string | null
        is_suspended: boolean
    }>

    const now = Date.now()
    const totalMrr = payments
        .filter(p => now - new Date(p.created_at).getTime() < 30 * 24 * 3600 * 1000)
        .reduce((s, p) => s + (p.amount || 0), 0)

    const expiringSoon = restaurants.filter(r => {
        if (!r.subscription_expires_at) return false
        const diff = new Date(r.subscription_expires_at).getTime() - now
        return diff > 0 && diff < 7 * 24 * 3600 * 1000
    })

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Subscription Payments" 
                description="Track subscription billing and tenant payment history." 
                icon={<CreditCard size={18} />}
                color="green"
            />

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">Rs. {totalMrr.toLocaleString()}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Revenue Last 30 Days</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{payments.length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Total Payments Recorded</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className={`text-2xl sm:text-3xl font-extrabold tabular-nums ${expiringSoon.length > 0 ? 'text-amber-600' : 'text-ink'}`}>
                        {expiringSoon.length}
                    </div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Expiring This Week</div>
                </div>
            </div>

            {/* Expiring Alert */}
            {expiringSoon.length > 0 && (
                <div className="bg-surface rounded-[24px] border border-amber-200 shadow-[0_8px_30px_rgb(245,158,11,0.06)] overflow-hidden relative group animate-fade-up" style={{ animationDelay: '0.15s' }}>
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                    <div className="p-6 flex items-start gap-3">
                        <AlertTriangle size={24} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                        <div className="flex-1">
                            <p className="font-bold text-amber-800 text-[15px]">Subscriptions renewing soon</p>
                            <ul className="mt-2 space-y-2">
                                {expiringSoon.map(r => (
                                    <li key={r.id} className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-ink-muted">
                                            <strong>{r.name}</strong>
                                        </span>
                                        <span className="text-[13px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-100">
                                            expires {new Date(r.subscription_expires_at!).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Payment History */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50">
                    <h2 className="text-[1.15rem] font-bold text-ink">Payment History</h2>
                    <p className="text-[13px] text-ink-subtle mt-0.5">All recorded subscription payments</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                                <th className="px-5 py-3 text-left">Method</th>
                                <th className="px-5 py-3 text-left">Reference</th>
                                <th className="px-5 py-3 text-left">Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {payments.map(p => (
                                <tr key={p.id} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-ink">{p.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[p.restaurants?.subscription_tier || 'free']}`}>
                                            {p.restaurants?.subscription_tier || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-semibold text-ink">Rs. {(p.amount || 0).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-ink-muted">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                                    <td className="px-5 py-3 text-ink-subtle font-mono text-xs">{p.reference_code || '—'}</td>
                                    <td className="px-5 py-3 text-ink-subtle text-xs">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                                </tr>
                            ))}
                            {payments.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-subtle">No payments recorded yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Subscription Status */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50">
                    <h2 className="text-[1.15rem] font-bold text-ink">Subscription Status</h2>
                    <p className="text-[13px] text-ink-subtle mt-0.5">Current billing status for all tenants</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-left">Expires</th>
                                <th className="px-5 py-3 text-left">Days Left</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {restaurants.map(r => {
                                const daysLeft = r.subscription_expires_at
                                    ? Math.ceil((new Date(r.subscription_expires_at).getTime() - now) / (1000 * 60 * 60 * 24))
                                    : null
                                return (
                                    <tr key={r.id} className={`group hover:bg-surface-muted/50 transition-colors ${r.is_suspended ? 'bg-red-50/30 hover:bg-red-50/50' : ''}`}>
                                        <td className="px-5 py-3 font-medium text-ink">{r.name}</td>
                                        <td className="px-5 py-3">
                                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[r.subscription_tier] || TIER_COLORS.free}`}>
                                                {r.subscription_tier}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3">
                                            <span className={`flex items-center gap-1 text-xs font-medium ${r.is_suspended ? 'text-red-600' : r.subscription_status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {r.is_suspended
                                                    ? <><AlertTriangle size={12} /> Suspended</>
                                                    : r.subscription_status === 'active'
                                                        ? <><CheckCircle size={12} /> Active</>
                                                        : <><Clock size={12} /> {r.subscription_status}</>
                                                }
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-ink-subtle text-xs">
                                            {r.subscription_expires_at ? new Date(r.subscription_expires_at).toLocaleDateString('en-IN') : '—'}
                                        </td>
                                        <td className="px-5 py-3">
                                            {daysLeft !== null ? (
                                                <span className={`text-xs font-semibold ${daysLeft < 0 ? 'text-red-600' : daysLeft < 7 ? 'text-amber-600' : 'text-ink-muted'}`}>
                                                    {daysLeft < 0 ? 'Expired' : `${daysLeft}d`}
                                                </span>
                                            ) : '—'}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
