'use client'

import { useState } from 'react'
import { generateEodReportAction } from './actions'
import { FileText, Calendar, TrendingUp, DollarSign } from 'lucide-react'
import toast from 'react-hot-toast'
import type { EodReport } from '@/types/database'

export default function ReportsViewer({ initialReports, restaurantId }: {
    initialReports: EodReport[]
    restaurantId: string
}) {
    const [reports, setReports] = useState(initialReports)
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
    const [generating, setGenerating] = useState(false)
    const [expanded, setExpanded] = useState<string | null>(null)

    async function handleGenerate() {
        setGenerating(true)
        const result = await generateEodReportAction(restaurantId, selectedDate)
        setGenerating(false)
        if (result.error) { toast.error(result.error); return }
        toast.success('Report generated!')
        // Refetch is handled by revalidation, but add to local state
        if (result.data) {
            setReports(prev => {
                const filtered = prev.filter(r => r.report_date !== selectedDate)
                return [result.data, ...filtered].sort((a, b) => b.report_date.localeCompare(a.report_date))
            })
        }
    }

    function fmt(n: number) {
        return `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
    }

    return (
        <div className="space-y-4">
            {/* Generate */}
            <div className="bg-surface rounded-card border border-hairline shadow-sm p-6 flex flex-wrap items-end gap-5">
                <div>
                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Report Date</label>
                    <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                        className="rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all" />
                </div>
                <button onClick={handleGenerate} disabled={generating}
                    className="flex items-center gap-2 bg-brand-500 text-white px-6 py-2.5 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 focus-ring">
                    <FileText size={16} /> {generating ? 'Generating...' : 'Generate Report'}
                </button>
            </div>

            {/* Reports List */}
            <div className="space-y-3">
                {reports.map(r => {
                    let notesText = r.notes || ''
                    let uniqueCustomers = r.total_orders // fallback
                    let rushHour = 'N/A'
                    let topSellers: Array<{ name: string; quantity: number; revenue: number }> = []
                    let paymentBreakdown: Record<string, number> = {}

                    if (r.notes) {
                        try {
                            const parsed = JSON.parse(r.notes)
                            if (parsed && typeof parsed === 'object') {
                                notesText = parsed.notesText || ''
                                uniqueCustomers = typeof parsed.uniqueCustomers === 'number' ? parsed.uniqueCustomers : r.total_orders
                                rushHour = parsed.rushHour || 'N/A'
                                topSellers = Array.isArray(parsed.topSellers) ? parsed.topSellers : []
                                paymentBreakdown = parsed.paymentBreakdown && typeof parsed.paymentBreakdown === 'object' && !Array.isArray(parsed.paymentBreakdown) ? parsed.paymentBreakdown : {}
                            }
                        } catch (e) {
                            // Keep default plain text notesText
                        }
                    }

                    return (
                        <div key={r.id} className="bg-surface rounded-card border border-hairline overflow-hidden shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200">
                            <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                                className="w-full px-6 py-5 flex items-center justify-between hover:bg-surface-muted/30 transition-colors focus-ring">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                                        <Calendar size={18} className="text-brand-600" />
                                    </div>
                                    <span className="font-extrabold text-ink text-base">{r.report_date}</span>
                                </div>
                                <div className="flex items-center gap-6 text-sm">
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
                            {expanded === r.id && (
                                <div className="px-6 pb-6 border-t border-hairline pt-6 space-y-6 bg-surface-muted/10">
                                    {/* Operational Stats Grid */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6 text-sm bg-surface p-6 rounded-[var(--r-md)] border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                        <Stat icon={<DollarSign size={14} className="text-ink-subtle" />} label="Gross Revenue" value={fmt(r.total_revenue)} />
                                        <Stat icon={<TrendingUp size={14} className="text-success-fg" />} label="Net Revenue" value={fmt(r.net_revenue)} />
                                        <Stat label="Tax Collected" value={fmt(r.total_tax)} />
                                        <Stat label="Discounts" value={fmt(r.total_discounts)} />
                                        <Stat label="Cash Total" value={fmt(r.cash_total)} />
                                        <Stat label="Card Total" value={fmt(r.card_total)} />
                                        <Stat label="Avg Order Spend" value={fmt(r.avg_order_value)} />
                                        <Stat label="Total Customers" value={String(uniqueCustomers)} />
                                        <Stat label="COGS" value={fmt(r.total_cogs)} />
                                        <Stat label="Gross Profit" value={fmt(r.gross_profit)} />
                                        <Stat label="Most Rush Hour" value={rushHour} />
                                        <Stat label="Tips" value={fmt(r.total_tips)} />
                                        <Stat label="Voids" value={String(r.total_voids)} />
                                        <Stat label="Refunds" value={String(r.total_refunds)} />
                                        <Stat label="Cancelled Orders" value={String(r.total_cancelled)} />
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

                                    {/* Breakdown & Best Sellers */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Left: Payment Method Breakdown */}
                                        <div className="bg-surface p-6 rounded-[var(--r-md)] border border-hairline shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Payment breakdown</h4>
                                            <div className="space-y-4">
                                                {Object.entries(paymentBreakdown).map(([method, amount]) => {
                                                    const n = typeof amount === 'number' ? amount : Number(amount) || 0
                                                    return (
                                                        <div key={method} className="flex justify-between text-sm items-center group">
                                                            <span className="capitalize text-ink-subtle font-bold group-hover:text-ink transition-colors">{method.replace('_', ' ')}</span>
                                                            <span className="font-extrabold text-ink tabular-nums">{fmt(n)}</span>
                                                        </div>
                                                    )
                                                })}
                                                {Object.keys(paymentBreakdown).length === 0 && (
                                                    <>
                                                        <div className="flex justify-between text-sm items-center">
                                                            <span className="text-ink-subtle font-bold">Cash</span>
                                                            <span className="font-extrabold text-ink tabular-nums">{fmt(r.cash_total)}</span>
                                                        </div>
                                                        <div className="flex justify-between text-sm items-center mt-3">
                                                            <span className="text-ink-subtle font-bold">Card & Others</span>
                                                            <span className="font-extrabold text-ink tabular-nums">{fmt(r.card_total)}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: Top 5 Best Sellers */}
                                        <div className="bg-surface p-6 rounded-[var(--r-md)] border border-hairline shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
                                            <h4 className="font-extrabold text-ink text-xs uppercase tracking-wider mb-5 border-b border-hairline pb-3">Top 5 Best Selling Items</h4>
                                            <div className="space-y-4">
                                                {topSellers.map((item, idx) => {
                                                    const name = item && typeof item === 'object' ? (item.name || 'Unknown Item') : 'Unknown Item'
                                                    const quantity = item && typeof item === 'object' ? (typeof item.quantity === 'number' ? item.quantity : Number(item.quantity) || 0) : 0
                                                    const revenue = item && typeof item === 'object' ? (typeof item.revenue === 'number' ? item.revenue : Number(item.revenue) || 0) : 0
                                                    return (
                                                        <div key={idx} className="flex justify-between text-sm items-center group">
                                                            <div className="flex items-center gap-3">
                                                                <span className="bg-surface-muted/50 border border-hairline text-ink-subtle w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold">{idx + 1}</span>
                                                                <span className="text-ink-subtle font-bold group-hover:text-ink transition-colors truncate max-w-[120px]">{name}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className="font-extrabold text-ink tabular-nums">{quantity} <span className="text-[10px] text-ink-subtle uppercase">sold</span></span>
                                                                <span className="text-[11px] text-ink-muted font-bold tabular-nums">({fmt(revenue)})</span>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                                {topSellers.length === 0 && (
                                                    <p className="text-sm text-ink-subtle font-bold italic text-center py-6">No item sales recorded for this date.</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    {notesText && (
                                        <div className="bg-brand-50 border border-brand-100 rounded-[var(--r-md)] p-5 shadow-[inset_0_2px_4px_rgba(251,99,3,0.03)]">
                                            <h5 className="text-brand-700 font-extrabold text-[11px] uppercase tracking-wider mb-2">Manager Notes</h5>
                                            <p className="text-ink font-medium text-sm whitespace-pre-line leading-relaxed">{notesText}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
                {reports.length === 0 && (
                    <div className="bg-surface rounded-card border border-hairline p-10 text-center text-ink-subtle font-bold shadow-sm">
                        No reports generated yet. Select a date and click Generate.
                    </div>
                )}
            </div>
        </div>
    )
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
    return (
        <div>
            <p className="text-ink-subtle text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">{icon}{label}</p>
            <p className="font-extrabold text-ink mt-1 tabular-nums">{value}</p>
        </div>
    )
}
