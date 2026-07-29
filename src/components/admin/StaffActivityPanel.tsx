'use client'

import { useCallback, useEffect, useState } from 'react'
import {
    Loader2, TrendingUp, Wallet, Utensils, ChefHat, Percent, XCircle, Info, ChevronDown, ChevronUp,
} from 'lucide-react'
import { fetchStaffActivity } from '@/app/(admin)/admin/staff/activity-actions'
import type { StaffActivity } from '@/lib/staffActivity'
import EmptyState from '@/components/ui/EmptyState'

const money = (amount: number) =>
    'Rs. ' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Today in Kathmandu — the day a manager means when they open this. */
const todayInNepal = () =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' })

/** "Tue 29 Jul", with today and yesterday named — a manager scanning a fortnight
 *  needs to find the recent days without counting back from a date. */
const formatDayLabel = (day: string) => {
    const today = todayInNepal()
    if (day === today) return 'Today'
    const yesterday = new Date(`${today}T00:00:00+05:45`)
    yesterday.setDate(yesterday.getDate() - 1)
    if (day === yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' })) return 'Yesterday'
    return new Date(`${day}T00:00:00+05:45`).toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kathmandu', weekday: 'short', day: 'numeric', month: 'short',
    })
}

const shiftDay = (day: string, delta: number) => {
    const d = new Date(`${day}T00:00:00+05:45`)
    d.setDate(d.getDate() + delta)
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' })
}

/** Quick ranges, because "today" and "this week" are 90% of what gets asked. */
const PRESETS = [
    { label: 'Today', days: 0 },
    { label: 'Last 7 days', days: 6 },
    { label: 'Last 30 days', days: 29 },
] as const

/**
 * Who did what, per person, over a day or a range.
 *
 * Deliberately reports rather than judges: it shows counts and totals and does
 * not rank anyone as good or bad. A waiter with few orders may have been on the
 * quiet floor all evening, and the number that would "prove" otherwise isn't in
 * this data.
 */
export default function StaffActivityPanel() {
    // Opens on the last week rather than today alone: the point of the panel is
    // the day-by-day breakdown, and a single day has nothing to break down.
    const [from, setFrom] = useState(() => shiftDay(todayInNepal(), -6))
    const [to, setTo] = useState(todayInNepal)
    const [rows, setRows] = useState<StaffActivity[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState<string | null>(null)

    // The load is a callback rather than an inline effect body so the state
    // writes happen inside it — mirrors `resync` in the kitchen board.
    const load = useCallback(async (signal: { cancelled: boolean }) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetchStaffActivity(from, to)
            if (signal.cancelled) return
            if (res.error) {
                setError(res.error)
                setRows([])
            } else {
                setRows(res.activity || [])
            }
        } catch {
            if (!signal.cancelled) setError('Could not load staff activity')
        } finally {
            if (!signal.cancelled) setLoading(false)
        }
    }, [from, to])

    useEffect(() => {
        const signal = { cancelled: false }
        // The rule traces the state writes back through `load`. They are the
        // point here — the range is user-controlled state, so the fetch has to
        // re-run when it changes, and the result has to land in state. Same
        // narrow exemption the sidebar and translation contexts take.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load(signal)
        return () => { signal.cancelled = true }
    }, [load])

    const applyPreset = (days: number) => {
        const today = todayInNepal()
        setFrom(shiftDay(today, -days))
        setTo(today)
    }

    // Totals across everyone, so the per-person figures have something to sit
    // against — "Rs 40,000" means little until you know the day took 120,000.
    const totals = rows.reduce((acc, r) => ({
        collected: acc.collected + r.amountCollected,
        orders: acc.orders + r.ordersTaken,
        bills: acc.bills + r.billsSettled,
        prepared: acc.prepared + r.itemsPrepared,
        discounts: acc.discounts + r.discountTotal,
    }), { collected: 0, orders: 0, bills: 0, prepared: 0, discounts: 0 })

    const anyInferred = rows.some(r => r.ordersInferred > 0)
    const active = rows.filter(r =>
        r.ordersTaken || r.billsSettled || r.itemsPrepared || r.discountsGiven || r.cancellations)
    const idle = rows.filter(r => !active.includes(r))

    return (
        <div className="space-y-5">
            {/* Range picker */}
            <div className="bg-surface border border-hairline rounded-2xl p-4 flex flex-wrap items-end gap-4 shadow-sm">
                <div>
                    <label className="block text-[10px] font-black text-ink-subtle uppercase tracking-wider mb-1">From</label>
                    <input
                        type="date"
                        value={from}
                        max={to}
                        onChange={e => setFrom(e.target.value)}
                        className="px-3 py-2 border border-hairline rounded-xl text-sm font-semibold bg-surface text-ink focus:outline-none focus:border-brand-500"
                    />
                </div>
                <div>
                    <label className="block text-[10px] font-black text-ink-subtle uppercase tracking-wider mb-1">To</label>
                    <input
                        type="date"
                        value={to}
                        min={from}
                        max={todayInNepal()}
                        onChange={e => setTo(e.target.value)}
                        className="px-3 py-2 border border-hairline rounded-xl text-sm font-semibold bg-surface text-ink focus:outline-none focus:border-brand-500"
                    />
                </div>
                <div className="flex gap-2">
                    {PRESETS.map(p => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => applyPreset(p.days)}
                            className="px-3 py-2 rounded-xl border border-hairline bg-surface text-xs font-bold text-ink-subtle hover:border-brand-400 hover:text-brand-600 transition-colors"
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-subtle">
                    <Loader2 size={18} className="animate-spin text-brand-500" /> Loading staff activity…
                </div>
            ) : error ? (
                <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-700">
                    {error}
                </div>
            ) : rows.length === 0 ? (
                <div className="bg-surface rounded-2xl p-16 border border-hairline text-center">
                    <EmptyState icon={TrendingUp} title="No staff found" description="Add staff members to see their daily activity here." />
                </div>
            ) : (
                <>
                    {/* Day totals */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        {([
                            ['Collected', money(totals.collected), Wallet],
                            ['Bills settled', String(totals.bills), Wallet],
                            ['Orders taken', String(totals.orders), Utensils],
                            ['Dishes prepared', String(totals.prepared), ChefHat],
                            ['Discounts given', money(totals.discounts), Percent],
                        ] as const).map(([label, value, Icon]) => (
                            <div key={label} className="bg-surface border border-hairline rounded-2xl p-4">
                                <div className="flex items-center gap-1.5 text-[10px] font-black text-ink-subtle uppercase tracking-wider">
                                    <Icon size={12} /> {label}
                                </div>
                                <p className="text-lg font-black text-ink tabular-nums mt-1">{value}</p>
                            </div>
                        ))}
                    </div>

                    {anyInferred && (
                        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800">
                            <Info size={14} className="mt-0.5 shrink-0" />
                            <span>
                                Some orders are marked <strong>inferred</strong>. Those pre-date order-taker tracking and
                                were attributed to whoever opened the table, which is usually — but not always — who
                                took the order. Treat them as an estimate, not a record.
                            </span>
                        </div>
                    )}

                    <div className="space-y-2">
                        {active.map(r => {
                            const isOpen = expanded === r.userId
                            return (
                                <div key={r.userId} className="bg-surface border border-hairline rounded-2xl overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : r.userId)}
                                        className="w-full flex items-center justify-between gap-4 p-4 hover:bg-surface-muted/40 transition-colors text-left"
                                    >
                                        <span className="min-w-0">
                                            <span className="block font-extrabold text-ink text-sm truncate">
                                                {r.fullName}
                                                <span className="ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface-muted text-ink-subtle">
                                                    {r.role}
                                                </span>
                                            </span>
                                            <span className="block text-[11px] font-semibold text-ink-subtle mt-0.5">
                                                {r.billsSettled > 0 && `${r.billsSettled} bill${r.billsSettled === 1 ? '' : 's'} · `}
                                                {r.ordersTaken > 0 && `${r.ordersTaken} order${r.ordersTaken === 1 ? '' : 's'} · `}
                                                {r.itemsPrepared > 0 && `${r.itemsPrepared} dish${r.itemsPrepared === 1 ? '' : 'es'} · `}
                                                {money(r.amountCollected)} collected
                                            </span>
                                        </span>
                                        {isOpen ? <ChevronUp size={16} className="text-brand-500 shrink-0" /> : <ChevronDown size={16} className="text-ink-subtle shrink-0" />}
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-hairline bg-surface-muted/30 p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                            <Stat label="Bills settled" value={String(r.billsSettled)} />
                                            <Stat label="Money collected" value={money(r.amountCollected)} />
                                            <Stat label="Largest bill" value={money(r.largestBill)} />
                                            <Stat label="Orders taken" value={String(r.ordersTaken)}
                                                note={r.ordersInferred > 0 ? `${r.ordersInferred} inferred` : undefined} />
                                            <Stat label="Items sold" value={String(r.itemsSold)} />
                                            <Stat label="Order value" value={money(r.ordersValue)} />
                                            <Stat label="Dishes prepared" value={String(r.itemsPrepared)} />
                                            <Stat
                                                label="Discounts given"
                                                value={r.discountsGiven > 0 ? `${r.discountsGiven} · ${money(r.discountTotal)}` : '—'}
                                                tone={r.discountsGiven > 0 ? 'warn' : undefined}
                                            />
                                            <Stat
                                                label="Cancellations"
                                                value={r.cancellations > 0 ? String(r.cancellations) : '—'}
                                                tone={r.cancellations > 0 ? 'warn' : undefined}
                                            />
                                        </div>
                                    )}

                                    {/* Day by day. The totals above answer "how
                                        was the week"; this answers "what happened
                                        on Tuesday", which is the question asked
                                        when something looks wrong. */}
                                    {isOpen && r.days.length > 0 && (
                                        <div className="border-t border-hairline bg-surface px-4 py-3">
                                            <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider mb-2">
                                                Day by day ({r.days.length} active day{r.days.length === 1 ? '' : 's'})
                                            </p>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-[11px] min-w-[520px]">
                                                    <thead>
                                                        <tr className="text-[9px] font-black text-ink-subtle uppercase tracking-wider">
                                                            <th className="text-left py-1.5 pr-3">Day</th>
                                                            <th className="text-right py-1.5 px-2">Orders</th>
                                                            <th className="text-right py-1.5 px-2">Order value</th>
                                                            <th className="text-right py-1.5 px-2">Bills</th>
                                                            <th className="text-right py-1.5 px-2">Collected</th>
                                                            <th className="text-right py-1.5 px-2">Dishes</th>
                                                            <th className="text-right py-1.5 pl-2">Discounts</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-hairline">
                                                        {r.days.map(d => (
                                                            <tr key={d.day} className="hover:bg-surface-muted/40">
                                                                <td className="py-1.5 pr-3 font-bold text-ink whitespace-nowrap">{formatDayLabel(d.day)}</td>
                                                                <td className="py-1.5 px-2 text-right tabular-nums text-ink-subtle">{d.ordersTaken || '—'}</td>
                                                                <td className="py-1.5 px-2 text-right tabular-nums text-ink-subtle">{d.ordersValue ? money(d.ordersValue) : '—'}</td>
                                                                <td className="py-1.5 px-2 text-right tabular-nums text-ink-subtle">{d.billsSettled || '—'}</td>
                                                                <td className="py-1.5 px-2 text-right tabular-nums font-bold text-ink">{d.amountCollected ? money(d.amountCollected) : '—'}</td>
                                                                <td className="py-1.5 px-2 text-right tabular-nums text-ink-subtle">{d.itemsPrepared || '—'}</td>
                                                                <td className={`py-1.5 pl-2 text-right tabular-nums ${d.discountTotal > 0 ? 'text-amber-700 font-bold' : 'text-ink-subtle'}`}>
                                                                    {d.discountTotal ? money(d.discountTotal) : '—'}
                                                                    {d.cancellations > 0 && (
                                                                        <span className="ml-1.5 text-[9px] font-black text-rose-600">
                                                                            {d.cancellations} void
                                                                        </span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}

                        {idle.length > 0 && (
                            <div className="bg-surface border border-dashed border-hairline rounded-2xl p-4">
                                <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider mb-2">
                                    No recorded activity in this range ({idle.length})
                                </p>
                                <p className="text-[11px] font-semibold text-ink-subtle">
                                    {idle.map(r => r.fullName).join(', ')}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'warn' }) {
    return (
        <div className={`p-3 rounded-xl border ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-hairline bg-surface'}`}>
            <p className={`text-[9px] font-black uppercase tracking-wider ${tone === 'warn' ? 'text-amber-700' : 'text-ink-subtle'}`}>{label}</p>
            <p className={`text-sm font-black tabular-nums mt-0.5 ${tone === 'warn' ? 'text-amber-800' : 'text-ink'}`}>{value}</p>
            {note && <p className="text-[9px] font-bold text-amber-700 mt-0.5 flex items-center gap-1"><XCircle size={9} /> {note}</p>}
        </div>
    )
}
