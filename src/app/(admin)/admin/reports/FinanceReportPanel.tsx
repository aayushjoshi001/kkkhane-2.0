'use client'

import { useState } from 'react'
import { getFinanceDaySummaryAction } from './actions'
import { getNstDateString } from '@/lib/timezone'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import { Wallet, Landmark, TrendingUp, TrendingDown, AlertCircle, Clock, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import type { FinanceDaySummary } from '@/lib/financeReports'

function fmt(n: number) {
    return `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
}

function CategoryBars({ items, tone }: { items: FinanceDaySummary['expenseByCategory']; tone: 'rose' | 'emerald' }) {
    if (items.length === 0) {
        return <p className="text-sm text-ink-subtle text-center py-6">No records for this date.</p>
    }
    const max = Math.max(...items.map(i => i.amount), 1)
    const barClass = tone === 'rose' ? 'bg-rose-400' : 'bg-emerald-400'
    return (
        <div className="space-y-3">
            {items.map(item => (
                <div key={item.name}>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-ink font-medium truncate">{item.name}</span>
                        <span className="text-xs text-ink-muted shrink-0 ml-2 tabular-nums">{fmt(item.amount)}</span>
                    </div>
                    <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${barClass} transition-all duration-500`} style={{ width: `${(item.amount / max) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    )
}

export default function FinanceReportPanel({ restaurantId }: { restaurantId: string }) {
    const [selectedDate, setSelectedDate] = useState(getNstDateString())
    const [loading, setLoading] = useState(false)
    const [summary, setSummary] = useState<FinanceDaySummary | null>(null)

    async function handleLoad() {
        setLoading(true)
        const result = await getFinanceDaySummaryAction(restaurantId, selectedDate)
        setLoading(false)
        if (result.error) { toast.error(result.error); return }
        if (result.data) setSummary(result.data)
    }

    const isOpen = summary?.sessionStatus === 'open'
    const noSession = summary?.sessionStatus === null

    return (
        <div className="space-y-4">
            {/* Load bar */}
            <div className="print:hidden bg-surface rounded-card border border-hairline shadow-sm p-6 flex flex-wrap items-end gap-5">
                <div>
                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Date</label>
                    <input type="date" value={selectedDate} max={getNstDateString()} onChange={e => setSelectedDate(e.target.value)}
                        className="rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all" />
                </div>
                <button onClick={handleLoad} disabled={loading}
                    className="flex items-center gap-2 bg-brand-500 text-white px-6 py-2.5 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 focus-ring">
                    {loading ? <Loader2 size={16} className="animate-spin" /> : <Wallet size={16} />} {loading ? 'Loading...' : 'Load Summary'}
                </button>
            </div>

            {!summary && !loading && (
                <div className="bg-surface rounded-card border border-hairline p-10 text-center text-ink-subtle font-bold shadow-sm">
                    Select a date and click Load Summary.
                </div>
            )}

            {noSession && (
                <div className="bg-surface rounded-card border border-hairline p-10 text-center text-ink-subtle font-bold shadow-sm">
                    No Day Book session was opened on {summary!.date}.
                </div>
            )}

            {summary && !noSession && (
                <div className="space-y-4">
                    <h2 className="hidden print:block text-lg font-black text-ink">Financial Summary — {summary.date}</h2>
                    {isOpen && (
                        <div className="flex items-center gap-2 bg-warning-bg border border-warning-fg/20 text-warning-fg rounded-[var(--r-md)] px-4 py-2.5 text-sm font-bold w-fit">
                            <Clock size={15} /> Session still open — figures below are current, not final.
                        </div>
                    )}

                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <StatCard label="Opening Cash" value={fmt(summary.openingCash)} icon={Wallet} tone="neutral" />
                        <StatCard label={isOpen ? 'Current Cash' : 'Closing Cash'} value={fmt(summary.closingCash)} icon={Wallet} tone="info" />
                        <StatCard label="Opening Bank" value={fmt(summary.openingBank)} icon={Landmark} tone="neutral" />
                        <StatCard label={isOpen ? 'Current Bank' : 'Closing Bank'} value={fmt(summary.closingBank)} icon={Landmark} tone="info" />
                        <StatCard label="Net Cash Position" value={fmt(summary.closingCash + summary.closingBank)} icon={TrendingUp} tone="brand" />
                    </div>

                    <Card className="flex flex-wrap items-center gap-8">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                                <TrendingUp size={18} />
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Income</p>
                                <p className="text-xl font-black text-emerald-600 mt-0.5">{fmt(summary.totalIncome)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                                <TrendingDown size={18} />
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Expense</p>
                                <p className="text-xl font-black text-rose-600 mt-0.5">{fmt(summary.totalExpense)}</p>
                            </div>
                        </div>
                        <p className="text-[11px] text-ink-subtle italic ml-auto max-w-sm">
                            Income &amp; Expense totals reflect all records for the day; Cash/Bank movement above only reflects postings made to an open Day Book session.
                        </p>
                    </Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Expense by Category</h4>
                            <CategoryBars items={summary.expenseByCategory} tone="rose" />
                        </Card>
                        <Card>
                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Income by Category</h4>
                            <CategoryBars items={summary.incomeByCategory} tone="emerald" />
                        </Card>
                    </div>

                    {summary.pendingChequeCount > 0 && (
                        <Link href="/admin/vouchers" className="flex items-center gap-3 bg-amber-50 border border-amber-100 text-amber-700 rounded-card px-6 py-4 text-sm font-bold hover:bg-amber-100 transition-colors">
                            <AlertCircle size={18} />
                            {summary.pendingChequeCount} cheque{summary.pendingChequeCount > 1 ? 's' : ''} pending approval, worth {fmt(summary.pendingChequeAmount)} — review in Vouchers Ledger.
                        </Link>
                    )}
                </div>
            )}
        </div>
    )
}
