import { requireRole } from '@/lib/auth'
import { getDashboardSnapshot } from '../actions'
import {
    Building2, CheckCircle2, AlertTriangle, DollarSign,
    ShoppingCart, Users, CreditCard, BarChart3,
    Settings, FileText, Store, Zap, Clock,
    ArrowRight, TrendingUp, Crown,
} from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

// ─── colour maps ────────────────────────────────────────────────────────────

const TIER_DOT: Record<string, string> = {
    free:       'bg-slate-400',
    basic:      'bg-blue-500',
    premium:    'bg-purple-500',
    platinum:   'bg-amber-500',
    enterprise: 'bg-emerald-500',
}
const TIER_PILL: Record<string, string> = {
    free:       'bg-slate-100 text-slate-600',
    basic:      'bg-blue-100 text-blue-700',
    premium:    'bg-purple-100 text-purple-700',
    platinum:   'bg-amber-100 text-amber-700',
    enterprise: 'bg-emerald-100 text-emerald-700',
}
const METHOD_ICON: Record<string, string> = {
    esewa:   '#60BB46',
    khalti:  '#5C2D91',
    fonepay: '#1565C0',
    bank:    '#64748b',
}

// ─── page ───────────────────────────────────────────────────────────────────

export default async function SuperAdminDashboardPage() {
    await requireRole('super_admin')
    const d = await getDashboardSnapshot()

    const pendingCount = d.pendingPayments.length
    const alertCount   = pendingCount + d.expiring14.length

    // Revenue sparkline
    const months      = Object.keys(d.revenueByMonth).sort()
    const monthVals   = months.map(m => d.revenueByMonth[m])
    const maxMonthVal = Math.max(...monthVals, 1)

    // Conversion rate
    const conversion  = d.total > 0 ? Math.round((d.paidTenants / d.total) * 100) : 0

    return (
        <div className="space-y-5 max-w-[1440px] mx-auto pb-14">

            {/* ── Page title ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between pt-1">
                <div>
                    <h1 className="text-[1.4rem] font-extrabold text-ink tracking-tight flex items-center gap-2">
                        <Crown size={20} className="text-amber-500" /> Platform Overview
                    </h1>
                    <p className="text-sm text-ink-subtle mt-0.5">KKKhane · SaaS operations</p>
                </div>
                <Link
                    href="/admin/super-admin/restaurants"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-ink text-surface text-sm font-bold hover:bg-ink/80 transition-colors"
                >
                    Manage Tenants <ArrowRight size={15} />
                </Link>
            </div>

            {/* ── Action-required banner ─────────────────────────────────── */}
            {alertCount > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap gap-4 items-start">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 space-y-1">
                        {pendingCount > 0 && (
                            <p className="text-sm font-semibold text-amber-800">
                                {pendingCount} payment{pendingCount > 1 ? 's' : ''} waiting for approval —
                                {d.pendingPayments.slice(0, 3).map(p => (
                                    <span key={p.id} className="mx-1 font-bold text-amber-900">
                                        {p.restaurants?.name ?? '?'}
                                    </span>
                                ))}
                                {pendingCount > 3 && <span className="text-amber-700">+{pendingCount - 3} more</span>}
                            </p>
                        )}
                        {d.expiring14.length > 0 && (
                            <p className="text-sm text-amber-700">
                                {d.expiring14.length} tenant{d.expiring14.length > 1 ? 's' : ''} expiring within 14 days
                            </p>
                        )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                        {pendingCount > 0 && (
                            <Link href="/admin/super-admin/payments"
                                  className="px-4 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-colors">
                                Approve now
                            </Link>
                        )}
                    </div>
                </div>
            )}

            {/* ── 4 hero KPIs ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                    label="Revenue (30d)"
                    value={`Rs. ${fmtN(d.mrr30)}`}
                    sub={`${d.paidTenants} paid tenants · ${conversion}% conversion`}
                    icon={DollarSign}
                    accent="emerald"
                />
                <KpiCard
                    label="Active Tenants"
                    value={String(d.active)}
                    sub={`${d.total} total · ${d.suspended} suspended`}
                    icon={Building2}
                    accent="blue"
                />
                <KpiCard
                    label="GMV (30d)"
                    value={`Rs. ${fmtN(d.gmv30)}`}
                    sub="total order revenue across all tenants"
                    icon={ShoppingCart}
                    accent="indigo"
                />
                <KpiCard
                    label="Pending Approvals"
                    value={String(pendingCount)}
                    sub={pendingCount === 0 ? 'All payments processed' : 'Tap to review'}
                    icon={CreditCard}
                    accent={pendingCount > 0 ? 'amber' : 'slate'}
                    href="/admin/super-admin/payments"
                    urgent={pendingCount > 0}
                />
            </div>

            {/* ── Main 2-col layout ─────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">

                {/* Left column */}
                <div className="space-y-5">

                    {/* Revenue trend sparkline */}
                    <Panel>
                        <PanelHeader
                            icon={<TrendingUp size={15} className="text-emerald-600" />}
                            title="Revenue Trend"
                            sub="Approved subscription payments · last 6 months"
                        />
                        <div className="flex items-end gap-2 h-24 mt-4 px-1">
                            {months.map((m, i) => {
                                const val = monthVals[i]
                                const pct = maxMonthVal > 0 ? (val / maxMonthVal) * 100 : 0
                                const isLatest = i === months.length - 1
                                return (
                                    <div key={m} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                                        <span className="text-[10px] font-bold text-ink-subtle tabular-nums hidden sm:block">
                                            {val > 0 ? `${Math.round(val / 1000)}k` : '—'}
                                        </span>
                                        <div className="w-full relative flex items-end" style={{ height: '60px' }}>
                                            <div
                                                className={`w-full rounded-t-lg transition-all ${isLatest ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                                                style={{ height: `${Math.max(pct, val > 0 ? 4 : 0)}%` }}
                                            />
                                        </div>
                                        <span className="text-[10px] text-ink-subtle truncate w-full text-center font-medium">
                                            {shortMonth(m)}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    </Panel>

                    {/* Top tenants */}
                    <Panel>
                        <PanelHeader
                            icon={<BarChart3 size={15} className="text-indigo-600" />}
                            title="Top Tenants by Revenue"
                            sub="Order GMV · last 30 days"
                            action={{ label: 'All analytics', href: '/admin/super-admin/analytics' }}
                        />
                        {d.topTenants.length === 0 ? (
                            <EmptyState icon={ShoppingCart} label="No order data yet" />
                        ) : (
                            <div className="divide-y divide-hairline mt-1">
                                {d.topTenants.map((t, i) => (
                                    <div key={t.id} className="flex items-center gap-3 py-3">
                                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 ${
                                            i === 0 ? 'bg-amber-100 text-amber-700' :
                                            i === 1 ? 'bg-slate-100 text-slate-600' :
                                            i === 2 ? 'bg-orange-100 text-orange-600' :
                                            'bg-surface-muted text-ink-subtle'
                                        }`}>
                                            {i + 1}
                                        </span>
                                        <span className="flex-1 text-sm font-semibold text-ink truncate">{t.name}</span>
                                        <span className="text-xs text-ink-subtle tabular-nums">{t.count} orders</span>
                                        <span className="text-sm font-bold text-ink tabular-nums w-28 text-right">
                                            Rs.&nbsp;{fmtN(t.revenue)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Panel>

                    {/* Pending approvals detail */}
                    {pendingCount > 0 && (
                        <Panel>
                            <PanelHeader
                                icon={<Clock size={15} className="text-amber-600" />}
                                title="Pending Payments"
                                action={{ label: 'Approve all', href: '/admin/super-admin/payments' }}
                            />
                            <div className="divide-y divide-hairline mt-1">
                                {d.pendingPayments.slice(0, 5).map(p => (
                                    <div key={p.id} className="flex items-center gap-3 py-3">
                                        <span
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: METHOD_ICON[p.payment_method] ?? '#94a3b8' }}
                                        />
                                        <span className="flex-1 text-sm font-semibold text-ink truncate">
                                            {p.restaurants?.name ?? '—'}
                                        </span>
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TIER_PILL[p.plan_tier ?? 'basic'] ?? TIER_PILL.basic}`}>
                                            {p.plan_tier ?? '?'}
                                        </span>
                                        <span className="text-sm font-bold text-ink tabular-nums">
                                            Rs.&nbsp;{fmtN(p.amount)}
                                        </span>
                                    </div>
                                ))}
                                {pendingCount > 5 && (
                                    <p className="text-xs text-ink-subtle py-2 text-center">
                                        +{pendingCount - 5} more
                                    </p>
                                )}
                            </div>
                        </Panel>
                    )}
                </div>

                {/* Right column */}
                <div className="space-y-5">

                    {/* Tier distribution */}
                    <Panel>
                        <PanelHeader
                            icon={<Crown size={15} className="text-amber-500" />}
                            title="Tier Distribution"
                            sub={`${d.total} tenants`}
                        />
                        <div className="mt-4 space-y-2.5">
                            {(['enterprise', 'platinum', 'premium', 'basic', 'free'] as const).map(tier => {
                                const count = d.tierCounts[tier] ?? 0
                                const pct   = d.total > 0 ? (count / d.total) * 100 : 0
                                return (
                                    <div key={tier} className="flex items-center gap-3">
                                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TIER_DOT[tier]}`} />
                                        <span className="text-xs font-semibold text-ink capitalize w-16">{tier}</span>
                                        <div className="flex-1 h-1.5 bg-surface-muted rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${TIER_DOT[tier]}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-bold text-ink tabular-nums w-5 text-right">{count}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </Panel>

                    {/* Expiring soon */}
                    {d.expiring14.length > 0 && (
                        <Panel>
                            <PanelHeader
                                icon={<AlertTriangle size={15} className="text-amber-500" />}
                                title="Expiring Soon"
                                sub="Within 14 days"
                            />
                            <div className="mt-2 space-y-2">
                                {d.expiring14.map(r => {
                                    const daysLeft = Math.ceil((new Date(r.subscription_expires_at).getTime() - Date.now()) / 86400000)
                                    return (
                                        <div key={r.id} className="flex items-center justify-between text-sm py-1.5">
                                            <span className="font-medium text-ink truncate flex-1 mr-2">{r.name}</span>
                                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${daysLeft <= 3 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                                {daysLeft}d
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </Panel>
                    )}

                    {/* Recent signups */}
                    <Panel>
                        <PanelHeader
                            icon={<Users size={15} className="text-blue-600" />}
                            title="Recent Signups"
                            action={{ label: 'All', href: '/admin/super-admin/restaurants' }}
                        />
                        <div className="mt-2 divide-y divide-hairline">
                            {d.recentTenants.map(r => (
                                <div key={r.id} className="flex items-center gap-2.5 py-2.5">
                                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                                        <Store size={13} className="text-blue-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-ink truncate">{r.name}</p>
                                        <p className="text-[11px] text-ink-subtle">
                                            {new Date(r.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${TIER_PILL[r.subscription_tier] ?? TIER_PILL.free}`}>
                                        {r.subscription_tier}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Panel>
                </div>
            </div>

            {/* ── Navigation hub ────────────────────────────────────────── */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {(
                    [
                        { href: '/admin/super-admin/restaurants', icon: Building2,  label: 'Tenants',   color: 'text-blue-600    bg-blue-50'   },
                        { href: '/admin/super-admin/payments',    icon: CreditCard, label: 'Payments',  color: 'text-emerald-600 bg-emerald-50', badge: pendingCount > 0 ? pendingCount : 0 },
                        { href: '/admin/super-admin/analytics',   icon: BarChart3,  label: 'Analytics', color: 'text-indigo-600  bg-indigo-50'  },
                        { href: '/admin/super-admin/reports',     icon: FileText,   label: 'Reports',   color: 'text-purple-600  bg-purple-50'  },
                        { href: '/admin/super-admin/config',      icon: Settings,   label: 'Config',    color: 'text-slate-600   bg-slate-100'  },
                        { href: '/admin/super-admin/staff',       icon: Users,      label: 'Staff',     color: 'text-rose-600    bg-rose-50'    },
                    ] as Array<{
                        href: string
                        icon: React.ComponentType<{ size: number; className?: string }>
                        label: string
                        color: string
                        badge?: number
                    }>
                ).map(item => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className="relative flex flex-col items-center gap-2 p-4 rounded-2xl bg-surface border border-hairline hover:border-hairline-strong shadow-[0_2px_8px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgb(0,0,0,0.08)] transition-all group"
                    >
                        {!!item.badge && (
                            <span className="absolute top-2 right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-extrabold px-1">
                                {item.badge}
                            </span>
                        )}
                        <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.color}`}>
                            <item.icon size={18} />
                        </span>
                        <span className="text-xs font-bold text-ink-muted group-hover:text-ink transition-colors">{item.label}</span>
                    </Link>
                ))}
            </div>
        </div>
    )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtN(n: number): string {
    if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`
    if (n >= 1_000)   return `${(n / 1_000).toFixed(1)}k`
    return n.toLocaleString()
}

function shortMonth(iso: string): string {
    const [y, m] = iso.split('-')
    return new Date(Number(y), Number(m) - 1).toLocaleString('en-US', { month: 'short' })
}

// ─── sub-components ─────────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-surface rounded-2xl border border-hairline shadow-[0_2px_12px_rgb(0,0,0,0.04)] p-5">
            {children}
        </div>
    )
}

function PanelHeader({
    icon, title, sub, action,
}: {
    icon: React.ReactNode
    title: string
    sub?: string
    action?: { label: string; href: string }
}) {
    return (
        <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
                {icon}
                <div>
                    <p className="text-sm font-bold text-ink leading-tight">{title}</p>
                    {sub && <p className="text-[11px] text-ink-subtle mt-0.5">{sub}</p>}
                </div>
            </div>
            {action && (
                <Link href={action.href}
                      className="text-[11px] font-bold text-[var(--color-primary)] hover:opacity-70 transition-opacity shrink-0 flex items-center gap-1">
                    {action.label} <ArrowRight size={11} />
                </Link>
            )}
        </div>
    )
}

function EmptyState({ icon: Icon, label }: { icon: React.ComponentType<{ size: number; className?: string }>; label: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-ink-subtle">
            <Icon size={28} className="opacity-20" />
            <p className="text-xs font-medium">{label}</p>
        </div>
    )
}

type AccentColor = 'emerald' | 'blue' | 'indigo' | 'amber' | 'slate'

function KpiCard({
    label, value, sub, icon: Icon, accent, href, urgent,
}: {
    label:   string
    value:   string
    sub?:    string
    icon:    React.ComponentType<{ size: number; className?: string }>
    accent:  AccentColor
    href?:   string
    urgent?: boolean
}) {
    const colors: Record<AccentColor, { icon: string; bg: string; border: string }> = {
        emerald: { icon: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-hairline'         },
        blue:    { icon: 'text-blue-600',    bg: 'bg-blue-50',     border: 'border-hairline'         },
        indigo:  { icon: 'text-indigo-600',  bg: 'bg-indigo-50',   border: 'border-hairline'         },
        amber:   { icon: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200'        },
        slate:   { icon: 'text-slate-500',   bg: 'bg-slate-50',    border: 'border-hairline'         },
    }
    const c = colors[accent]

    const inner = (
        <div className={`relative rounded-2xl border ${urgent ? 'border-amber-200 bg-amber-50' : `bg-surface ${c.border}`} shadow-[0_2px_8px_rgb(0,0,0,0.04)] p-5 flex flex-col gap-3 h-full`}>
            <div className="flex items-center justify-between">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.bg}`}>
                    <Icon size={17} className={c.icon} />
                </span>
                {href && <ArrowRight size={14} className="text-ink-subtle" />}
            </div>
            <div>
                <p className="text-[1.5rem] font-extrabold text-ink tracking-tight leading-none tabular-nums">{value}</p>
                <p className="text-[11px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">{label}</p>
                {sub && <p className="text-[11px] text-ink-subtle mt-1 leading-tight">{sub}</p>}
            </div>
        </div>
    )

    if (href) return <Link href={href} className="block h-full hover:opacity-90 transition-opacity">{inner}</Link>
    return inner
}
