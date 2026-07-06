import { requireRole } from '@/lib/auth'
import { getSaasMetricsFull } from '../actions'
import { Building2, CheckCircle, Ban, DollarSign, ShoppingBag, Crown, AlertTriangle, TrendingUp, ArrowRight, Settings, Users, FileText, CreditCard, Activity } from 'lucide-react'
import Link from 'next/link'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const TIER_BADGE: Record<string, string> = {
    free:       'bg-surface-muted text-ink-muted border-hairline-strong',
    basic:      'bg-blue-100 text-blue-700 border-blue-200',
    pro:        'bg-purple-100 text-purple-700 border-purple-200',
    enterprise: 'bg-amber-100 text-amber-700 border-amber-200',
}

const TIER_BAR: Record<string, string> = {
    free: 'from-gray-400 to-gray-500', 
    basic: 'from-blue-400 to-blue-500', 
    pro: 'from-purple-400 to-purple-500', 
    enterprise: 'from-amber-400 to-amber-500',
}

export default async function SuperAdminDashboardPage() {
    await requireRole('super_admin')
    const metrics = await getSaasMetricsFull()
    const proPlus = (metrics.tierBreakdown.pro || 0) + (metrics.tierBreakdown.enterprise || 0)

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Platform Dashboard" 
                description="Real-time SaaS health and tenant metrics across the entire platform" 
                icon={<Crown size={18} />}
                color="blue"
                actions={
                    <Link href="/admin/super-admin/restaurants"
                          className="bg-blue-600 hover:bg-blue-500 text-white px-7 py-3.5 rounded-[16px] font-semibold transition-all duration-300 hover:scale-105 shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] flex items-center gap-2">
                        Manage Tenants <ArrowRight size={18} />
                    </Link>
                }
            />

            {/* Expiring alert */}
            {metrics.expiringSoon.length > 0 && (
                <div className="bg-surface rounded-[24px] border border-amber-200 shadow-[0_8px_30px_rgb(245,158,11,0.06)] overflow-hidden relative group animate-fade-up">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                    <div className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-amber-600">
                                <AlertTriangle size={20} className="animate-pulse" />
                                <h3 className="font-bold text-[15px]">Subscription Renewals Upcoming</h3>
                            </div>
                            <span className="bg-amber-100 text-amber-700 text-[12px] font-bold px-3 py-1 rounded-full border border-amber-200">
                                {metrics.expiringSoon.length} tenant{metrics.expiringSoon.length > 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {metrics.expiringSoon.map(r => (
                                <div key={r.id} className="flex items-center justify-between">
                                    <span className="text-[14px] font-medium text-ink-muted flex items-center gap-2">
                                        <Building2 size={14} className="text-ink-subtle" /> {r.name}
                                    </span>
                                    <span className="text-[13px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                                        Expires {new Date(r.subscription_expires_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Premium KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <KpiCard title="Total Tenants" value={metrics.totalRestaurants} icon={Building2} color="indigo" />
                <KpiCard title="Active Tenants" value={metrics.activeRestaurants} icon={CheckCircle} color="emerald" />
                <KpiCard title="Suspended" value={metrics.suspendedRestaurants} icon={Ban} color="red" />
                <KpiCard title="Total MRR" value={`Rs. ${metrics.mrr.toLocaleString()}`} icon={DollarSign} color="green" />
                <KpiCard title="Platform Orders" value={metrics.totalOrders} icon={ShoppingBag} color="blue" />
                <KpiCard title="Pro+ Accounts" value={proPlus} icon={Crown} color="amber" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {/* Top restaurants */}
                    <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between bg-surface-muted/50">
                            <h2 className="text-[1.15rem] font-bold text-ink flex items-center gap-2">
                                <TrendingUp size={20} className="text-indigo-500" /> Top Performers (30 Days)
                            </h2>
                            <Link href="/admin/super-admin/analytics" className="text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
                                View full report
                            </Link>
                        </div>
                        <div className="divide-y divide-gray-50 p-2">
                            {metrics.top5ByOrders.length === 0 ? (
                                <div className="p-10 text-center text-ink-subtle">
                                    <Activity size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-[14px] font-medium">No order data yet</p>
                                </div>
                            ) : metrics.top5ByOrders.map((r, i) => (
                                <div key={r.id} className="flex items-center gap-4 p-3 hover:bg-surface-muted rounded-xl transition-colors group">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold shadow-sm ${i === 0 ? 'bg-gradient-to-br from-amber-200 to-amber-400 text-amber-900' : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-300 text-ink-muted' : i === 2 ? 'bg-gradient-to-br from-orange-200 to-orange-300 text-orange-900' : 'bg-indigo-50 text-indigo-700'}`}>
                                        #{i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[15px] font-bold text-ink group-hover:text-indigo-600 transition-colors truncate">{r.name}</p>
                                        <p className="text-[13px] text-ink-subtle">{r.count.toLocaleString()} orders generated</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[15px] font-bold text-ink tabular-nums">Rs. {r.revenue.toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Tier distribution */}
                    <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <h2 className="text-[1.15rem] font-bold text-ink mb-6 flex items-center gap-2">
                            <Activity size={20} className="text-purple-500" /> Subscription Distribution
                        </h2>
                        
                        <div className="flex flex-wrap gap-3 mb-6">
                            {Object.entries(metrics.tierBreakdown).map(([tier, count]) => (
                                <div key={tier} className={`px-4 py-2 rounded-xl text-[13px] font-bold border shadow-sm flex items-center gap-2 ${TIER_BADGE[tier] || TIER_BADGE.free}`}>
                                    <span className="capitalize">{tier}</span>
                                    <span className="bg-surface/50 px-1.5 py-0.5 rounded-md tabular-nums">{count}</span>
                                </div>
                            ))}
                        </div>
                        
                        <div className="flex w-full h-4 rounded-full overflow-hidden shadow-inner gap-0.5 bg-surface-muted">
                            {Object.entries(metrics.tierBreakdown).map(([tier, count]) => {
                                const total = metrics.totalRestaurants || 1
                                const pct = (count / total) * 100
                                return pct > 0 ? (
                                    <div key={tier} 
                                         className={`h-full bg-gradient-to-r ${TIER_BAR[tier] || 'from-gray-400 to-gray-500'} transition-all hover:brightness-110 cursor-help`}
                                         style={{ width: `${pct}%` }}
                                         title={`${tier}: ${count} (${Math.round(pct)}%)`}
                                    />
                                ) : null
                            })}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* Recent signups */}
                    <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                            <h2 className="text-[1.15rem] font-bold text-ink flex items-center gap-2">
                                <Users size={18} className="text-emerald-500" /> Recent Signups
                            </h2>
                            <Link href="/admin/super-admin/restaurants" className="p-1.5 text-ink-subtle hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                <ArrowRight size={18} />
                            </Link>
                        </div>
                        <div className="divide-y divide-gray-50 p-2">
                            {metrics.recentTenants.length === 0 ? (
                                <div className="p-8 text-center text-ink-subtle">
                                    <Building2 size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-[14px] font-medium">No tenants yet</p>
                                </div>
                            ) : metrics.recentTenants.map(r => (
                                <div key={r.id} className="flex items-center gap-3 p-3 hover:bg-surface-muted rounded-xl transition-colors">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-100 flex items-center justify-center shrink-0">
                                        <Building2 size={18} className="text-indigo-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[14px] font-bold text-ink truncate">{r.name}</p>
                                        <p className="text-[12px] text-ink-subtle font-medium">Joined {new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md border uppercase tracking-wider ${TIER_BADGE[r.subscription_tier] || TIER_BADGE.free}`}>
                                        {r.subscription_tier}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Quick Actions Grid */}
                    <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <h3 className="text-[1.15rem] font-bold text-ink mb-5 flex items-center gap-2">
                            <Settings size={18} className="text-ink-subtle" /> Quick Tools
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            <QuickAction href="/admin/super-admin/restaurants" icon={Building2} label="Tenants" />
                            <QuickAction href="/admin/super-admin/analytics" icon={Activity} label="Analytics" />
                            <QuickAction href="/admin/super-admin/payments" icon={CreditCard} label="Payments" />
                            <QuickAction href="/admin/super-admin/reports" icon={FileText} label="Reports" />
                        </div>
                        <Link href="/admin/super-admin/config" className="mt-3 group relative flex items-center justify-center gap-2 w-full p-4 rounded-[16px] bg-surface-muted hover:bg-surface-muted border border-transparent hover:border-hairline-strong transition-all duration-300">
                            <Settings size={18} className="text-ink-subtle group-hover:text-ink transition-colors" />
                            <span className="text-[13px] font-bold text-ink-muted group-hover:text-ink">Platform Configuration</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}

function KpiCard({ title, value, icon: Icon, color }: { title: string, value: number | string, icon: any, color: 'indigo' | 'emerald' | 'red' | 'blue' | 'amber' | 'green' | 'purple' }) {
    const colors = {
        indigo: 'from-indigo-500 to-violet-500 text-indigo-500 bg-indigo-50',
        emerald: 'from-emerald-500 to-teal-500 text-emerald-500 bg-emerald-50',
        red: 'from-red-500 to-rose-500 text-red-500 bg-red-50',
        blue: 'from-blue-500 to-cyan-500 text-blue-500 bg-blue-50',
        amber: 'from-amber-400 to-orange-500 text-amber-500 bg-amber-50',
        green: 'from-green-500 to-emerald-500 text-green-500 bg-green-50',
        purple: 'from-purple-500 to-fuchsia-500 text-purple-500 bg-purple-50'
    }
    const c = colors[color] || colors.indigo

    return (
        <div className="group relative bg-surface rounded-[24px] p-6 border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1 overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${c.split(' ')[0]} ${c.split(' ')[1]} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
            
            <div className="flex flex-col h-full justify-between">
                <div className={`w-12 h-12 rounded-[16px] flex items-center justify-center ${c.split(' ')[2]} ${c.split(' ')[3]} group-hover:scale-110 transition-transform duration-300 mb-4`}>
                    <Icon size={24} />
                </div>
                <div>
                    <h3 className="text-ink-subtle text-[13px] font-semibold uppercase tracking-wider mb-1">{title}</h3>
                    <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight tabular-nums truncate">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>
                </div>
            </div>
        </div>
    )
}

function QuickAction({ href, icon: Icon, label }: { href: string, icon: any, label: string }) {
    return (
        <Link href={href} className="group relative flex flex-col items-center justify-center gap-3 p-4 rounded-[16px] bg-surface-muted hover:bg-indigo-50/50 border border-transparent hover:border-indigo-100 transition-all duration-300 hover:scale-[1.02]">
            <div className="text-ink-subtle group-hover:text-indigo-600 transition-colors">
                <Icon size={24} />
            </div>
            <span className="text-[13px] font-bold text-ink-muted group-hover:text-indigo-900">{label}</span>
        </Link>
    )
}
