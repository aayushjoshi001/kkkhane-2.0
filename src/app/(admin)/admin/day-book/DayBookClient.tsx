'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
    TrendingUp, TrendingDown, Wallet, Landmark, AlertCircle, Download, Printer, BookOpen,
    ChevronLeft, ChevronRight, Loader2, Users,
} from 'lucide-react'
import type { DayBookSession, DayBookEntry } from '@/types/database'
import type { CashierBreakdownRow } from '@/lib/ledger'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import { downloadPdf, type PdfColumn } from '@/lib/exportPdf'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { useDates } from '@/lib/contexts/CalendarContext'
import { formatDateParts, type Calendar } from '@/lib/calendar'
import { DAY_BOOK_CATEGORY_LABELS, formatDayBookDescription, isDayBookSourceCash } from '@/lib/dayBookFormat'

interface DayBookTotals {
    total_cash_in: number
    total_cash_out: number
    total_bank_in: number
    total_bank_out: number
    total_money_in: number
    total_money_out: number
    closing_cash_balance: number
    closing_bank_balance: number
    opening_cash_balance: number
    opening_bank_balance: number
}

interface DayBookRangeTotals {
    opening_cash_balance: number
    opening_bank_balance: number
    total_cash_in: number
    total_cash_out: number
    total_bank_in: number
    total_bank_out: number
    closing_cash_balance: number
    closing_bank_balance: number
}

export interface DayBookRangeProp {
    from: string
    to: string
    sessions: DayBookSession[]
    entries: (DayBookEntry & { session_date: string; created_by_name: string | null })[]
    totals: DayBookRangeTotals
    byCashier: CashierBreakdownRow[]
}

interface DayBookClientProps {
    session: DayBookSession | null
    entries: (DayBookEntry & { created_by_name: string | null })[]
    totals: DayBookTotals
    byCashier: CashierBreakdownRow[]
    todayDate: string   // YYYY-MM-DD
    /** The day on screen. Equals the session's own date, which can trail today. */
    selectedDate: string
}

const CATEGORY_LABELS = DAY_BOOK_CATEGORY_LABELS

const CATEGORY_COLORS: Record<string, string> = {
    order_payment:   'bg-emerald-50 text-emerald-700 border-emerald-100',
    room_deposit:    'bg-blue-50 text-blue-700 border-blue-100',
    booking_payment: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    expense:         'bg-red-50 text-red-700 border-red-100',
    refund:          'bg-orange-50 text-orange-700 border-orange-100',
    salary:          'bg-purple-50 text-purple-700 border-purple-100',
    advance:         'bg-yellow-50 text-yellow-700 border-yellow-100',
    bank_deposit:    'bg-cyan-50 text-cyan-700 border-cyan-100',
    withdrawal:      'bg-amber-50 text-amber-700 border-amber-100',
    other:           'bg-surface-muted text-ink-subtle border-hairline',
}

function fmt(amount: number) {
    return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' })
}

/**
 * The day `days` either side of a `YYYY-MM-DD` string.
 *
 * Built from local parts rather than `new Date(iso)`, which reads the string as
 * UTC midnight and lands on the previous day anywhere behind UTC — Kathmandu is
 * ahead, but the same arithmetic runs in whatever timezone the manager's laptop
 * is set to, and stepping a day must not silently skip one.
 */
function shiftIsoDate(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, d + days)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

// Only the leading calendar here — this renders as a 10px line beneath the
// entry time, where "Shrawan 08 (Jul 24)" would not fit. The page header
// already states the day in full, in both calendars.
function entryDateStr(iso: string, calendar: Calendar) {
    return formatDateParts(iso, calendar, { withYear: false }).primary
}

const formatDescription = formatDayBookDescription

const isSourceCash = isDayBookSourceCash

function netFmt(n: number) {
    return (n >= 0 ? '' : '-') + fmt(Math.abs(n))
}

/**
 * Per-cashier cash/QR/bank breakdown — who collected or paid out how much,
 * for the session (open-to-close) or range on screen. Shared by both the
 * single-day and range views since the shape (`CashierBreakdownRow[]`) is
 * identical either way. "Net Cash/QR to Collect" is what that cashier is
 * still holding (in − out) — what should physically come back at close, not
 * a running gross total.
 */
function CashierBreakdownPanel({ rows, subtitle }: { rows: CashierBreakdownRow[]; subtitle: string }) {
    if (rows.length === 0) return null

    const totals = rows.reduce((acc, r) => ({
        cash_in: acc.cash_in + r.cash_in, cash_out: acc.cash_out + r.cash_out,
        qr_in: acc.qr_in + r.qr_in, qr_out: acc.qr_out + r.qr_out,
        bank_in: acc.bank_in + r.bank_in, bank_out: acc.bank_out + r.bank_out,
        total_in: acc.total_in + r.total_in, total_out: acc.total_out + r.total_out,
    }), { cash_in: 0, cash_out: 0, qr_in: 0, qr_out: 0, bank_in: 0, bank_out: 0, total_in: 0, total_out: 0 })

    return (
        <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
            <div className="p-5 border-b border-hairline flex items-center gap-2">
                <Users size={16} className="text-ink-subtle" />
                <div>
                    <h3 className="font-extrabold text-ink">Cashier-wise Breakdown</h3>
                    <p className="text-xs text-ink-subtle mt-0.5">{subtitle}</p>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                    <thead>
                        <tr className="bg-surface-muted border-b border-hairline">
                            <th className="px-4 py-3 font-bold text-ink-subtle">Cashier</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">Cash In</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">Cash Out</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right bg-surface-muted/50">Net Cash to Collect</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">QR In</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">QR Out</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right bg-surface-muted/50">Net QR to Collect</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">Other Bank In</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right">Other Bank Out</th>
                            <th className="px-4 py-3 font-bold text-ink-subtle text-right bg-surface-muted/50">Net Collected</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {rows.map(r => {
                            const netCash = r.cash_in - r.cash_out
                            const netQr = r.qr_in - r.qr_out
                            return (
                                <tr key={r.id} className="hover:bg-surface-muted transition-colors">
                                    <td className="px-4 py-3 font-bold text-ink">{r.name}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{r.cash_in > 0 ? '+' + fmt(r.cash_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-rose-600">{r.cash_out > 0 ? '-' + fmt(r.cash_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black bg-surface-muted/30 ${netCash >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{netFmt(netCash)}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{r.qr_in > 0 ? '+' + fmt(r.qr_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-rose-600">{r.qr_out > 0 ? '-' + fmt(r.qr_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black bg-surface-muted/30 ${netQr >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{netFmt(netQr)}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">{r.bank_in > 0 ? '+' + fmt(r.bank_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-semibold text-rose-600">{r.bank_out > 0 ? '-' + fmt(r.bank_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black bg-surface-muted/30 ${r.total_in - r.total_out >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {netFmt(r.total_in - r.total_out)}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                    {rows.length > 1 && (() => {
                        const netCash = totals.cash_in - totals.cash_out
                        const netQr = totals.qr_in - totals.qr_out
                        return (
                            <tfoot>
                                <tr className="border-t-2 border-hairline bg-surface-muted/60">
                                    <td className="px-4 py-3 font-black text-ink">All Cashiers</td>
                                    <td className="px-4 py-3 text-right font-black text-emerald-600">{totals.cash_in > 0 ? '+' + fmt(totals.cash_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-black text-rose-600">{totals.cash_out > 0 ? '-' + fmt(totals.cash_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black ${netCash >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{netFmt(netCash)}</td>
                                    <td className="px-4 py-3 text-right font-black text-emerald-600">{totals.qr_in > 0 ? '+' + fmt(totals.qr_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-black text-rose-600">{totals.qr_out > 0 ? '-' + fmt(totals.qr_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black ${netQr >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{netFmt(netQr)}</td>
                                    <td className="px-4 py-3 text-right font-black text-emerald-600">{totals.bank_in > 0 ? '+' + fmt(totals.bank_in) : '—'}</td>
                                    <td className="px-4 py-3 text-right font-black text-rose-600">{totals.bank_out > 0 ? '-' + fmt(totals.bank_out) : '—'}</td>
                                    <td className={`px-4 py-3 text-right font-black ${totals.total_in - totals.total_out >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {netFmt(totals.total_in - totals.total_out)}
                                    </td>
                                </tr>
                            </tfoot>
                        )
                    })()}
                </table>
            </div>
        </div>
    )
}

// Same column layout the on-screen Cashier-wise Breakdown table uses — kept
// as one row per cashier (not stacked description/amount lines) so the
// export reads exactly like the screen.
const CASHIER_BREAKDOWN_COLUMNS: PdfColumn[] = [
    { key: 'cashier', label: 'Cashier' },
    { key: 'cash_in', label: 'Cash In', align: 'right' },
    { key: 'cash_out', label: 'Cash Out', align: 'right' },
    { key: 'net_cash', label: 'Net Cash to Collect', align: 'right' },
    { key: 'qr_in', label: 'QR In', align: 'right' },
    { key: 'qr_out', label: 'QR Out', align: 'right' },
    { key: 'net_qr', label: 'Net QR to Collect', align: 'right' },
    { key: 'bank_in', label: 'Other Bank In', align: 'right' },
    { key: 'bank_out', label: 'Other Bank Out', align: 'right' },
    { key: 'net_total', label: 'Net Collected', align: 'right' },
]

function cashierBreakdownRow(r: { name: string; cash_in: number; cash_out: number; qr_in: number; qr_out: number; bank_in: number; bank_out: number; total_in: number; total_out: number }) {
    const netCash = r.cash_in - r.cash_out
    const netQr = r.qr_in - r.qr_out
    return {
        cashier: r.name,
        cash_in: r.cash_in > 0 ? '+' + fmt(r.cash_in) : '—',
        cash_out: r.cash_out > 0 ? '-' + fmt(r.cash_out) : '—',
        net_cash: netFmt(netCash),
        qr_in: r.qr_in > 0 ? '+' + fmt(r.qr_in) : '—',
        qr_out: r.qr_out > 0 ? '-' + fmt(r.qr_out) : '—',
        net_qr: netFmt(netQr),
        bank_in: r.bank_in > 0 ? '+' + fmt(r.bank_in) : '—',
        bank_out: r.bank_out > 0 ? '-' + fmt(r.bank_out) : '—',
        net_total: netFmt(r.total_in - r.total_out),
    }
}

/**
 * Builds the Cashier-wise Breakdown as its own table section — same shape
 * exporters draw as a second table (PDF) or a second `<table>`/CSV block
 * (Excel/CSV) rather than flattening it into the main statement's rows, so
 * the export matches the on-screen table (one row per cashier) instead of
 * reading as a vertical list.
 */
function cashierBreakdownSection(rows: CashierBreakdownRow[]): { title: string; columns: PdfColumn[]; rows: Record<string, string>[]; totalsRow?: Record<string, string> } | null {
    if (rows.length === 0) return null

    const totalsRow = rows.length > 1 ? cashierBreakdownRow({
        name: 'All Cashiers',
        cash_in: rows.reduce((s, r) => s + r.cash_in, 0),
        cash_out: rows.reduce((s, r) => s + r.cash_out, 0),
        qr_in: rows.reduce((s, r) => s + r.qr_in, 0),
        qr_out: rows.reduce((s, r) => s + r.qr_out, 0),
        bank_in: rows.reduce((s, r) => s + r.bank_in, 0),
        bank_out: rows.reduce((s, r) => s + r.bank_out, 0),
        total_in: rows.reduce((s, r) => s + r.total_in, 0),
        total_out: rows.reduce((s, r) => s + r.total_out, 0),
    }) : undefined

    return {
        title: 'Cashier-wise Breakdown',
        columns: CASHIER_BREAKDOWN_COLUMNS,
        rows: rows.map(cashierBreakdownRow),
        totalsRow,
    }
}

/**
 * The multi-day counterpart to the single-session view below — one combined
 * statement across every session in [from, to], each row carrying its own
 * date since a range spans more than one. Kept as its own component rather
 * than threading a `range` branch through the 400-line single-day view: the
 * two share almost no state (no ledgerTab, no per-session "no book was kept"
 * empty state) and forcing them into one return would risk regressing the
 * single-day path for the sake of a feature it doesn't need.
 */
export function DayBookRangeView({ range }: { range: DayBookRangeProp }) {
    const router = useRouter()
    const [navigating, startNavigating] = useTransition()
    const { formatDateLong, calendar } = useDates()

    const goToRange = (next: { from: string | null; to: string | null }) => {
        if (!next.from || !next.to) return
        const url = next.from === next.to
            ? `/admin/day-book?date=${next.from}`
            : `/admin/day-book?from=${next.from}&to=${next.to}`
        startNavigating(() => router.push(url))
    }

    const fromLabel = formatDateLong(`${range.from}T00:00:00`)
    const toLabel = formatDateLong(`${range.to}T00:00:00`)
    const { totals } = range

    const netChange = (totals.total_cash_in + totals.total_bank_in) - (totals.total_cash_out + totals.total_bank_out)
    const combinedClosing = totals.closing_cash_balance + totals.closing_bank_balance
    const openingCombined = totals.opening_cash_balance + totals.opening_bank_balance
    const totalMoneyIn = totals.total_cash_in + totals.total_bank_in
    const totalMoneyOut = totals.total_cash_out + totals.total_bank_out

    const reportColumns = [
        { key: 'date', label: 'Date' },
        { key: 'time', label: 'Time' },
        { key: 'source', label: 'Source' },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'by', label: 'Responsible Name' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
    ]

    const entryRows = [...range.entries]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(e => ({
            date: entryDateStr(e.session_date ? `${e.session_date}T00:00:00` : e.created_at, calendar),
            time: timeStr(e.created_at),
            source: isSourceCash(e.type) ? 'Cash' : 'Bank',
            type: (e.type === 'cash_in' || e.type === 'bank_in') ? 'IN' : 'OUT',
            category: CATEGORY_LABELS[e.category] || e.category,
            description: formatDescription(e.description) + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
            by: e.created_by_name || 'Unknown',
            amount: ((e.type === 'cash_in' || e.type === 'bank_in') ? '+' : '-') + fmt(e.amount),
        }))

    const summaryRows = [
        {},
        { description: 'Opening Cash', amount: fmt(totals.opening_cash_balance) },
        { description: 'Opening Bank', amount: fmt(totals.opening_bank_balance) },
        { description: 'Opening Balance (Cash + Bank)', amount: fmt(openingCombined) },
        {},
        { description: 'Cash In', amount: '+' + fmt(totals.total_cash_in) },
        { description: 'Bank In', amount: '+' + fmt(totals.total_bank_in) },
        { description: 'Total Money In', amount: '+' + fmt(totalMoneyIn) },
        {},
        { description: 'Cash Out', amount: '-' + fmt(totals.total_cash_out) },
        { description: 'Bank Out', amount: '-' + fmt(totals.total_bank_out) },
        { description: 'Total Money Out', amount: '-' + fmt(totalMoneyOut) },
        {},
        { description: 'Net Change', amount: (netChange >= 0 ? '+' : '-') + fmt(Math.abs(netChange)) },
        { description: 'Closing Cash', amount: fmt(totals.closing_cash_balance) },
        { description: 'Closing Bank', amount: fmt(totals.closing_bank_balance) },
    ]
    const closingRow = { description: 'Closing Balance (Cash + Bank)', amount: fmt(combinedClosing) }
    const statementRows = [...entryRows, ...summaryRows]
    const flatRows = [...statementRows, closingRow]
    const fileName = `day-book-${range.from}-to-${range.to}`
    const exportSubtitle = `${fromLabel} to ${toLabel}  |  Entries: ${range.entries.length}  |  In: ${fmt(totalMoneyIn)}  |  Out: ${fmt(totalMoneyOut)}`
    const cashierSection = cashierBreakdownSection(range.byCashier)

    const handleExportCsv = () => downloadCsv(fileName, reportColumns, flatRows, cashierSection ? [cashierSection] : undefined)
    const handleExportExcel = () => downloadExcel(fileName, reportColumns, flatRows, cashierSection ? [cashierSection] : undefined)
    const handleExportPdf = () => downloadPdf(
        fileName,
        'Day Book Statement',
        exportSubtitle,
        reportColumns.map(c => ({ key: c.key, label: c.label, align: c.align })),
        statementRows,
        closingRow,
        cashierSection ? [cashierSection] : undefined,
    )

    return (
        <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                        <BookOpen className="text-amber-600" size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-ink">Day Book</h1>
                        <p className="text-xs text-ink-subtle mt-0.5 flex items-center gap-1.5">
                            <span>{fromLabel} — {toLabel}</span>
                            <span className="px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-700 border border-brand-100 text-[10px] font-black uppercase">
                                Statement
                            </span>
                            {navigating && <Loader2 size={11} className="animate-spin" />}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2 print:hidden">
                    <button onClick={handleExportCsv} className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors">
                        <Download size={14} /> CSV
                    </button>
                    <button onClick={handleExportExcel} className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors">
                        <Download size={14} /> Excel
                    </button>
                    <button onClick={handleExportPdf} className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors">
                        <Download size={14} /> PDF
                    </button>
                    <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors">
                        <Printer size={14} /> Print
                    </button>
                </div>
            </div>

            {/* Range picker — responsive, BS/AD aware */}
            <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-3 print:hidden">
                <DateRangePicker from={range.from} to={range.to} onChange={goToRange} allowAll={false} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                        <TrendingUp size={14} className="text-emerald-500" /> Total Money In
                    </div>
                    <p className="text-2xl font-black text-emerald-600 mt-2">+{fmt(totalMoneyIn)}</p>
                    <p className="text-[11px] text-ink-subtle mt-1">Cash + Bank received</p>
                </div>
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                        <TrendingDown size={14} className="text-rose-500" /> Total Money Out
                    </div>
                    <p className="text-2xl font-black text-rose-600 mt-2">-{fmt(totalMoneyOut)}</p>
                    <p className="text-[11px] text-ink-subtle mt-1">Cash + Bank paid out</p>
                </div>
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                        <Wallet size={14} className="text-ink-subtle" /> Cash Balance
                    </div>
                    <p className="text-2xl font-black text-ink mt-2">{fmt(totals.closing_cash_balance)}</p>
                    <p className="text-[11px] text-ink-subtle mt-1">At end of range</p>
                </div>
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                    <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                        <Landmark size={14} className="text-ink-subtle" /> Bank Balance
                    </div>
                    <p className="text-2xl font-black text-ink mt-2">{fmt(totals.closing_bank_balance)}</p>
                    <p className="text-[11px] text-ink-subtle mt-1">At end of range</p>
                </div>
            </div>

            <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                <div className="p-5 border-b border-hairline">
                    <h3 className="font-extrabold text-ink">Day Book Entries</h3>
                    <p className="text-xs text-ink-subtle mt-0.5">Cash and Bank transactions from {fromLabel} to {toLabel}</p>
                </div>
                {range.entries.length === 0 ? (
                    <div className="p-16 text-center text-ink-subtle text-sm">
                        <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                        No entries were logged in this range.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-surface-muted border-b border-hairline">
                                    <th className="px-6 py-3 font-bold text-ink-subtle w-24">Date &amp; Time</th>
                                    <th className="px-6 py-3 font-bold text-ink-subtle w-20">Source</th>
                                    <th className="px-6 py-3 font-bold text-ink-subtle w-32">Category</th>
                                    <th className="px-6 py-3 font-bold text-ink-subtle">Description</th>
                                    <th className="px-6 py-3 font-bold text-ink-subtle w-32">Responsible Name</th>
                                    <th className="px-6 py-3 font-bold text-ink-subtle text-right w-36">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                                {[...range.entries].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(e => {
                                    const cash = isSourceCash(e.type)
                                    const isIn = e.type === 'cash_in' || e.type === 'bank_in'
                                    return (
                                        <tr key={e.id} className="hover:bg-surface-muted transition-colors">
                                            <td className="px-6 py-4 text-ink-subtle font-semibold">
                                                <div>{timeStr(e.created_at)}</div>
                                                <div className="text-[10px] text-ink-subtle font-bold">
                                                    {entryDateStr(e.session_date ? `${e.session_date}T00:00:00` : e.created_at, calendar)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${cash ? 'bg-surface-muted text-ink-subtle' : 'bg-cyan-50 text-cyan-700'}`}>
                                                    {cash ? 'Cash' : 'Bank'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${CATEGORY_COLORS[e.category] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                                                    {CATEGORY_LABELS[e.category] || e.category}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-bold text-ink">
                                                {formatDescription(e.description)}
                                                {e.bank_name && <span className="block text-[10px] text-ink-subtle font-bold mt-0.5">Bank: {e.bank_name}</span>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider block">{isIn ? 'Collected by' : 'Given by'}</span>
                                                <span className="text-xs font-bold text-ink">{e.created_by_name || 'Unknown'}</span>
                                            </td>
                                            <td className={`px-6 py-4 text-right font-extrabold text-sm ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
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

            <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                <div className="p-5 border-b border-hairline">
                    <h3 className="font-extrabold text-ink">Summary</h3>
                    <p className="text-xs text-ink-subtle mt-0.5">Cash and Bank breakdown from {fromLabel} to {toLabel}</p>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Cash In</span>
                            <span className="font-extrabold text-emerald-600">+{fmt(totals.total_cash_in)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Bank In</span>
                            <span className="font-extrabold text-emerald-600">+{fmt(totals.total_bank_in)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm pt-2.5 border-t border-hairline">
                            <span className="text-ink font-extrabold">Total Money In</span>
                            <span className="font-black text-emerald-600">+{fmt(totalMoneyIn)}</span>
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Cash Out</span>
                            <span className="font-extrabold text-rose-600">-{fmt(totals.total_cash_out)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Bank Out</span>
                            <span className="font-extrabold text-rose-600">-{fmt(totals.total_bank_out)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm pt-2.5 border-t border-hairline">
                            <span className="text-ink font-extrabold">Total Money Out</span>
                            <span className="font-black text-rose-600">-{fmt(totalMoneyOut)}</span>
                        </div>
                    </div>
                </div>
                <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Opening Cash</span>
                            <span className="font-extrabold text-ink">{fmt(totals.opening_cash_balance)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Opening Bank</span>
                            <span className="font-extrabold text-ink">{fmt(totals.opening_bank_balance)}</span>
                        </div>
                    </div>
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Closing Cash</span>
                            <span className="font-extrabold text-ink">{fmt(totals.closing_cash_balance)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-ink-subtle font-semibold">Closing Bank</span>
                            <span className="font-extrabold text-ink">{fmt(totals.closing_bank_balance)}</span>
                        </div>
                    </div>
                </div>
                <div className="px-5 pb-5">
                    <div className="rounded-xl bg-surface-muted border border-hairline p-4 flex items-center justify-between">
                        <span className="text-sm font-extrabold text-ink">Net Change</span>
                        <span className={`text-lg font-black ${netChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {netChange >= 0 ? '+' : '-'}{fmt(Math.abs(netChange))}
                        </span>
                    </div>
                    <div className="rounded-xl bg-ink p-4 flex items-center justify-between mt-3">
                        <span className="text-sm font-extrabold text-surface">Combined Closing Balance (Cash + Bank)</span>
                        <span className="text-lg font-black text-surface">{fmt(combinedClosing)}</span>
                    </div>
                </div>
            </div>

            <CashierBreakdownPanel rows={range.byCashier} subtitle={`Who collected/paid what, ${fromLabel} to ${toLabel}`} />
        </div>
    )
}

export default function DayBookClient({ session, entries, totals, byCashier, todayDate, selectedDate }: DayBookClientProps) {
    const [ledgerTab, setLedgerTab] = useState<'in' | 'out'>('in')
    const router = useRouter()
    const [navigating, startNavigating] = useTransition()

    const { formatDateLong, calendar } = useDates()
    const dateLabel = formatDateLong(`${selectedDate}T00:00:00`)
    const isToday = selectedDate === todayDate

    // The day is server state — it drives which session and entries are read —
    // so it lives in the URL rather than component state. That also makes a
    // given day's book linkable, which matters when a manager is asking the
    // accountant to look at one specific date.
    const goToDate = (iso: string) => {
        if (!iso || iso === selectedDate) return
        startNavigating(() => router.push(`/admin/day-book?date=${iso}`))
    }

    // Picking two different ends switches the page to the aggregated range
    // statement (DayBookRangeView, chosen server-side in page.tsx); picking
    // the same day on both ends is equivalent to goToDate.
    const goToRange = (next: { from: string | null; to: string | null }) => {
        if (!next.from || !next.to) return
        if (next.from === next.to) return goToDate(next.from)
        startNavigating(() => router.push(`/admin/day-book?from=${next.from}&to=${next.to}`))
    }

    const moneyInEntries  = entries.filter(e => e.type === 'cash_in' || e.type === 'bank_in')
    const moneyOutEntries = entries.filter(e => e.type === 'cash_out' || e.type === 'bank_out')

    const reportColumns = [
        { key: 'time', label: 'Time' },
        { key: 'source', label: 'Source' },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'by', label: 'Responsible Name' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
    ]

    const netChange = totals.total_money_in - totals.total_money_out
    const combinedClosing = totals.closing_cash_balance + totals.closing_bank_balance
    const openingCombined = totals.opening_cash_balance + totals.opening_bank_balance

    // Oldest first. The screen leads with the newest entry because that is the
    // one just logged, but an exported statement is read top to bottom as the
    // day happened, and the closing balance at the foot only follows from the
    // rows above it in that order.
    const entryRows = [...entries]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(e => ({
            time: timeStr(e.created_at),
            source: isSourceCash(e.type) ? 'Cash' : 'Bank',
            type: (e.type === 'cash_in' || e.type === 'bank_in') ? 'IN' : 'OUT',
            category: CATEGORY_LABELS[e.category] || e.category,
            description: formatDescription(e.description) + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
            by: e.created_by_name || 'Unknown',
            amount: ((e.type === 'cash_in' || e.type === 'bank_in') ? '+' : '-') + fmt(e.amount),
        }))

    // The balances belong in the file, not just on screen: a statement of money
    // in and out that doesn't say what the drawer opened and closed at can't be
    // reconciled against anything. Carried in the Description/Amount columns so
    // one row shape serves CSV, Excel and PDF alike, with a blank line to keep
    // the summary from reading as more transactions.
    const summaryRows = [
        {},
        { description: 'Opening Cash',                    amount: fmt(totals.opening_cash_balance) },
        { description: 'Opening Bank',                    amount: fmt(totals.opening_bank_balance) },
        { description: 'Opening Balance (Cash + Bank)',   amount: fmt(openingCombined) },
        {},
        { description: 'Cash In',                         amount: '+' + fmt(totals.total_cash_in) },
        { description: 'Bank In',                         amount: '+' + fmt(totals.total_bank_in) },
        { description: 'Total Money In',                  amount: '+' + fmt(totals.total_money_in) },
        {},
        { description: 'Cash Out',                        amount: '-' + fmt(totals.total_cash_out) },
        { description: 'Bank Out',                        amount: '-' + fmt(totals.total_bank_out) },
        { description: 'Total Money Out',                 amount: '-' + fmt(totals.total_money_out) },
        {},
        { description: 'Net Change',                      amount: (netChange >= 0 ? '+' : '-') + fmt(Math.abs(netChange)) },
        { description: 'Closing Cash',                    amount: fmt(totals.closing_cash_balance) },
        { description: 'Closing Bank',                    amount: fmt(totals.closing_bank_balance) },
    ]

    // The figure the manager reconciles against, kept separate from the summary
    // block because the PDF renders it as a ruled footer rather than a row.
    // Folding it into both would print it twice on the same page.
    const closingRow = { description: 'Closing Balance (Cash + Bank)', amount: fmt(combinedClosing) }

    const statementRows = [...entryRows, ...summaryRows]
    const fileName = `day-book-${selectedDate}`
    const exportSubtitle = `${dateLabel}  |  Entries: ${entries.length}  |  In: ${fmt(totals.total_money_in)}  |  Out: ${fmt(totals.total_money_out)}`
    const cashierSection = cashierBreakdownSection(byCashier)

    // CSV and Excel have no footer of their own, so the closing balance is the
    // last row there.
    const flatRows = [...statementRows, closingRow]

    const handleExportCsv   = () => downloadCsv(fileName, reportColumns, flatRows, cashierSection ? [cashierSection] : undefined)
    const handleExportExcel = () => downloadExcel(fileName, reportColumns, flatRows, cashierSection ? [cashierSection] : undefined)
    const handleExportPdf   = () => downloadPdf(
        fileName,
        'Day Book Statement',
        exportSubtitle,
        reportColumns.map(c => ({ key: c.key, label: c.label, align: c.align })),
        statementRows,
        closingRow,
        cashierSection ? [cashierSection] : undefined,
    )

    return (
        <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                        <BookOpen className="text-amber-600" size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-ink">Day Book</h1>
                        <p className="text-xs text-ink-subtle mt-0.5 flex items-center gap-1.5">
                            <span>{dateLabel}</span>
                            {!isToday && (
                                <span className="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-black uppercase">
                                    Past day
                                </span>
                            )}
                            {navigating && <Loader2 size={11} className="animate-spin" />}
                        </p>
                    </div>
                </div>
                {session && (
                    <div className="flex gap-2 print:hidden">
                        <button
                            onClick={handleExportCsv}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors"
                        >
                            <Download size={14} /> CSV
                        </button>
                        <button
                            onClick={handleExportExcel}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors"
                        >
                            <Download size={14} /> Excel
                        </button>
                        <button
                            onClick={handleExportPdf}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors"
                        >
                            <Download size={14} /> PDF
                        </button>
                        <button
                            onClick={() => window.print()}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-surface text-ink hover:bg-surface-muted font-extrabold rounded-xl text-xs border border-hairline shadow-sm transition-colors"
                        >
                            <Printer size={14} /> Print
                        </button>
                    </div>
                )}
            </div>

            {/* Day picker — the whole page reads from whichever day (or range) is
                chosen here. Prev/next still step one day at a time; picking two
                different ends in the range fields switches to the aggregated
                statement view instead (DayBookRangeView, chosen in page.tsx). */}
            <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-3 flex items-center gap-2 flex-wrap print:hidden">
                <button
                    onClick={() => goToDate(shiftIsoDate(selectedDate, -1))}
                    disabled={navigating}
                    aria-label="Previous day"
                    className="p-2 rounded-xl border border-hairline text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-40 shrink-0"
                >
                    <ChevronLeft size={15} />
                </button>
                <div className="flex-1 min-w-[16rem]">
                    <DateRangePicker from={selectedDate} to={selectedDate} onChange={goToRange} allowAll={false} />
                </div>
                <button
                    // Tomorrow has no book yet, and stepping into it would only ever
                    // show the empty state.
                    onClick={() => goToDate(shiftIsoDate(selectedDate, 1))}
                    disabled={navigating || isToday || selectedDate >= todayDate}
                    aria-label="Next day"
                    className="p-2 rounded-xl border border-hairline text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-40 shrink-0"
                >
                    <ChevronRight size={15} />
                </button>
                {!isToday && (
                    <button
                        onClick={() => startNavigating(() => router.push('/admin/day-book'))}
                        disabled={navigating}
                        className="px-3 py-2 rounded-xl text-xs font-extrabold bg-surface-muted text-ink-muted hover:text-ink transition-colors disabled:opacity-40 shrink-0"
                    >
                        Back to today
                    </button>
                )}
            </div>

            {!session ? (
                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-16 text-center text-ink-subtle text-sm">
                    <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                    {isToday ? (
                        <>
                            No Day Book session is open yet.
                            <div className="mt-4 flex justify-center gap-3">
                                <Link href="/admin/cash-book" className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-extrabold rounded-xl text-xs border border-emerald-200 transition-colors">
                                    Open from Cash Book
                                </Link>
                                <Link href="/admin/bank-book" className="px-4 py-2 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 font-extrabold rounded-xl text-xs border border-cyan-200 transition-colors">
                                    Open from Bank Book
                                </Link>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* A past day with no session was never traded, or was
                                traded before the books were kept here. Offering to
                                open one would backdate a session, so it isn't offered. */}
                            No Day Book was kept for {dateLabel}.
                            <div className="mt-4 flex justify-center">
                                <button
                                    onClick={() => startNavigating(() => router.push('/admin/day-book'))}
                                    className="px-4 py-2 bg-surface-muted text-ink-muted hover:text-ink font-extrabold rounded-xl text-xs border border-hairline transition-colors"
                                >
                                    Back to today
                                </button>
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <>
                    {/* Quick summary strip */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                            <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                                <TrendingUp size={14} className="text-emerald-500" /> Total Money In
                            </div>
                            <p className="text-2xl font-black text-emerald-600 mt-2">+{fmt(totals.total_money_in)}</p>
                            <p className="text-[11px] text-ink-subtle mt-1">Cash + Bank received</p>
                        </div>
                        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                            <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                                <TrendingDown size={14} className="text-rose-500" /> Total Money Out
                            </div>
                            <p className="text-2xl font-black text-rose-600 mt-2">-{fmt(totals.total_money_out)}</p>
                            <p className="text-[11px] text-ink-subtle mt-1">Cash + Bank paid out</p>
                        </div>
                        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                            <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                                <Wallet size={14} className="text-ink-subtle" /> Cash Balance
                            </div>
                            <p className="text-2xl font-black text-ink mt-2">{fmt(totals.closing_cash_balance)}</p>
                            <p className="text-[11px] text-ink-subtle mt-1">Calculated current cash</p>
                        </div>
                        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-5">
                            <div className="flex items-center gap-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                                <Landmark size={14} className="text-ink-subtle" /> Bank Balance
                            </div>
                            <p className="text-2xl font-black text-ink mt-2">{fmt(totals.closing_bank_balance)}</p>
                            <p className="text-[11px] text-ink-subtle mt-1">Calculated current bank</p>
                        </div>
                    </div>

                    {/* Fixed Money In / Money Out sections */}
                    <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-hairline">
                            <h3 className="font-extrabold text-ink">Day Book Entries</h3>
                            <p className="text-xs text-ink-subtle mt-0.5">Cash and Bank transactions combined for {dateLabel}</p>
                        </div>

                        <div className="grid grid-cols-2 border-b border-hairline">
                            {(['in', 'out'] as const).map(side => {
                                const isIn = side === 'in'
                                const count = isIn ? moneyInEntries.length : moneyOutEntries.length
                                const active = ledgerTab === side
                                return (
                                    <button
                                        key={side}
                                        onClick={() => setLedgerTab(side)}
                                        className={`px-6 py-3 text-xs font-black uppercase tracking-wider transition-colors ${
                                            active
                                                ? (isIn ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')
                                                : 'bg-surface text-ink-subtle hover:bg-surface-muted'
                                        }`}
                                    >
                                        {isIn ? 'Money In' : 'Money Out'} ({count})
                                    </button>
                                )
                            })}
                        </div>

                        {(() => {
                            const isIn = ledgerTab === 'in'
                            const sideEntries = isIn ? moneyInEntries : moneyOutEntries
                            if (sideEntries.length === 0) {
                                return (
                                    <div className="p-16 text-center text-ink-subtle text-sm">
                                        <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                                        No money {isIn ? 'in' : 'out'} entries were logged on {dateLabel}.
                                    </div>
                                )
                            }
                            return (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline">
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-24">Date &amp; Time</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-20">Source</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-32">Category</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle">Description</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-32">Responsible Name</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle text-right w-36">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {sideEntries.map(e => {
                                                const cash = isSourceCash(e.type)
                                                return (
                                                    <tr key={e.id} className="hover:bg-surface-muted transition-colors">
                                                        <td className="px-6 py-4 text-ink-subtle font-semibold">
                                                            <div>{timeStr(e.created_at)}</div>
                                                            <div className="text-[10px] text-ink-subtle font-bold">{entryDateStr(e.created_at, calendar)}</div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                                                cash ? 'bg-surface-muted text-ink-subtle' : 'bg-cyan-50 text-cyan-700'
                                                            }`}>
                                                                {cash ? 'Cash' : 'Bank'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${
                                                                CATEGORY_COLORS[e.category] || 'bg-surface-muted text-ink-subtle border-hairline'
                                                            }`}>
                                                                {CATEGORY_LABELS[e.category] || e.category}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 font-bold text-ink">
                                                            {formatDescription(e.description)}
                                                            {e.bank_name && (
                                                                <span className="block text-[10px] text-ink-subtle font-bold mt-0.5">Bank: {e.bank_name}</span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4 font-bold text-ink">
                                                            {e.created_by_name || 'Unknown'}
                                                        </td>
                                                        <td className={`px-6 py-4 text-right font-extrabold text-sm ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                            {isIn ? '+' : '-'}{fmt(e.amount)}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        })()}
                    </div>

                    {/* Summary */}
                    <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-hairline">
                            <h3 className="font-extrabold text-ink">Summary</h3>
                            <p className="text-xs text-ink-subtle mt-0.5">Cash and Bank breakdown for {dateLabel}</p>
                        </div>
                        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Cash In</span>
                                    <span className="font-extrabold text-emerald-600">+{fmt(totals.total_cash_in)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Bank In</span>
                                    <span className="font-extrabold text-emerald-600">+{fmt(totals.total_bank_in)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm pt-2.5 border-t border-hairline">
                                    <span className="text-ink font-extrabold">Total Money In</span>
                                    <span className="font-black text-emerald-600">+{fmt(totals.total_money_in)}</span>
                                </div>
                            </div>
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Cash Out</span>
                                    <span className="font-extrabold text-rose-600">-{fmt(totals.total_cash_out)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Bank Out</span>
                                    <span className="font-extrabold text-rose-600">-{fmt(totals.total_bank_out)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm pt-2.5 border-t border-hairline">
                                    <span className="text-ink font-extrabold">Total Money Out</span>
                                    <span className="font-black text-rose-600">-{fmt(totals.total_money_out)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Opening Cash</span>
                                    <span className="font-extrabold text-ink">{fmt(totals.opening_cash_balance)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Opening Bank</span>
                                    <span className="font-extrabold text-ink">{fmt(totals.opening_bank_balance)}</span>
                                </div>
                            </div>
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Closing Cash</span>
                                    <span className="font-extrabold text-ink">{fmt(totals.closing_cash_balance)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-ink-subtle font-semibold">Closing Bank</span>
                                    <span className="font-extrabold text-ink">{fmt(totals.closing_bank_balance)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="px-5 pb-5">
                            <div className="rounded-xl bg-surface-muted border border-hairline p-4 flex items-center justify-between">
                                <span className="text-sm font-extrabold text-ink">Net Change</span>
                                <span className={`text-lg font-black ${netChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {netChange >= 0 ? '+' : '-'}{fmt(Math.abs(netChange))}
                                </span>
                            </div>
                            <div className="rounded-xl bg-ink p-4 flex items-center justify-between mt-3">
                                <span className="text-sm font-extrabold text-surface">Combined Closing Balance (Cash + Bank)</span>
                                <span className="text-lg font-black text-surface">{fmt(combinedClosing)}</span>
                            </div>
                        </div>
                    </div>

                    <CashierBreakdownPanel rows={byCashier} subtitle={`Who collected/paid what, from business open to close on ${dateLabel}`} />
                </>
            )}
        </div>
    )
}
