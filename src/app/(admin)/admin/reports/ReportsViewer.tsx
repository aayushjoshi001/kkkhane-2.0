'use client'

import { useState } from 'react'
import { generateEodReportAction } from './actions'
import { FileText, Calendar, TrendingUp, DollarSign, Printer, RefreshCw, Download, Banknote, Landmark, CreditCard, Receipt, XCircle, Percent, Wallet, BedDouble } from 'lucide-react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { fetchReportsData } from '@/lib/swr-fetchers'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import type { EodReport } from '@/types/database'
import type { EodReportNotes, PersonAmount } from '@/lib/reports'
import { getNstDateString } from '@/lib/timezone'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import { downloadPdf } from '@/lib/exportPdf'

function fmt(n: number) {
    return `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)}`
}

const EMPTY_NOTES: EodReportNotes = {
    notesText: '',
    uniqueCustomers: 0,
    rushHour: 'N/A',
    topSellers: [],
    paymentBreakdown: {},
    sessionOpenedAt: null,
    sessionClosedAt: null,
    cashByPerson: [],
    qrByPerson: [],
    creditByPerson: [],
    restaurantSales: 0,
    roomSales: 0,
    topRooms: [],
    totalExpense: 0,
    expenseByPerson: [],
    totalIncomeEntries: 0,
    incomeByPerson: [],
    cancelledByPerson: [],
    discountByPerson: [],
    serviceChargeByPerson: [],
}

/** Reads whatever shape `notes` actually is — old reports only have the
 *  original handful of fields, new ones have the full breakdown — filling in
 *  empty defaults for anything missing rather than crashing on it. */
function parseNotes(raw: string | null): EodReportNotes {
    if (!raw) return EMPTY_NOTES
    try {
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return EMPTY_NOTES
        return { ...EMPTY_NOTES, ...parsed }
    } catch {
        return { ...EMPTY_NOTES, notesText: raw }
    }
}

function timeLabel(iso: string | null) {
    if (!iso) return null
    return new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hour12: true })
}

/** Flattens a report + its parsed notes into metric/value rows for CSV,
 *  Excel and PDF export — every section on screen gets a row here too. */
function buildDetailRows(r: EodReport, notes: EodReportNotes): { metric: string; value: string }[] {
    const discountTotal = (r.total_discounts && r.total_discounts > 0) ? r.total_discounts : notes.discountByPerson.reduce((s, p) => s + p.amount, 0)
    const serviceChargeTotal = notes.paymentBreakdown?.service_charge ?? notes.serviceChargeByPerson.reduce((s, p) => s + p.amount, 0)

    const rows: { metric: string; value: string }[] = [
        { metric: 'Report Date', value: r.report_date },
        { metric: 'Business Day Opened', value: timeLabel(notes.sessionOpenedAt) || 'N/A' },
        { metric: 'Business Day Closed', value: timeLabel(notes.sessionClosedAt) || 'Still open' },
        { metric: 'Gross Revenue', value: fmt(r.total_revenue) },
        { metric: 'Net Revenue', value: fmt(r.net_revenue) },
        { metric: 'Restaurant Sales', value: fmt(notes.restaurantSales) },
        { metric: 'Room Sales', value: fmt(notes.roomSales) },
        { metric: 'Tax Collected', value: fmt(r.total_tax) },
        { metric: 'Discounts', value: fmt(discountTotal) },
        { metric: 'Service Charge', value: fmt(serviceChargeTotal) },
        { metric: 'Average Order Value', value: fmt(r.avg_order_value) },
        { metric: 'Total Customers', value: String(notes.uniqueCustomers) },
        { metric: 'COGS', value: fmt(r.total_cogs) },
        { metric: 'Gross Profit', value: fmt(r.gross_profit) },
        { metric: 'Most Rush Hour', value: notes.rushHour },
        { metric: 'Tips', value: fmt(r.total_tips) },
        { metric: 'Voids', value: String(r.total_voids) },
        { metric: 'Refunds', value: String(r.total_refunds) },
        { metric: 'Cancelled Orders', value: String(r.total_cancelled) },
        { metric: 'Cancellation Cost', value: fmt(r.total_cancellation_cost) },
        { metric: 'Unverified Payments', value: String(r.unverified_orders ?? 0) },
        { metric: 'Total Expense', value: fmt(notes.totalExpense) },
        { metric: 'Total Income Entries', value: fmt(notes.totalIncomeEntries) },
        { metric: '', value: '' },
        { metric: 'CASH COLLECTED — BY PERSON', value: '' },
        ...notes.cashByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'BANK / QR COLLECTED — BY PERSON', value: '' },
        ...notes.qrByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'CREDIT (ON ACCOUNT) — BY PERSON', value: '' },
        ...notes.creditByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'EXPENSE — BY PERSON (CASH / BANK / TOTAL)', value: '' },
        ...notes.expenseByPerson.map(p => ({ metric: p.name, value: `${fmt(p.cash)} / ${fmt(p.bank)} / ${fmt(p.total)}` })),
        { metric: '', value: '' },
        { metric: 'INCOME — BY PERSON', value: '' },
        ...notes.incomeByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'CANCELLATIONS — BY PERSON', value: '' },
        ...notes.cancelledByPerson.map(p => ({ metric: p.name, value: `${p.count} order${p.count === 1 ? '' : 's'}, ${fmt(p.amount)}` })),
        { metric: '', value: '' },
        { metric: 'DISCOUNTS — BY PERSON', value: '' },
        ...notes.discountByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'SERVICE CHARGE — BY PERSON', value: '' },
        ...notes.serviceChargeByPerson.map(p => ({ metric: p.name, value: fmt(p.amount) })),
        { metric: '', value: '' },
        { metric: 'TOP 5 BEST-SELLING ITEMS', value: '' },
        ...notes.topSellers.map((s, i) => ({ metric: `${i + 1}. ${s.name}`, value: `${s.quantity} sold, ${fmt(s.revenue)}` })),
        { metric: '', value: '' },
        { metric: 'TOP 5 ROOMS', value: '' },
        ...notes.topRooms.map((rm, i) => ({ metric: `${i + 1}. Room ${rm.roomNumber}${rm.roomType ? ` (${rm.roomType})` : ''}`, value: `${rm.bookings} stay${rm.bookings === 1 ? '' : 's'}, ${fmt(rm.revenue)}` })),
    ]
    if (notes.notesText) rows.push({ metric: '', value: '' }, { metric: 'Manager Notes', value: notes.notesText })
    return rows
}

const DETAIL_COLUMNS = [
    { key: 'metric', label: 'Metric' },
    { key: 'value', label: 'Value', align: 'right' as const },
]

export default function ReportsViewer({ initialReports, restaurantId }: {
    initialReports: EodReport[]
    restaurantId: string
}) {
    const { data: reports = initialReports, mutate } = useSWR(['reports', restaurantId], () => fetchReportsData(restaurantId), { fallbackData: initialReports })
    // A report generated elsewhere — the nightly cron job, or another
    // manager recalculating a day — used to sit invisible here until this
    // tab was refocused or reloaded. Revalidating the same SWR fetch on any
    // eod_reports change keeps the list live without disturbing scroll
    // position or which report is currently expanded.
    useRestaurantTable(restaurantId, 'eod_reports', () => mutate())
    const [generating, setGenerating] = useState(false)
    const [expanded, setExpanded] = useState<string | null>(null)
    const [customDate, setCustomDate] = useState(getNstDateString())

    async function handleGenerateDate(dateStr: string) {
        if (!dateStr) return
        setGenerating(true)
        const result = await generateEodReportAction(restaurantId, dateStr)
        setGenerating(false)
        if (result.error) { toast.error(result.error); return }
        toast.success(`EOD Report for ${dateStr} updated successfully!`)
        if (result.data) {
            mutate()
            setExpanded(result.data.id)
        }
    }

    return (
        <div className="space-y-4">
            {/* Load Today's Report */}
            <div className="print:hidden bg-surface rounded-card border border-hairline shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-5">
                <div>
                    <p className="font-extrabold text-ink text-sm">Generate End of Day Report</p>
                    <p className="text-ink-subtle text-xs font-bold mt-0.5">Run or regenerate reports for today or any past date. Each report covers exactly the window the business day was open — from open to close.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        type="date"
                        value={customDate}
                        onChange={e => setCustomDate(e.target.value)}
                        className="px-3 py-2 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                    <button
                        onClick={() => handleGenerateDate(customDate)}
                        disabled={generating || !customDate}
                        className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:-translate-y-0.5 transition-all disabled:opacity-50 focus-ring"
                    >
                        <FileText size={14} /> {generating ? 'Generating...' : 'Generate Report'}
                    </button>
                    <button
                        onClick={() => handleGenerateDate(getNstDateString())}
                        disabled={generating}
                        className="flex items-center gap-2 bg-surface border border-hairline text-ink px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm hover:bg-surface-muted/40 transition-all focus-ring"
                    >
                        <RefreshCw size={14} className={generating ? 'animate-spin' : ''} /> Today
                    </button>
                </div>
            </div>

            {/* Reports List */}
            <div className="space-y-3">
                {reports.map(r => {
                    const notes = parseNotes(r.notes)
                    const isExpanded = expanded === r.id
                    const detailRows = isExpanded ? buildDetailRows(r, notes) : []
                    const openedLabel = timeLabel(notes.sessionOpenedAt)
                    const closedLabel = timeLabel(notes.sessionClosedAt)

                    return (
                        <div key={r.id} className="bg-surface rounded-card border border-hairline overflow-hidden shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200">
                            <button onClick={() => setExpanded(isExpanded ? null : r.id)}
                                className="w-full px-4 sm:px-6 py-5 flex items-center justify-between gap-3 hover:bg-surface-muted/30 transition-colors focus-ring">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                                        <Calendar size={18} className="text-brand-600" />
                                    </div>
                                    <span className="font-extrabold text-ink text-base truncate">{r.report_date}</span>
                                </div>
                                <div className="flex items-center gap-3 sm:gap-6 text-sm shrink-0">
                                    <div className="text-right">
                                        <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider">Revenue</p>
                                        <p className="font-extrabold text-ink text-base tabular-nums mt-0.5">{fmt(r.total_revenue)}</p>
                                    </div>
                                    <div className="text-right hidden md:block">
                                        <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider">Orders</p>
                                        <p className="font-extrabold text-ink tabular-nums mt-0.5">{r.total_orders}</p>
                                    </div>
                                    <div className="text-right hidden md:block">
                                        <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider">Net</p>
                                        <p className="font-extrabold text-success-fg tabular-nums mt-0.5">{fmt(r.net_revenue)}</p>
                                    </div>
                                </div>
                            </button>
                            {isExpanded && (
                                <div className="px-4 sm:px-6 pb-6 border-t border-hairline pt-6 space-y-6 bg-surface-muted/10">
                                    <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-hairline px-4 py-3 rounded-2xl shadow-sm print:hidden">
                                        <div className="min-w-0">
                                            <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider">Business Day Window</p>
                                            <p className="text-xs font-bold text-ink mt-0.5">
                                                {openedLabel ? `${openedLabel} → ${closedLabel || 'still open'}` : 'No day-book session — calendar day used'}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                onClick={() => handleGenerateDate(r.report_date)}
                                                disabled={generating}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all focus-ring shadow-sm"
                                            >
                                                <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
                                                Recalculate
                                            </button>
                                            <button
                                                onClick={() => downloadCsv(`eod-report-${r.report_date}`, DETAIL_COLUMNS, detailRows)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all focus-ring shadow-sm"
                                            >
                                                <Download size={12} /> CSV
                                            </button>
                                            <button
                                                onClick={() => downloadExcel(`eod-report-${r.report_date}`, DETAIL_COLUMNS, detailRows)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all focus-ring shadow-sm"
                                            >
                                                <Download size={12} /> Excel
                                            </button>
                                            <button
                                                onClick={() => downloadPdf(`eod-report-${r.report_date}`, `End of Day Report — ${r.report_date}`, `Revenue: ${fmt(r.total_revenue)}  |  Net: ${fmt(r.net_revenue)}  |  Orders: ${r.total_orders}`, DETAIL_COLUMNS, detailRows)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all focus-ring shadow-sm"
                                            >
                                                <Download size={12} /> PDF
                                            </button>
                                            <button
                                                onClick={() => window.print()}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all focus-ring shadow-sm"
                                            >
                                                <Printer size={12} /> Print
                                            </button>
                                        </div>
                                    </div>

                                    {/* Operational & Financial Stats Grid */}
                                    {(() => {
                                        const discountTotal = (r.total_discounts && r.total_discounts > 0) ? r.total_discounts : notes.discountByPerson.reduce((s, p) => s + p.amount, 0)
                                        const serviceChargeTotal = notes.paymentBreakdown?.service_charge ?? notes.serviceChargeByPerson.reduce((s, p) => s + p.amount, 0)
                                        return (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-6 text-sm bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                                <Stat label="Gross Revenue" value={fmt(r.total_revenue)} />
                                                <Stat label="Net Revenue" value={fmt(r.net_revenue)} />
                                                <Stat label="Restaurant Sales" value={fmt(notes.restaurantSales)} />
                                                <Stat label="Room Sales" value={fmt(notes.roomSales)} />
                                                <Stat label="Tax" value={fmt(r.total_tax)} />
                                                <Stat label="Discounts" value={fmt(discountTotal)} />
                                                <Stat label="Service Charge" value={fmt(serviceChargeTotal)} />
                                                <Stat label="COGS" value={fmt(r.total_cogs)} />
                                                <Stat label="Gross Profit" value={fmt(r.gross_profit)} />
                                                <Stat label="Total Expense" value={fmt(notes.totalExpense)} />
                                                <Stat label="Total Income" value={fmt(notes.totalIncomeEntries)} />
                                                <Stat label="Avg Order Spend" value={fmt(r.avg_order_value)} />
                                                <Stat label="Total Customers" value={String(notes.uniqueCustomers)} />
                                                <Stat label="Most Rush Hour" value={notes.rushHour} />
                                                <Stat label="Tips" value={fmt(r.total_tips)} />
                                                <Stat label="Voids" value={String(r.total_voids)} />
                                                <Stat label="Refunds" value={String(r.total_refunds)} />
                                                <Stat label="Cancelled Orders" value={String(r.total_cancelled)} />
                                                <Stat label="Cancellation Cost" value={fmt(r.total_cancellation_cost)} />
                                                <div>
                                                    <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">Unverified Payments</p>
                                                    <p className={`font-extrabold mt-1 tabular-nums ${(r.unverified_orders ?? 0) > 0 ? 'text-danger-fg' : 'text-ink'}`}>
                                                        {r.unverified_orders ?? 0}
                                                        {(r.unverified_orders ?? 0) > 0 && (
                                                            <span className="ml-2 text-[10px] bg-danger-bg/30 border border-danger-bg text-danger-fg px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">⚠ investigate</span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                        )
                                    })()}

                                    {/* Who collected how much */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                                        <PersonAmountCard icon={<Banknote size={14} className="text-emerald-600" />} title="Cash — by person" items={notes.cashByPerson} emptyLabel="No cash collected." />
                                        <PersonAmountCard icon={<Landmark size={14} className="text-blue-600" />} title="Bank / QR — by person" items={notes.qrByPerson} emptyLabel="No bank/QR collected." />
                                        <PersonAmountCard icon={<CreditCard size={14} className="text-amber-700" />} title="Credit (on account) — by person" items={notes.creditByPerson} emptyLabel="No credit charged." />
                                    </div>

                                    {/* Expense / income by person */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                                        <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-sm">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3 flex items-center gap-1.5"><Wallet size={14} className="text-rose-600" /> Expense — by person</h4>
                                            {notes.expenseByPerson.length === 0 ? (
                                                <p className="text-sm text-ink-subtle font-bold text-center py-6">No expenses recorded.</p>
                                            ) : (
                                                <div className="space-y-4 overflow-x-auto">
                                                    {notes.expenseByPerson.map(p => (
                                                        <div key={p.name} className="flex items-center justify-between gap-3 text-sm">
                                                            <span className="text-ink font-bold truncate">{p.name}</span>
                                                            <span className="text-ink-subtle text-[11px] font-bold shrink-0">Cash {fmt(p.cash)} · Bank {fmt(p.bank)}</span>
                                                            <span className="font-extrabold text-ink tabular-nums shrink-0">{fmt(p.total)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <PersonAmountCard icon={<TrendingUp size={14} className="text-emerald-600" />} title="Income entries — by person" items={notes.incomeByPerson} emptyLabel="No income entries recorded." />
                                    </div>

                                    {/* Cancellations / discounts / service charge by person */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                                        <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-sm">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3 flex items-center gap-1.5"><XCircle size={14} className="text-rose-600" /> Cancellations — by person</h4>
                                            {notes.cancelledByPerson.length === 0 ? (
                                                <p className="text-sm text-ink-subtle font-bold text-center py-6">No cancellations with a food cost.</p>
                                            ) : (
                                                <div className="space-y-4">
                                                    {notes.cancelledByPerson.map(p => (
                                                        <div key={p.name} className="flex items-center justify-between gap-3 text-sm">
                                                            <span className="text-ink font-bold truncate">{p.name}</span>
                                                            <span className="text-ink-subtle text-[11px] font-bold shrink-0">{p.count} order{p.count === 1 ? '' : 's'}</span>
                                                            <span className="font-extrabold text-rose-600 tabular-nums shrink-0">{fmt(p.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <PersonAmountCard icon={<Percent size={14} className="text-amber-700" />} title="Discounts — by person" items={notes.discountByPerson} emptyLabel="No discounts applied." />
                                        <PersonAmountCard icon={<Receipt size={14} className="text-brand-600" />} title="Service charge — by person" items={notes.serviceChargeByPerson} emptyLabel="No service charge collected." />
                                    </div>

                                    {/* Breakdown & Best Sellers */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                                        <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Payment breakdown</h4>
                                            <div className="space-y-4">
                                                {(() => {
                                                    const pb = notes.paymentBreakdown || {}
                                                    const cash = pb.cash ?? notes.cashByPerson.reduce((s, p) => s + p.amount, 0) ?? r.cash_total ?? 0
                                                    const qr = pb.qr ?? notes.qrByPerson.reduce((s, p) => s + p.amount, 0) ?? 0
                                                    const credit = pb.credit ?? notes.creditByPerson.reduce((s, p) => s + p.amount, 0) ?? 0
                                                    const cheque = pb.cheque ?? 0
                                                    const card = pb.card ?? (r.card_total > 0 ? Math.max(0, r.card_total - qr - credit - cheque) : 0)
                                                    const serviceCharge = pb.service_charge ?? notes.serviceChargeByPerson.reduce((s, p) => s + p.amount, 0) ?? 0

                                                    const breakdownList = [
                                                        { label: 'Cash', amount: cash },
                                                        { label: 'QR', amount: qr },
                                                        { label: 'Credit', amount: credit },
                                                        { label: 'Cheque', amount: cheque },
                                                        { label: 'Card', amount: card },
                                                        { label: 'Service Charge', amount: serviceCharge },
                                                    ]

                                                    return breakdownList.map(item => (
                                                        <div key={item.label} className="flex justify-between text-sm items-center group">
                                                            <span className="capitalize text-ink-subtle font-bold group-hover:text-ink transition-colors">{item.label}</span>
                                                            <span className="font-extrabold text-ink tabular-nums">{fmt(item.amount)}</span>
                                                        </div>
                                                    ))
                                                })()}
                                            </div>
                                        </div>

                                        <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Top 5 Best Selling Items</h4>
                                            <div className="space-y-4">
                                                {notes.topSellers.map((item, idx) => (
                                                    <div key={idx} className="flex justify-between text-sm items-center group">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <span className="bg-surface-muted/50 border border-hairline text-ink-subtle w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0">{idx + 1}</span>
                                                            <span className="text-ink-subtle font-bold group-hover:text-ink transition-colors truncate">{item.name}</span>
                                                        </div>
                                                        <div className="flex items-center gap-3 shrink-0">
                                                            <span className="font-extrabold text-ink tabular-nums">{item.quantity} <span className="text-[10px] text-ink-subtle uppercase">sold</span></span>
                                                            <span className="text-[11px] text-ink-muted font-bold tabular-nums">({fmt(item.revenue)})</span>
                                                        </div>
                                                    </div>
                                                ))}
                                                {notes.topSellers.length === 0 && (
                                                    <p className="text-sm text-ink-subtle font-bold italic text-center py-6">No item sales recorded for this date.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Top 5 rooms */}
                                    <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                        <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3 flex items-center gap-1.5"><BedDouble size={14} className="text-brand-600" /> Top 5 Rooms</h4>
                                        <div className="space-y-4">
                                            {notes.topRooms.map((rm, idx) => (
                                                <div key={idx} className="flex justify-between text-sm items-center group">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <span className="bg-surface-muted/50 border border-hairline text-ink-subtle w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0">{idx + 1}</span>
                                                        <span className="text-ink-subtle font-bold group-hover:text-ink transition-colors truncate">Room {rm.roomNumber}{rm.roomType ? ` · ${rm.roomType}` : ''}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <span className="font-extrabold text-ink tabular-nums">{rm.bookings} stay{rm.bookings === 1 ? '' : 's'}</span>
                                                        <span className="text-[11px] text-ink-muted font-bold tabular-nums">({fmt(rm.revenue)})</span>
                                                    </div>
                                                </div>
                                            ))}
                                            {notes.topRooms.length === 0 && (
                                                <p className="text-sm text-ink-subtle font-bold italic text-center py-6">No rooms settled for this date.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    {notes.notesText && (
                                        <div className="bg-brand-50 border border-brand-100 rounded-[var(--r-md)] p-5 shadow-[inset_0_2px_4px_rgba(251,99,3,0.03)]">
                                            <h5 className="text-brand-700 font-extrabold text-[11px] uppercase tracking-wider mb-2">Manager Notes</h5>
                                            <p className="text-ink font-medium text-sm whitespace-pre-line leading-relaxed">{notes.notesText}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
                {reports.length === 0 && (
                    <div className="bg-surface rounded-card border border-hairline p-10 text-center text-ink-subtle font-bold shadow-sm">
                        No reports yet. Click &quot;Generate Report&quot; to get started.
                    </div>
                )}
            </div>
        </div>
    )
}



function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
    return (
        <div className="min-w-0">
            <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">{icon}{label}</p>
            <p className="font-extrabold text-ink mt-1 tabular-nums truncate">{value}</p>
        </div>
    )
}

function PersonAmountCard({ icon, title, items, emptyLabel }: { icon: React.ReactNode; title: string; items: PersonAmount[]; emptyLabel: string }) {
    return (
        <div className="bg-surface p-4 sm:p-6 rounded-[var(--r-md)] border border-hairline shadow-sm">
            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3 flex items-center gap-1.5">{icon} {title}</h4>
            {items.length === 0 ? (
                <p className="text-sm text-ink-subtle font-bold text-center py-6">{emptyLabel}</p>
            ) : (
                <div className="space-y-4">
                    {items.map(p => (
                        <div key={p.name} className="flex justify-between text-sm items-center gap-3">
                            <span className="text-ink-subtle font-bold truncate">{p.name}</span>
                            <span className="font-extrabold text-ink tabular-nums shrink-0">{fmt(p.amount)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
