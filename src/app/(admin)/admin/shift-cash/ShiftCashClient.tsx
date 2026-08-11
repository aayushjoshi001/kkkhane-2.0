'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Wallet, User, Loader2, X, ChevronDown, Receipt, ReceiptText, Banknote, QrCode, Utensils, Zap, Tag, CreditCard, Key, LogOut, Clock, Hotel, BedDouble, RotateCcw, HandCoins } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { useConfirmStore } from '@/lib/stores/confirm'
import DateCell from '@/components/ui/DateCell'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { formatCurrency } from '@/lib/utils'
import { reconcileShiftCashAction } from './actions'
import { ShiftCashBreakdown, ShiftCashItem } from '@/lib/shiftCash'

export interface ShiftCashRow {
    id: string
    staffName: string
    clockIn: string
    clockOut: string | null
    expected: number
    counted: number | null
    variance: number | null
    reconciledAt: string | null
    reconciledByName?: string | null
    breakdown?: ShiftCashBreakdown
}

function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatusPill({ row }: { row: ShiftCashRow }) {
    if (!row.reconciledAt) {
        return <span className="text-[11px] font-bold uppercase tracking-wider bg-amber-50/50 text-amber-700/80 px-3 py-1 rounded-full border border-amber-200/50 inline-block">Pending</span>
    }

    const checkedByName = row.reconciledByName || 'Manager'
    const checkedTime = fmtTime(row.reconciledAt)

    if ((row.variance ?? 0) < 0) {
        return (
            <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-danger-bg text-danger-fg px-3 py-1 rounded-full border border-danger-fg/30 inline-block">Shortfall</span>
                <span className="text-[10px] font-semibold text-ink-subtle whitespace-nowrap">Checked by {checkedByName} at {checkedTime}</span>
            </div>
        )
    }
    if ((row.variance ?? 0) > 0) {
        return (
            <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-brand-50 text-brand-600 px-3 py-1 rounded-full border border-brand-200 inline-block">Surplus</span>
                <span className="text-[10px] font-semibold text-ink-subtle whitespace-nowrap">Checked by {checkedByName} at {checkedTime}</span>
            </div>
        )
    }
    return (
        <div className="flex flex-col items-center gap-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider bg-success-bg/20 text-success-fg px-3 py-1 rounded-full border border-success-bg inline-block">Checked</span>
            <span className="text-[10px] font-semibold text-ink-subtle whitespace-nowrap">Checked by {checkedByName} at {checkedTime}</span>
        </div>
    )
}

function CategoryBadge({ category }: { category: string }) {
    switch (category) {
        case 'room_deposit':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200"><Hotel size={11} /> Advance Payment</span>
        case 'booking_payment':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200"><BedDouble size={11} /> Room Settlement</span>
        case 'order_payment':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"><Utensils size={11} /> Dine-In / Order</span>
        case 'qr_payment':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200"><QrCode size={11} /> Direct QR</span>
        case 'refund':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200"><RotateCcw size={11} /> Guest Refund</span>
        case 'expense':
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"><HandCoins size={11} /> Expense / Payout</span>
        default:
            return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-surface-muted text-ink-subtle border border-hairline"><ReceiptText size={11} /> Billing Entry</span>
    }
}

// The Check & Collect form — an inline section inside the shift modal,
// toggled on by the "Check & Collect" button at the top, rather than its own
// popup. Its own Save action lives in a header pinned to the top of this
// section (not buried under the cash/QR fields) so it's reachable the
// instant the section is expanded.
function CollectCashPanel({ row, onSaved }: {
    row: ShiftCashRow
    onSaved: (updated: ShiftCashRow) => void
}) {
    const expectedCash = row.breakdown ? Math.round((row.breakdown.cashInTotal - row.breakdown.cashOutTotal) * 100) / 100 : row.expected
    const expectedQr = row.breakdown ? Math.round((row.breakdown.qrInTotal - row.breakdown.qrOutTotal) * 100) / 100 : 0
    const totalExpected = Math.round((expectedCash + expectedQr) * 100) / 100

    const [countedCashStr, setCountedCashStr] = useState(String(expectedCash))
    const [countedQrStr, setCountedQrStr] = useState(String(expectedQr))
    const [note, setNote] = useState('')
    const [saving, setSaving] = useState(false)
    const { confirm } = useConfirmStore()

    const countedCash = parseFloat(countedCashStr) || 0
    const countedQr = parseFloat(countedQrStr) || 0
    const totalCounted = Math.round((countedCash + countedQr) * 100) / 100
    const cashVariance = Math.round((countedCash - expectedCash) * 100) / 100
    const qrVariance = Math.round((countedQr - expectedQr) * 100) / 100
    const totalVariance = Math.round((totalCounted - totalExpected) * 100) / 100

    async function handleSave() {
        if (!Number.isFinite(countedCash) || countedCash < 0 || !Number.isFinite(countedQr) || countedQr < 0) {
            toast.error('Enter valid cash and QR amounts')
            return
        }

        if (totalVariance < 0) {
            const ok = await confirm({
                title: 'Record a cash shortfall?',
                message: `${row.staffName} has a net shortfall of ${formatCurrency(Math.abs(totalVariance))}. This will be deducted from their pay.`,
                confirmText: 'Deduct & Save',
                isDestructive: true,
            })
            if (!ok) return
        }

        setSaving(true)
        const result = await reconcileShiftCashAction(row.id, totalCounted, note || undefined, countedCash, countedQr)
        setSaving(false)

        if (result.error) {
            toast.error(result.error)
            return
        }

        toast.success(totalVariance < 0 ? 'Shortfall recorded and deducted from pay' : 'Cash & QR collection recorded')
        onSaved({
            ...row,
            counted: result.counted ?? totalCounted,
            expected: result.expected ?? totalExpected,
            variance: result.variance ?? totalVariance,
            reconciledAt: new Date().toISOString(),
        })
    }

    return (
        <div>
            {/* Save sits in this section's own header, at its top — reachable
                the instant the section is expanded rather than below a
                scroll of form fields. */}
            <div className="px-4 py-3 border-b border-hairline bg-brand-50/30 flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-ink flex items-center gap-1.5">
                    <Wallet size={14} className="text-brand-600" />
                    Check & Collect
                </span>
                <button onClick={handleSave} disabled={saving || countedCashStr === '' || countedQrStr === ''}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] transition-all disabled:opacity-50 flex items-center gap-1.5 focus-ring">
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    Save
                </button>
            </div>

            <div className="p-4 space-y-4">
                {/* 1. Physical Cash Section */}
                <div className="bg-surface rounded-xl border border-hairline p-3.5 space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between border-b border-hairline pb-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                                <Banknote size={12} />
                            </div>
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink">Cash Handed Over</span>
                        </div>
                        <div className="text-[10px] font-bold text-ink-subtle">
                            Expected: <span className="font-extrabold text-ink tabular-nums">{formatCurrency(expectedCash)}</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Cash Counted (Rs)</label>
                        <input
                            type="number" min="0" step="0.01" value={countedCashStr}
                            onChange={e => setCountedCashStr(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-2 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                        />
                    </div>
                    <div className="px-2.5 py-1.5 bg-surface-muted/30 rounded-[var(--r-md)] border border-hairline flex justify-between items-center">
                        <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Variance</span>
                        <span className={`text-xs font-extrabold tabular-nums ${cashVariance < 0 ? 'text-danger-fg' : cashVariance > 0 ? 'text-brand-600' : 'text-emerald-600'}`}>
                            {cashVariance === 0 ? 'Balanced' : `${cashVariance > 0 ? '+' : ''}${formatCurrency(cashVariance)}`}
                        </span>
                    </div>
                </div>

                {/* 2. QR / Digital Section */}
                <div className="bg-surface rounded-xl border border-hairline p-3.5 space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between border-b border-hairline pb-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                                <QrCode size={12} />
                            </div>
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink">QR / Digital Verified</span>
                        </div>
                        <div className="text-[10px] font-bold text-ink-subtle">
                            Expected: <span className="font-extrabold text-ink tabular-nums">{formatCurrency(expectedQr)}</span>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1">QR Verified (Rs)</label>
                        <input
                            type="number" min="0" step="0.01" value={countedQrStr}
                            onChange={e => setCountedQrStr(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-2 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                        />
                    </div>
                    <div className="px-2.5 py-1.5 bg-surface-muted/30 rounded-[var(--r-md)] border border-hairline flex justify-between items-center">
                        <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Variance</span>
                        <span className={`text-xs font-extrabold tabular-nums ${qrVariance < 0 ? 'text-danger-fg' : qrVariance > 0 ? 'text-brand-600' : 'text-teal-600'}`}>
                            {qrVariance === 0 ? 'Verified' : `${qrVariance > 0 ? '+' : ''}${formatCurrency(qrVariance)}`}
                        </span>
                    </div>
                </div>

                {/* Net Summary Bar */}
                <div className="p-3.5 rounded-xl border border-brand-200 bg-brand-50/30 space-y-2 shadow-xs">
                    <div className="text-[11px] font-extrabold text-ink uppercase tracking-wider">Net Shift Summary</div>
                    <div className="text-[10px] text-ink-subtle font-semibold">
                        Expected: <span className="text-ink font-bold tabular-nums">{formatCurrency(totalExpected)}</span> · Handed Over: <span className="text-ink font-bold tabular-nums">{formatCurrency(totalCounted)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Net Variance:</span>
                        <span className={`text-xs font-extrabold tabular-nums px-2.5 py-0.5 rounded-full border ${
                            totalVariance < 0
                                ? 'bg-danger-bg text-danger-fg border-danger-fg/30'
                                : totalVariance > 0
                                ? 'bg-brand-50 text-brand-600 border-brand-200'
                                : 'bg-success-bg/20 text-success-fg border-success-bg'
                        }`}>
                            {totalVariance === 0 ? 'Fully Reconciled' : `${totalVariance > 0 ? 'Surplus ' : 'Shortfall '}${formatCurrency(Math.abs(totalVariance))}`}
                        </span>
                    </div>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Note <span className="text-ink-muted normal-case">(optional)</span></label>
                    <input
                        type="text" value={note} onChange={e => setNote(e.target.value)}
                        placeholder="e.g. cash till discrepancy…"
                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5"
                    />
                </div>
            </div>
        </div>
    )
}

function ShiftTransactionsPanel({ breakdown }: { breakdown: ShiftCashBreakdown }) {
    const { metrics } = breakdown

    return (
        <div className="p-5 space-y-5 bg-surface-muted/20">
            {/* 1. Cash & Collection Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 bg-surface rounded-xl border border-hairline flex items-center gap-3 shadow-xs">
                    <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                        <Banknote size={16} />
                    </div>
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">Cash Received</div>
                        <div className="text-base font-extrabold text-ink tabular-nums">{formatCurrency(breakdown.cashInTotal)}</div>
                    </div>
                </div>

                <div className="p-3.5 bg-surface rounded-xl border border-hairline flex items-center gap-3 shadow-xs">
                    <div className="w-9 h-9 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                        <QrCode size={16} />
                    </div>
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">QR Received</div>
                        <div className="text-base font-extrabold text-ink tabular-nums">{formatCurrency(breakdown.qrInTotal)}</div>
                    </div>
                </div>

                <div className="p-3.5 bg-surface rounded-xl border border-indigo-200 bg-indigo-50/20 flex items-center gap-3 shadow-xs">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <Receipt size={16} />
                    </div>
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-900">Room Sales</div>
                        <div className="text-base font-extrabold text-indigo-700 tabular-nums">{formatCurrency(metrics.roomSalesTotal)}</div>
                        <div className="text-[9px] font-semibold text-indigo-600">Includes folio orders</div>
                    </div>
                </div>

                <div className="p-3.5 bg-surface rounded-xl border border-amber-200 bg-amber-50/20 flex items-center gap-3 shadow-xs">
                    <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <Utensils size={16} />
                    </div>
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-900">Restaurant Sales</div>
                        <div className="text-base font-extrabold text-amber-700 tabular-nums">{formatCurrency(metrics.restaurantSalesTotal)}</div>
                        <div className="text-[9px] font-semibold text-amber-600">Standalone dine-in</div>
                    </div>
                </div>
            </div>

            {/* 2. Secondary Financial Metrics Grid — Credit and Folio used to
                share one "Credit / Folio Sales" card, which read as a single
                figure when they're actually two different things: money owed
                on standalone orders (credit) vs. money still owing on a
                room's own bill at checkout (folio). Split so each is its own
                number with its own label. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-surface p-3 rounded-xl border border-hairline shadow-xs flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">Service Charge Collected</div>
                        <div className="text-sm font-extrabold text-ink tabular-nums mt-0.5">{formatCurrency(metrics.serviceChargeTotal)}</div>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                        <Zap size={14} />
                    </div>
                </div>

                <div className="bg-surface p-3 rounded-xl border border-hairline shadow-xs flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">Discounts Given</div>
                        <div className="text-sm font-extrabold text-rose-600 tabular-nums mt-0.5">{formatCurrency(metrics.discountTotal)}</div>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
                        <Tag size={14} />
                    </div>
                </div>

                <div className="bg-surface p-3 rounded-xl border border-hairline shadow-xs flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">Credit (Unpaid Orders)</div>
                        <div className="text-sm font-extrabold text-blue-600 tabular-nums mt-0.5">{formatCurrency(metrics.unpaidOrdersTotal)}</div>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                        <CreditCard size={14} />
                    </div>
                </div>

                <div className="bg-surface p-3 rounded-xl border border-hairline shadow-xs flex items-center justify-between">
                    <div>
                        <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle">Folio (Room Balance Owing)</div>
                        <div className="text-sm font-extrabold text-indigo-600 tabular-nums mt-0.5">{formatCurrency(metrics.folioOutstandingTotal)}</div>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <BedDouble size={14} />
                    </div>
                </div>
            </div>

            {/* 3. Room Check-ins & Check-outs Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Check-ins */}
                <div className="bg-surface p-3.5 rounded-xl border border-hairline shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between border-b border-hairline pb-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink flex items-center gap-1.5">
                            <Key size={14} className="text-indigo-600" /> Room Check-Ins ({metrics.roomCheckIns.length})
                        </span>
                    </div>
                    {metrics.roomCheckIns.length === 0 ? (
                        <div className="text-xs text-ink-muted py-1 font-medium">No room check-ins during this shift.</div>
                    ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {metrics.roomCheckIns.map(ci => (
                                <div key={ci.id} className="p-2 rounded-lg bg-surface-muted/30 border border-hairline flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 text-[11px]">Room {ci.roomNumber}</span>
                                        <span className="font-bold text-ink">{ci.guestName}</span>
                                    </div>
                                    <span className="font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                                        Adv: {formatCurrency(ci.advanceAmount)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Check-outs */}
                <div className="bg-surface p-3.5 rounded-xl border border-hairline shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between border-b border-hairline pb-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-ink flex items-center gap-1.5">
                            <LogOut size={14} className="text-amber-600" /> Room Check-Outs ({metrics.roomCheckOuts.length})
                        </span>
                    </div>
                    {metrics.roomCheckOuts.length === 0 ? (
                        <div className="text-xs text-ink-muted py-1 font-medium">No room check-outs during this shift.</div>
                    ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {metrics.roomCheckOuts.map(co => (
                                <div key={co.id} className="p-2 rounded-lg bg-surface-muted/30 border border-hairline flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-2">
                                        <span className="font-extrabold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-[11px]">Room {co.roomNumber}</span>
                                        <span className="font-bold text-ink">{co.guestName}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]">
                                            Settled: {formatCurrency(co.settledAmount)}
                                        </span>
                                        {co.outstandingAmount > 0 && (
                                            <span className="font-extrabold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 text-[10px]">
                                                Credit: {formatCurrency(co.outstandingAmount)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 4. Handover / Uncollected Balances Left for Next Shift */}
            {metrics.uncollectedHandovers.length > 0 && (
                <div className="bg-amber-50/40 border border-amber-200 p-3.5 rounded-xl space-y-2.5 shadow-xs">
                    <div className="flex items-center justify-between border-b border-amber-200/70 pb-2">
                        <div className="flex items-center gap-2">
                            <Clock size={15} className="text-amber-700" />
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-950">
                                Handover: Open / Uncollected Balances Left For Next Person
                            </span>
                        </div>
                        <span className="text-[11px] font-extrabold text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                            Total Uncollected: {formatCurrency(metrics.totalUncollectedHandover)}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {metrics.uncollectedHandovers.map(h => (
                            <div key={h.id} className="p-2.5 rounded-lg bg-surface border border-amber-200/80 flex items-center justify-between text-xs shadow-xs">
                                <div>
                                    <span className={`font-extrabold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${h.type === 'room' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                        {h.label}
                                    </span>
                                    <div className="text-ink-subtle font-medium mt-0.5">{h.description}</div>
                                </div>
                                <span className="font-extrabold text-amber-700 text-xs tabular-nums shrink-0 ml-2">
                                    {formatCurrency(h.amount)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 5. Itemized Day Book Billing Transactions Table */}
            <div className="space-y-2">
                <h4 className="text-[11px] font-extrabold text-ink uppercase tracking-wider flex items-center gap-1.5">
                    <Receipt size={14} className="text-brand-500" />
                    Billing Cash & QR Transactions Received ({breakdown.items.length})
                </h4>

                {breakdown.items.length === 0 ? (
                    <div className="p-4 text-center text-xs text-ink-muted bg-surface rounded-lg border border-hairline">
                        No Cash or QR billing transactions received during this shift window.
                    </div>
                ) : (
                    <div className="bg-surface rounded-lg border border-hairline overflow-hidden shadow-xs">
                        <table className="w-full text-xs">
                            <thead className="bg-surface-muted/50 border-b border-hairline text-ink-subtle font-bold">
                                <tr>
                                    <th className="text-left px-3 py-2">Time</th>
                                    <th className="text-left px-3 py-2">Type</th>
                                    <th className="text-left px-3 py-2">Description</th>
                                    <th className="text-center px-3 py-2">Payment Method</th>
                                    <th className="text-right px-3 py-2">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                                {breakdown.items.map((item: ShiftCashItem) => {
                                    const isPositive = item.type === 'cash_in' || item.type === 'bank_in'
                                    return (
                                        <tr key={item.id} className="hover:bg-surface-muted/30 transition-colors">
                                            <td className="px-3 py-2 text-ink-subtle font-medium tabular-nums">{fmtTime(item.createdAt)}</td>
                                            <td className="px-3 py-2"><CategoryBadge category={item.category} /></td>
                                            <td className="px-3 py-2 font-medium text-ink">{item.description}</td>
                                            <td className="px-3 py-2 text-center">
                                                {item.isCash ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        <Banknote size={11} /> Cash
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                                                        <QrCode size={11} /> QR / Digital {item.bankName ? `(${item.bankName})` : ''}
                                                    </span>
                                                )}
                                            </td>
                                            <td className={`px-3 py-2 text-right font-bold tabular-nums ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {isPositive ? '+' : '-'}{formatCurrency(item.amount)}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function ShiftCashClient({ rows: initialRows, from, to }: {
    rows: ShiftCashRow[]
    from: string
    to: string
}) {
    const router = useRouter()
    const [, startNavigating] = useTransition()
    const [rows, setRows] = useState(initialRows)
    const [viewingShiftId, setViewingShiftId] = useState<string | null>(null)
    // Hidden by default — the table only has a "View" action now; the Check
    // & Collect form lives exclusively inside that modal, behind its own
    // toggle at the top.
    const [showCollectForm, setShowCollectForm] = useState(false)

    function goToRange(range: { from: string | null; to: string | null }) {
        const f = range.from ?? from
        const t = range.to ?? f
        startNavigating(() => router.push(`/admin/shift-cash?from=${f}&to=${t}`))
    }

    function openView(shiftId: string) {
        setViewingShiftId(shiftId)
        setShowCollectForm(false)
    }

    const viewingRow = viewingShiftId ? rows.find(r => r.id === viewingShiftId) ?? null : null

    return (
        <div className="space-y-6">
            <div className="bg-surface p-4 rounded-xl border border-hairline-strong shadow-sm">
                <DateRangePicker from={from} to={to} onChange={goToRange} allowAll={false} />
            </div>

            <div className="bg-surface rounded-card border border-hairline overflow-x-auto shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-surface-muted/30 border-b border-hairline">
                        <tr>
                            <th className="text-left px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Staff</th>
                            <th className="text-left px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Date</th>
                            <th className="text-left px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">In/Out</th>
                            <th className="text-right px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Expected</th>
                            <th className="text-right px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Counted</th>
                            <th className="text-right px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Variance</th>
                            <th className="text-center px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Status</th>
                            <th className="text-right px-3 py-2.5 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {rows.map(row => {
                            const itemCount = row.breakdown?.items.length ?? 0

                            return (
                                <tr key={row.id} className="hover:bg-surface-muted/30 transition-colors">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-surface-muted border border-hairline flex items-center justify-center text-ink-subtle shrink-0">
                                                <User size={11} />
                                            </div>
                                            <span className="font-extrabold text-ink text-xs">{row.staffName}</span>
                                            {itemCount > 0 && (
                                                <span className="text-[9px] font-bold text-brand-600">
                                                    · {itemCount} txn{itemCount > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-ink-subtle font-medium"><DateCell value={row.clockIn} /></td>
                                    <td className="px-3 py-2 text-ink-subtle font-bold tabular-nums">
                                        {fmtTime(row.clockIn)}
                                        {' → '}
                                        {row.clockOut ? fmtTime(row.clockOut) : 'Ongoing'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-bold text-ink tabular-nums">{formatCurrency(row.expected)}</td>
                                    <td className="px-3 py-2 text-right font-bold text-ink tabular-nums">{row.counted != null ? formatCurrency(row.counted) : '—'}</td>
                                    <td className={`px-3 py-2 text-right font-bold tabular-nums ${row.variance == null ? 'text-ink-muted' : row.variance < 0 ? 'text-danger-fg' : row.variance > 0 ? 'text-brand-600' : 'text-success-fg'}`}>
                                        {row.variance != null ? formatCurrency(row.variance) : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center"><StatusPill row={row} /></td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end">
                                            {row.breakdown && (
                                                <button onClick={() => openView(row.id)}
                                                    className="px-2.5 py-1 rounded-[var(--r-md)] border border-hairline text-[10px] font-bold text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all flex items-center gap-1 shadow-sm bg-surface focus-ring">
                                                    <ChevronDown size={12} />
                                                    View
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                        {rows.length === 0 && (
                            <tr><td colSpan={8} className="px-3 py-12 text-center text-ink-muted font-bold text-sm whitespace-normal">No shifts in this range.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {viewingRow?.breakdown && (
                <Modal
                    open
                    onClose={() => setViewingShiftId(null)}
                    size="full"
                    ariaLabel={`Billing — ${viewingRow.staffName}`}
                    className="max-w-6xl h-[95dvh] sm:h-[92vh] flex flex-col"
                >
                    <div className="px-6 py-4 border-b border-hairline bg-surface-muted/30 flex justify-between items-center shrink-0 gap-3">
                        <div>
                            <h2 className="text-h3 font-extrabold text-ink">{viewingRow.staffName} — Shift Billing</h2>
                            <p className="text-xs text-ink-subtle font-semibold mt-0.5">
                                {fmtTime(viewingRow.clockIn)} → {viewingRow.clockOut ? fmtTime(viewingRow.clockOut) : 'Ongoing'}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {/* The toggle lives at the top of the modal — the
                                Check & Collect form only renders (see below)
                                once this is clicked, whether the modal was
                                opened via "View" or "Check & Collect". */}
                            <button onClick={() => setShowCollectForm(v => !v)}
                                className={`px-3.5 py-2 rounded-[var(--r-md)] border text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-sm focus-ring ${
                                    showCollectForm
                                        ? 'bg-brand-500 border-brand-500 text-white hover:bg-brand-600'
                                        : 'bg-surface border-hairline text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200'
                                }`}>
                                <Wallet size={13} />
                                {showCollectForm ? 'Hide Collect Form' : 'Check & Collect'}
                            </button>
                            <button onClick={() => setViewingShiftId(null)} className="w-8 h-8 rounded-full bg-surface border border-hairline flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors shadow-sm focus-ring">
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                    {/* Plain single column for just the view; once Check &
                        Collect is toggled on, it moves to the right as its
                        own distinctly-styled sidebar so it never reads as
                        part of the dashboard it sits beside. */}
                    <div className={`flex-1 min-h-0 overflow-hidden ${showCollectForm ? 'flex flex-col lg:flex-row' : 'flex flex-col'}`}>
                        <div className="flex-1 overflow-y-auto">
                            <ShiftTransactionsPanel breakdown={viewingRow.breakdown} />
                        </div>
                        {showCollectForm && (
                            <div className="w-full lg:w-[380px] shrink-0 overflow-y-auto border-t-4 lg:border-t-0 lg:border-l-4 border-brand-400 bg-brand-50/10">
                                <CollectCashPanel
                                    key={viewingRow.id}
                                    row={viewingRow}
                                    onSaved={(updated) => {
                                        setRows(prev => prev.map(r => r.id === updated.id ? updated : r))
                                        setShowCollectForm(false)
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    )
}
