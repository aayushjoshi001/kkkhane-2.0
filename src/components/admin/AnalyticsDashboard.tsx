'use client'

import { useState } from 'react'
import StatCard from '@/components/ui/StatCard'
import { TrendingUp, ShoppingBag, BarChart3, Star, XCircle, Trophy, Clock, ArrowUp, ArrowDown, Minus, Truck } from 'lucide-react'

interface DayBucket {
    date: string; label: string; dayNum: number; monthStr: string; revenue: number; orders: number
}
interface TopItem { name: string; count: number; revenue: number }
interface CancelledOrder { id: string; note: string | null; placed_at: string; total: number }
interface TopSupplier { name: string; amount: number }

interface Props {
    daily: DayBucket[]
    hourly: { hour: number; orders: number }[]
    topItems: TopItem[]
    cancelled: CancelledOrder[]
    kpis: {
        rev7d: number; ord7d: number; aov7d: number
        rev30d: number; ord30d: number; aov30d: number
        prevRev7d: number; prevOrd7d: number
        prevRev30d: number; prevOrd30d: number
        avgRating: number | null; ratingCount: number
    }
    ratingCounts: { star: number; count: number }[]
    topComments: { comment: string; rating: number; created_at: string }[]
    topSuppliers: TopSupplier[]
}

function fmt(n: number) {
    if (n >= 1_000_000) return `Rs. ${(n / 1_000_000).toFixed(1)}M`
    if (n >= 100_000) return `Rs. ${(n / 1000).toFixed(0)}k`
    if (n >= 10_000) return `Rs. ${(n / 1000).toFixed(1)}k`
    return `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(n))}`
}

function trendInfo(cur: number, prev: number) {
    if (prev === 0 && cur === 0) return { txt: '—', cls: 'text-ink-subtle bg-surface-muted', Icon: Minus }
    if (prev === 0) return { txt: 'New', cls: 'text-emerald-700 bg-emerald-50', Icon: ArrowUp }
    const p = ((cur - prev) / prev) * 100
    const up = p >= 0
    return {
        txt: `${up ? '+' : ''}${p.toFixed(1)}%`,
        cls: up ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50',
        Icon: up ? ArrowUp : ArrowDown,
    }
}

function BarChart({ data, color, fmtVal }: {
    data: { date: string; label: string; dayNum: number; monthStr: string; value: number }[]
    color: string
    fmtVal: (n: number) => string
}) {
    const [hovered, setHovered] = useState<number | null>(null)
    const max = Math.max(...data.map(d => d.value), 1)
    const is30 = data.length > 10

    return (
        <div>
            <div
                className="flex items-end h-44"
                style={{ gap: is30 ? '2px' : '5px' }}
            >
                {data.map((d, i) => {
                    const pct = max > 0 ? (d.value / max) * 100 : 0
                    const empty = d.value === 0
                    return (
                        <div
                            key={d.date}
                            className="flex-1 flex flex-col justify-end h-full relative"
                            onMouseEnter={() => setHovered(i)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            {hovered === i && (
                                <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 bg-ink text-white text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap shadow-lg pointer-events-none">
                                    <div>{fmtVal(d.value)}</div>
                                    <div className="text-ink-subtle">{d.dayNum} {d.monthStr}</div>
                                </div>
                            )}
                            <div
                                className="w-full rounded-t-sm transition-opacity"
                                style={{
                                    height: empty ? '3px' : `${Math.max(pct, 1)}%`,
                                    backgroundColor: empty ? '#e5e7eb' : color,
                                    opacity: empty ? 0.4 : hovered === i ? 1 : 0.82,
                                }}
                            />
                        </div>
                    )
                })}
            </div>
            <div
                className="flex mt-1.5"
                style={{ gap: is30 ? '2px' : '5px' }}
            >
                {data.map((d, i) => {
                    const showLabel = is30
                        ? (i === 0 || i === 14 || i === data.length - 1)
                        : true
                    return (
                        <div key={d.date} className="flex-1 text-center overflow-hidden">
                            {showLabel && (
                                <span className="text-[9px] text-ink-subtle block truncate leading-tight">
                                    {is30 ? `${d.dayNum} ${d.monthStr}` : d.label}
                                </span>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

const HOUR_LABELS: Record<number, string> = {
    6: '6am', 7: '7am', 8: '8am', 9: '9am', 10: '10am', 11: '11am',
    12: '12pm', 13: '1pm', 14: '2pm', 15: '3pm', 16: '4pm', 17: '5pm',
    18: '6pm', 19: '7pm', 20: '8pm', 21: '9pm', 22: '10pm', 23: '11pm',
}

export default function AnalyticsDashboard({ daily, hourly, topItems, cancelled, kpis, ratingCounts, topComments, topSuppliers }: Props) {
    const [period, setPeriod] = useState<'7d' | '30d'>('7d')
    const [chartMetric, setChartMetric] = useState<'revenue' | 'orders'>('revenue')

    const days = period === '7d' ? daily.slice(-7) : daily
    const rev = period === '7d' ? kpis.rev7d : kpis.rev30d
    const ord = period === '7d' ? kpis.ord7d : kpis.ord30d
    const aov = period === '7d' ? kpis.aov7d : kpis.aov30d
    const prevRev = period === '7d' ? kpis.prevRev7d : kpis.prevRev30d
    const prevOrd = period === '7d' ? kpis.prevOrd7d : kpis.prevOrd30d
    const prevAov = prevOrd > 0 ? prevRev / prevOrd : 0

    const revTrend = trendInfo(rev, prevRev)
    const ordTrend = trendInfo(ord, prevOrd)
    const aovTrend = trendInfo(aov, prevAov)

    const chartData = days.map(d => ({
        date: d.date,
        label: d.label,
        dayNum: d.dayNum,
        monthStr: d.monthStr,
        value: chartMetric === 'revenue' ? d.revenue : d.orders,
    }))

    const peakHours = hourly.filter(h => h.hour >= 6 && h.hour <= 23)
    const maxHourOrders = Math.max(...peakHours.map(h => h.orders), 1)
    const maxItemCount = topItems[0]?.count ?? 1
    const maxSupplierAmount = topSuppliers[0]?.amount ?? 1

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
                <div>
                    <h1 className="text-h2 font-extrabold text-ink">Analytics</h1>
                    <p className="text-ink-subtle font-medium mt-1">Revenue, trends & insights</p>
                </div>
                <div className="flex items-center bg-surface-muted rounded-[var(--r-md)] p-1 gap-1 border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                    {(['7d', '30d'] as const).map(p => (
                        <button
                            key={p}
                            onClick={() => setPeriod(p)}
                            className={`px-5 py-2 rounded-md text-xs font-bold transition-all focus-ring ${period === p ? 'bg-surface text-ink shadow-[0_2px_8px_rgba(0,0,0,0.08)]' : 'text-ink-subtle hover:text-ink hover:bg-surface/50'}`}
                        >
                            {p === '7d' ? 'Last 7 days' : 'Last 30 days'}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    label="Revenue"
                    value={fmt(rev)}
                    delta={revTrend.txt !== '—' && revTrend.txt !== 'New' ? parseFloat(revTrend.txt) : undefined}
                    icon={TrendingUp}
                    tone="brand"
                />
                <StatCard
                    label="Orders"
                    value={String(ord)}
                    delta={ordTrend.txt !== '—' && ordTrend.txt !== 'New' ? parseFloat(ordTrend.txt) : undefined}
                    icon={ShoppingBag}
                    tone="success"
                />
                <StatCard
                    label="Avg Order Value"
                    value={fmt(aov)}
                    delta={aovTrend.txt !== '—' && aovTrend.txt !== 'New' ? parseFloat(aovTrend.txt) : undefined}
                    icon={BarChart3}
                    tone="info"
                />
                <StatCard
                    label="Avg Rating"
                    value={kpis.avgRating !== null ? `★ ${kpis.avgRating.toFixed(1)}` : '—'}
                    hint={`${kpis.ratingCount} reviews`}
                    icon={Star}
                    tone="warning"
                />
            </div>

            {/* Main chart */}
            <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] p-6">
                <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                    <h2 className="font-extrabold text-ink text-base">
                        {chartMetric === 'revenue' ? 'Revenue' : 'Order Count'}
                        <span className="text-ink-subtle font-medium ml-2 text-xs">
                            {period === '7d' ? 'last 7 days' : 'last 30 days'}
                        </span>
                    </h2>
                    <div className="flex items-center bg-surface-muted rounded-[var(--r-md)] p-1 gap-1 border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                        {(['revenue', 'orders'] as const).map(m => (
                            <button
                                key={m}
                                onClick={() => setChartMetric(m)}
                                className={`px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider transition-all capitalize focus-ring ${chartMetric === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-subtle hover:text-ink hover:bg-surface/50'}`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                </div>
                <BarChart
                    data={chartData}
                    color={chartMetric === 'revenue' ? '#FB6303' : '#10b981'}
                    fmtVal={chartMetric === 'revenue' ? fmt : (n) => String(n)}
                />
            </div>

            {/* Rush hour + Top items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Rush hour heatmap */}
                <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] p-6">
                    <div className="flex items-center gap-2 mb-6 border-b border-hairline pb-4">
                        <div className="w-8 h-8 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center">
                            <Clock size={16} className="text-brand-600" />
                        </div>
                        <h2 className="font-extrabold text-ink text-base">Rush Hours</h2>
                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider ml-auto">last 30 days</span>
                    </div>
                    <div className="grid grid-cols-6 gap-1.5">
                        {peakHours.map(h => {
                            const intensity = maxHourOrders > 0 ? h.orders / maxHourOrders : 0
                            const bg = intensity < 0.05
                                ? '#f3f4f6'
                                : `rgba(232, 93, 4, ${0.1 + intensity * 0.82})`
                            const textColor = intensity > 0.55
                                ? 'white'
                                : intensity > 0.15
                                    ? '#FB6303'
                                    : '#9ca3af'
                            return (
                                <div key={h.hour} className="flex flex-col items-center gap-1">
                                    <div
                                        className="w-full h-9 rounded-xl flex items-center justify-center text-[10px] font-bold transition-all"
                                        style={{ backgroundColor: bg, color: textColor }}
                                        title={`${h.orders} orders`}
                                    >
                                        {h.orders > 0 ? h.orders : ''}
                                    </div>
                                    <span className="text-[9px] text-ink-subtle leading-none">{HOUR_LABELS[h.hour]}</span>
                                </div>
                            )
                        })}
                    </div>
                    {maxHourOrders <= 0 && (
                        <p className="text-sm text-ink-subtle text-center py-4 mt-2">No order data yet.</p>
                    )}
                    {maxHourOrders > 0 && (
                        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-hairline">
                            <div className="flex items-center gap-1">
                                {[0.1, 0.35, 0.6, 0.85, 1].map((v, i) => (
                                    <div
                                        key={i}
                                        className="w-4 h-2 rounded-sm"
                                        style={{ backgroundColor: `rgba(232, 93, 4, ${0.1 + v * 0.82})` }}
                                    />
                                ))}
                            </div>
                            <span className="text-[10px] text-ink-subtle">Low → Peak</span>
                        </div>
                    )}
                </div>

                {/* Top items */}
                <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] p-6">
                    <div className="flex items-center gap-2 mb-6 border-b border-hairline pb-4">
                        <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                            <Trophy size={16} className="text-amber-600" />
                        </div>
                        <h2 className="font-extrabold text-ink text-base">Most Ordered</h2>
                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider ml-auto">last 30 days</span>
                    </div>
                    {topItems.length === 0 ? (
                        <p className="text-sm text-ink-subtle text-center py-6">No order data yet.</p>
                    ) : (
                        <div className="space-y-3">
                            {topItems.map((item, i) => (
                                <div key={item.name}>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm shrink-0">
                                                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (
                                                    <span className="text-[10px] font-bold text-ink-subtle w-4 text-center inline-block">{i + 1}</span>
                                                )}
                                            </span>
                                            <span className="text-sm text-ink font-medium truncate">{item.name}</span>
                                        </div>
                                        <span className="text-xs text-ink-muted shrink-0 ml-2 tabular-nums">{item.count}×</span>
                                    </div>
                                    <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-amber-400 transition-all duration-500"
                                            style={{ width: `${(item.count / maxItemCount) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Top suppliers by spend */}
            <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] p-6">
                <div className="flex items-center gap-2 mb-6 border-b border-hairline pb-4">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                        <Truck size={16} className="text-indigo-600" />
                    </div>
                    <h2 className="font-extrabold text-ink text-base">Top Suppliers by Spend</h2>
                    <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider ml-auto">last 30 days</span>
                </div>
                {topSuppliers.length === 0 ? (
                    <p className="text-sm text-ink-subtle text-center py-6">No supplier spend recorded yet.</p>
                ) : (
                    <div className="space-y-3">
                        {topSuppliers.map((s, i) => (
                            <div key={s.name}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[10px] font-bold text-ink-subtle w-4 text-center inline-block shrink-0">{i + 1}</span>
                                        <span className="text-sm text-ink font-medium truncate">{s.name}</span>
                                    </div>
                                    <span className="text-xs text-ink-muted shrink-0 ml-2 tabular-nums">{fmt(s.amount)}</span>
                                </div>
                                <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-indigo-400 transition-all duration-500"
                                        style={{ width: `${(s.amount / maxSupplierAmount) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Cancelled orders */}
            <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden">
                <div className="px-6 py-5 border-b border-hairline flex items-center gap-2 bg-surface-muted/30">
                    <div className="w-8 h-8 rounded-full bg-danger-bg/20 border border-danger-bg flex items-center justify-center">
                        <XCircle size={16} className="text-danger-fg" />
                    </div>
                    <h2 className="font-extrabold text-ink text-base">Cancelled Orders</h2>
                    <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider ml-auto">{cancelled.length} in last 30 days</span>
                </div>
                {cancelled.length === 0 ? (
                    <div className="px-5 py-10 text-center text-sm text-ink-subtle">
                        No cancellations in the last 30 days — great work!
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {cancelled.slice(0, 10).map(c => (
                            <div key={c.id} className="px-5 py-3 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-red-50 border border-red-100 flex items-center justify-center shrink-0 mt-0.5">
                                    <XCircle size={13} className="text-red-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-mono text-ink-muted uppercase">
                                            #{c.id.substring(0, 8)}
                                        </span>
                                        <span className="text-[10px] text-ink-subtle">
                                            {new Date(c.placed_at).toLocaleDateString('en-IN', {
                                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                            })}
                                        </span>
                                    </div>
                                    {c.note ? (
                                        <p className="text-sm text-ink mt-0.5">&quot;{c.note}&quot;</p>
                                    ) : (
                                        <p className="text-xs text-ink-subtle mt-0.5 italic">No reason provided</p>
                                    )}
                                </div>
                                <span className="text-sm font-semibold text-ink shrink-0 tabular-nums">{fmt(c.total)}</span>
                            </div>
                        ))}
                        {cancelled.length > 10 && (
                            <div className="px-5 py-2.5 text-xs text-ink-subtle text-center">
                                +{cancelled.length - 10} more cancellations
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Customer feedback */}
            {kpis.ratingCount > 0 && (
                <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] overflow-hidden">
                    <div className="px-6 py-5 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                                <Star size={16} className="text-amber-500" />
                            </div>
                            <h2 className="font-extrabold text-ink text-base">Customer Feedback</h2>
                        </div>
                        {kpis.avgRating !== null && (
                            <span className="text-xs text-amber-600 font-semibold">
                                ★ {kpis.avgRating.toFixed(1)} · {kpis.ratingCount} reviews
                            </span>
                        )}
                    </div>
                    <div className="p-6 grid md:grid-cols-2 gap-8">
                        <div>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-4">Rating Breakdown</p>
                            <div className="space-y-3">
                                {ratingCounts.slice().reverse().map(({ star, count }) => {
                                    const pct = kpis.ratingCount > 0 ? Math.round((count / kpis.ratingCount) * 100) : 0
                                    return (
                                        <div key={star} className="flex items-center gap-2">
                                            <span className="text-xs w-4 text-right text-ink-muted font-medium">{star}</span>
                                            <span className="text-amber-400 text-xs">★</span>
                                            <div className="flex-1 bg-surface-muted rounded-full h-2">
                                                <div
                                                    className="bg-amber-400 h-2 rounded-full transition-all"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-ink-subtle w-6 text-right tabular-nums">{count}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-4">Recent Comments</p>
                            {topComments.length === 0 ? (
                                <p className="text-sm font-bold italic text-ink-subtle">No comments yet.</p>
                            ) : (
                                <ul className="space-y-4">
                                    {topComments.map((f, i) => (
                                        <li key={i} className="border-l-2 border-amber-200 pl-3">
                                            <p className="text-sm text-ink">&quot;{f.comment}&quot;</p>
                                            <p className="text-[10px] text-ink-subtle mt-0.5">
                                                {'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}
                                                {' · '}{new Date(f.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
