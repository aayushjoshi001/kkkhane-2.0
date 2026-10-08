import { requireRole } from '@/lib/auth'
import { getAllSubscriptionPayments, getAllRestaurants } from '../actions'
import { CreditCard, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import PaymentApprovalActions from './PaymentApprovalActions'

export const dynamic = 'force-dynamic'

const TIER_COLORS: Record<string, string> = {
    free:       'bg-surface-muted text-ink-muted',
    basic:      'bg-blue-100 text-blue-700',
    premium:    'bg-purple-100 text-purple-700',
    platinum:   'bg-amber-100 text-amber-700',
    enterprise: 'bg-green-100 text-green-700',
}

const METHOD_LABELS: Record<string, string> = {
    cash: 'Cash', esewa: 'eSewa', khalti: 'Khalti', fonepay: 'FonePay',
    bank: 'Bank', bank_transfer: 'Bank Transfer',
}

const STATUS_STYLE: Record<string, string> = {
    pending:  'bg-amber-50 text-amber-700 border border-amber-200',
    approved: 'bg-green-50 text-green-700 border border-green-200',
    rejected: 'bg-red-50 text-red-600 border border-red-200',
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
        status: string | null
        plan_tier: string | null
        billing_months: number | null
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

    const pending = payments.filter(p => !p.status || p.status === 'pending')
    const totalMrr = payments
        .filter(p => now - new Date(p.created_at).getTime() < 30 * 24 * 3600 * 1000 && p.status === 'approved')
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
                description="Approve pending payments to instantly unlock tenant plans."
                icon={<CreditCard size={18} />}
                color="green"
            />

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl font-extrabold text-ink tabular-nums">Rs. {totalMrr.toLocaleString()}</div>
                    <div className="text-[12px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Revenue Last 30 Days</div>
                </div>
                <div className={`rounded-[24px] border shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 ${pending.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-surface border-hairline'}`}>
                    <div className={`text-2xl font-extrabold tabular-nums ${pending.length > 0 ? 'text-amber-700' : 'text-ink'}`}>{pending.length}</div>
                    <div className="text-[12px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Pending Approval</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6">
                    <div className="text-2xl font-extrabold text-ink tabular-nums">{payments.length}</div>
                    <div className="text-[12px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Total Payments</div>
                </div>
                <div className={`rounded-[24px] border shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 ${expiringSoon.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-surface border-hairline'}`}>
                    <div className={`text-2xl font-extrabold tabular-nums ${expiringSoon.length > 0 ? 'text-amber-600' : 'text-ink'}`}>{expiringSoon.length}</div>
                    <div className="text-[12px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Expiring This Week</div>
                </div>
            </div>

            {/* Pending queue — highest priority */}
            {pending.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-[24px] overflow-hidden animate-fade-up" style={{ animationDelay: '0.15s' }}>
                    <div className="px-6 py-4 border-b border-amber-200 flex items-center gap-2">
                        <AlertTriangle size={16} className="text-amber-600" />
                        <h2 className="text-sm font-bold text-amber-800">Pending Payments — Approve to Activate</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-amber-100/60 text-xs text-amber-800 uppercase font-semibold border-b border-amber-200">
                                <tr>
                                    <th className="px-5 py-3 text-left">Restaurant</th>
                                    <th className="px-5 py-3 text-left">Plan</th>
                                    <th className="px-5 py-3 text-right">Amount</th>
                                    <th className="px-5 py-3 text-left">Method</th>
                                    <th className="px-5 py-3 text-left">Reference</th>
                                    <th className="px-5 py-3 text-left">Submitted</th>
                                    <th className="px-5 py-3 text-left">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-100">
                                {pending.map(p => (
                                    <tr key={p.id} className="hover:bg-amber-100/40 transition-colors">
                                        <td className="px-5 py-3 font-semibold text-ink">{p.restaurants?.name || '—'}</td>
                                        <td className="px-5 py-3">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[p.plan_tier || 'free']}`}>
                                                {p.plan_tier || '?'} · {p.billing_months ?? 12}mo
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-right font-bold text-ink">Rs. {(p.amount || 0).toLocaleString()}</td>
                                        <td className="px-5 py-3 text-ink-muted">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                                        <td className="px-5 py-3 font-mono text-xs text-ink-subtle">{p.reference_code || '—'}</td>
                                        <td className="px-5 py-3 text-xs text-ink-subtle">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                                        <td className="px-5 py-3">
                                            <PaymentApprovalActions paymentId={p.id} status={p.status ?? 'pending'} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Expiring alert */}
            {expiringSoon.length > 0 && (
                <div className="bg-surface rounded-[24px] border border-amber-200 overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                    <div className="p-6 flex items-start gap-3">
                        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="font-bold text-amber-800">Subscriptions expiring within 7 days</p>
                            <ul className="mt-2 space-y-2">
                                {expiringSoon.map(r => (
                                    <li key={r.id} className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-ink">{r.name}</span>
                                        <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-100">
                                            expires {new Date(r.subscription_expires_at!).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Full payment history */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.25s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50">
                    <h2 className="text-base font-bold text-ink">All Payments</h2>
                    <p className="text-xs text-ink-subtle mt-0.5">Full history of subscription payments</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Plan</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                                <th className="px-5 py-3 text-left">Method</th>
                                <th className="px-5 py-3 text-left">Reference</th>
                                <th className="px-5 py-3 text-left">Status</th>
                                <th className="px-5 py-3 text-left">Date</th>
                                <th className="px-5 py-3 text-left">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {payments.map(p => (
                                <tr key={p.id} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-ink">{p.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[p.plan_tier || p.restaurants?.subscription_tier || 'free']}`}>
                                            {p.plan_tier || p.restaurants?.subscription_tier || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-right font-semibold text-ink">Rs. {(p.amount || 0).toLocaleString()}</td>
                                    <td className="px-5 py-3 text-ink-muted">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                                    <td className="px-5 py-3 font-mono text-xs text-ink-subtle">{p.reference_code || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status ?? 'pending']}`}>
                                            {p.status ?? 'pending'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-xs text-ink-subtle">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                                    <td className="px-5 py-3">
                                        <PaymentApprovalActions paymentId={p.id} status={p.status ?? 'pending'} />
                                    </td>
                                </tr>
                            ))}
                            {payments.length === 0 && (
                                <tr><td colSpan={8} className="px-5 py-12 text-center text-ink-subtle">No payments yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Subscription status */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50">
                    <h2 className="text-base font-bold text-ink">All Tenants — Subscription Status</h2>
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
                                    <tr key={r.id} className={`hover:bg-surface-muted/50 transition-colors ${r.is_suspended ? 'bg-red-50/30' : ''}`}>
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
                                        <td className="px-5 py-3 text-xs text-ink-subtle">
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
