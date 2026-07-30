'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Download, Loader2, AlertCircle } from 'lucide-react'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import { downloadPdf } from '@/lib/exportPdf'
import { useDates } from '@/lib/contexts/CalendarContext'

interface RangeEntry {
    id: string
    type: 'cash_in' | 'cash_out' | 'bank_in' | 'bank_out'
    amount: number
    category: string
    description: string
    bank_name: string | null
    created_at: string
    session_date: string
    created_by_name: string | null
}

interface RangeTotals {
    opening_cash_balance: number
    opening_bank_balance: number
    total_cash_in: number
    total_cash_out: number
    total_bank_in: number
    total_bank_out: number
    closing_cash_balance: number
    closing_bank_balance: number
}

function fmt(amount: number) {
    return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' })
}

/**
 * Historical statement panel shared by Bank Book and Cash Book — those pages
 * are otherwise "the currently open drawer/account", a single live session
 * with no notion of a range. This is the closest equivalent: pick a range,
 * fetch every session's entries of just this ledger's type from
 * GET /api/day-book/range, and show the combined statement. Collapsed by
 * default so it stays a secondary feature next to the live session view.
 */
export default function DayBookRangeStatement({
    type,
    label,
    categoryLabels,
    categoryColors,
}: {
    type: 'cash' | 'bank'
    label: string
    categoryLabels: Record<string, string>
    categoryColors: Record<string, string>
}) {
    const [expanded, setExpanded] = useState(false)
    const [range, setRange] = useState<DateRange>({ from: null, to: null })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<{ from: string; to: string; entries: RangeEntry[]; totals: RangeTotals } | null>(null)
    const { formatDateLong } = useDates()

    const inKey = type === 'cash' ? 'total_cash_in' : 'total_bank_in'
    const outKey = type === 'cash' ? 'total_cash_out' : 'total_bank_out'
    const openingKey = type === 'cash' ? 'opening_cash_balance' : 'opening_bank_balance'
    const closingKey = type === 'cash' ? 'closing_cash_balance' : 'closing_bank_balance'

    const load = async (next: DateRange) => {
        setRange(next)
        if (!next.from || !next.to) { setData(null); return }
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/day-book/range?from=${next.from}&to=${next.to}&type=${type}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load statement')
            setData(json.data)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load statement')
            setData(null)
        } finally {
            setLoading(false)
        }
    }

    const entries = data?.entries ?? []
    const totals = data?.totals
    const fileName = data ? `${type}-book-${data.from}-to-${data.to}` : `${type}-book-statement`

    const reportColumns = [
        { key: 'date', label: 'Date' },
        { key: 'time', label: 'Time' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'by', label: 'Responsible Name' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
    ]
    const reportRows = entries.map(e => ({
        date: formatDateLong(`${e.session_date}T00:00:00`),
        time: timeStr(e.created_at),
        category: categoryLabels[e.category] || e.category,
        description: e.description + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
        by: e.created_by_name || 'Unknown',
        amount: (e.type.endsWith('_in') ? '+' : '-') + fmt(e.amount),
    }))
    const handleExportCsv = () => downloadCsv(fileName, reportColumns, reportRows)
    const handleExportExcel = () => downloadExcel(fileName, reportColumns, reportRows)
    const handleExportPdf = () => {
        if (!data || !totals) return
        downloadPdf(
            fileName,
            `${label} Book Statement`,
            `${formatDateLong(`${data.from}T00:00:00`)} to ${formatDateLong(`${data.to}T00:00:00`)}`,
            reportColumns,
            reportRows,
            { description: 'Closing Balance', amount: fmt(totals[closingKey]) },
        )
    }

    return (
        <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden print:hidden">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-surface-muted/40 transition-colors"
            >
                <div>
                    <h3 className="font-extrabold text-ink text-sm">Historical Statement</h3>
                    <p className="text-xs text-ink-subtle mt-0.5">View {label.toLowerCase()} movements across any date range</p>
                </div>
                {expanded ? <ChevronUp size={16} className="text-ink-subtle" /> : <ChevronDown size={16} className="text-ink-subtle" />}
            </button>

            {expanded && (
                <div className="p-4 border-t border-hairline space-y-4">
                    <DateRangePicker from={range.from} to={range.to} onChange={load} className="max-w-xl" />

                    {loading && (
                        <div className="flex items-center gap-2 text-sm text-ink-subtle py-6 justify-center">
                            <Loader2 size={16} className="animate-spin" /> Loading statement…
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-rose-600 py-3 px-4 bg-rose-50 border border-rose-100 rounded-xl">
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}

                    {!loading && !error && data && totals && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="p-3 rounded-xl bg-surface-muted/40 border border-hairline">
                                    <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider block">Opening</span>
                                    <div className="text-sm font-extrabold text-ink tabular-nums mt-1">{fmt(totals[openingKey])}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100">
                                    <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">Total In</span>
                                    <div className="text-sm font-extrabold text-emerald-700 tabular-nums mt-1">+{fmt(totals[inKey])}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                                    <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider block">Total Out</span>
                                    <div className="text-sm font-extrabold text-rose-700 tabular-nums mt-1">-{fmt(totals[outKey])}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-brand-50/60 border border-brand-100">
                                    <span className="text-[10px] font-bold text-brand-700 uppercase tracking-wider block">Closing</span>
                                    <div className="text-sm font-black text-brand-700 tabular-nums mt-1">{fmt(totals[closingKey])}</div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-xs font-bold text-ink-subtle">{entries.length} entries</span>
                                <div className="flex gap-1.5">
                                    <button onClick={handleExportCsv} className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-lg text-[10px] uppercase border border-hairline transition-all">
                                        <Download size={11} /> CSV
                                    </button>
                                    <button onClick={handleExportExcel} className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-lg text-[10px] uppercase border border-hairline transition-all">
                                        <Download size={11} /> Excel
                                    </button>
                                    <button onClick={handleExportPdf} className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-lg text-[10px] uppercase border border-hairline transition-all">
                                        <Download size={11} /> PDF
                                    </button>
                                </div>
                            </div>

                            <div className="border border-hairline rounded-xl overflow-hidden">
                                {entries.length === 0 ? (
                                    <div className="p-10 text-center text-ink-subtle text-sm">No entries in this range.</div>
                                ) : (
                                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead className="sticky top-0 bg-surface-muted">
                                                <tr className="border-b border-hairline">
                                                    <th className="px-4 py-2.5 font-bold text-ink-subtle">Date</th>
                                                    <th className="px-4 py-2.5 font-bold text-ink-subtle">Category</th>
                                                    <th className="px-4 py-2.5 font-bold text-ink-subtle">Description</th>
                                                    <th className="px-4 py-2.5 font-bold text-ink-subtle">Responsible Name</th>
                                                    <th className="px-4 py-2.5 font-bold text-ink-subtle text-right">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-hairline">
                                                {entries.map(e => {
                                                    const isIn = e.type.endsWith('_in')
                                                    return (
                                                        <tr key={e.id} className="hover:bg-surface-muted/50">
                                                            <td className="px-4 py-3 text-ink-subtle font-semibold whitespace-nowrap">
                                                                <div>{formatDateLong(`${e.session_date}T00:00:00`)}</div>
                                                                <div className="text-[10px]">{timeStr(e.created_at)}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold border uppercase ${categoryColors[e.category] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                                                                    {categoryLabels[e.category] || e.category}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 font-bold text-ink">
                                                                {e.description}
                                                                {e.bank_name && <span className="block text-[10px] text-ink-subtle font-bold mt-0.5">Bank: {e.bank_name}</span>}
                                                            </td>
                                                            <td className="px-4 py-3 font-bold text-ink">{e.created_by_name || 'Unknown'}</td>
                                                            <td className={`px-4 py-3 text-right font-extrabold ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {isIn ? '+' : '-'}{fmt(e.amount)}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {!loading && !error && !data && (
                        <p className="text-xs text-ink-subtle text-center py-4">Pick a date range above to load the statement.</p>
                    )}
                </div>
            )}
        </div>
    )
}
