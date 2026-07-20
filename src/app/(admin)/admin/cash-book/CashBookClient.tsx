'use client'

import { useState, useCallback, useRef } from 'react'
import {
    TrendingUp, TrendingDown, Plus, X, Loader2,
    Wallet, Lock, Trash2, CalendarDays, CheckCircle2, AlertCircle,
    Download, Printer
} from 'lucide-react'
import type { BankAccount, DayBookSession, DayBookEntry, DayBookEntryCategory, ExpenseCategory } from '@/types/database'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { toNepaliDate } from '@/lib/nepaliDate'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'

interface CashBookClientProps {
    initialSession: DayBookSession | null
    initialEntries: DayBookEntry[]
    initialTotals: {
        total_cash_in: number
        total_cash_out: number
        closing_balance: number
    }
    todayDate: string   // YYYY-MM-DD
    userRole: string
    previousClosingBalance: number | null
    previousClosingBankBalance: number
    expenseCategories: ExpenseCategory[]
    bankAccounts: BankAccount[]
}

const OTHERS_BANK_VALUE = '__others__'

const CATEGORY_LABELS: Record<string, string> = {
    order_payment:    'Order Payment',
    room_deposit:     'Room Deposit',
    booking_payment:  'Booking Payment',
    expense:          'Expense',
    refund:           'Refund',
    salary:           'Salary / Wage',
    advance:          'Advance',
    bank_deposit:     'Bank Deposit',
    withdrawal:       'Bank Withdrawal',
    other:            'Other',
}

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

// A session stays open across midnight until the manager closes it, so an
// entry's real calendar date can differ from the day the session was opened
// on — show it next to the time so cash counting always reflects when the
// money actually moved, not just what business day it's filed under.
function entryDateStr(iso: string) {
    const d = new Date(iso)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${d.getDate()} ${months[d.getMonth()]}`
}

function formatDescription(desc: string): string {
    if (!desc) return ''
    if (desc.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(desc)
            if (parsed.voucher_type && parsed.voucher_number) {
                const typeLabel = parsed.voucher_type === 'receipt' ? 'Receipt' : 'Payment'
                const partyLabel = parsed.party_name ? ` (To: ${parsed.party_name})` : ''
                const receivedFromLabel = parsed.party_name && parsed.voucher_type === 'receipt' ? ` (From: ${parsed.party_name})` : partyLabel
                return `${typeLabel} ${parsed.voucher_number}${receivedFromLabel} - ${parsed.particulars || 'No details'}`
            }
        } catch {
            // fallback
        }
    }
    return desc
}

export default function CashBookClient({
    initialSession,
    initialEntries,
    initialTotals,
    todayDate,
    userRole,
    previousClosingBalance,
    previousClosingBankBalance,
    expenseCategories,
    bankAccounts,
}: CashBookClientProps) {
    const { confirm } = useConfirmStore()
    const [session, setSession]   = useState<DayBookSession | null>(initialSession)
    const [entries, setEntries]   = useState<DayBookEntry[]>(initialEntries)
    const [totals, setTotals]     = useState(initialTotals)
    const [isOtherBank, setIsOtherBank] = useState(false)
    const [ledgerTab, setLedgerTab] = useState<'cash_in' | 'cash_out'>('cash_in')

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'time', label: 'Time' },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
    ]
    const reportRows = entries.map(e => ({
        time: timeStr(e.created_at),
        type: e.type === 'cash_in' ? 'IN' : 'OUT',
        category: CATEGORY_LABELS[e.category] || e.category,
        description: formatDescription(e.description) + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
        amount: (e.type === 'cash_in' ? '+' : '-') + fmt(e.amount),
    }))
    const handleExportCsv = () => downloadCsv(`cash-book-${todayDate}`, reportColumns, reportRows)

    // Open Day state
    const [isOpeningDay, setIsOpeningDay]       = useState(false)
    const [openingBalanceInput, setOpeningBalanceInput] = useState(
        previousClosingBalance !== null ? String(previousClosingBalance) : ''
    )
    const [isSubmittingOpen, setIsSubmittingOpen] = useState(false)

    // Add Entry modal
    const EMPTY_ENTRY_FORM = { amount: '', description: '', category: 'other' as DayBookEntryCategory, bank_name: '', expense_category_id: '' }
    const [entryModal, setEntryModal] = useState<{ type: 'cash_in' | 'cash_out' } | null>(null)
    const [entryForm, setEntryForm]   = useState(EMPTY_ENTRY_FORM)
    const [isSubmittingEntry, setIsSubmittingEntry] = useState(false)

    // Reset on open so a Cash Out-only category (e.g. 'expense') left behind by
    // a cancelled entry can't be submitted against a Cash In.
    const openEntryModal = (type: 'cash_in' | 'cash_out') => {
        setEntryForm(EMPTY_ENTRY_FORM)
        setIsOtherBank(false)
        setEntryModal({ type })
    }

    // Close Day
    const [isClosingDay, setIsClosingDay] = useState(false)

    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)

    // ── Refresh totals from entries ──────────────────────────
    const recalc = useCallback((updatedEntries: DayBookEntry[], openingBal: number) => {
        const cashIn  = updatedEntries.filter(e => e.type === 'cash_in').reduce((s, e) => s + e.amount, 0)
        const cashOut = updatedEntries.filter(e => e.type === 'cash_out').reduce((s, e) => s + e.amount, 0)

        setTotals({
            total_cash_in: cashIn,
            total_cash_out: cashOut,
            closing_balance: openingBal + cashIn - cashOut,
        })
    }, [])

    // ── Open Day ─────────────────────────────────────────────
    const handleOpenDay = async () => {
        const bal = parseFloat(openingBalanceInput)
        if (isNaN(bal) || bal < 0) { toast.error('Enter a valid opening cash balance'); return }
        setIsSubmittingOpen(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opening_balance: bal, opening_bank_balance: previousClosingBankBalance, date: todayDate }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setSession(data.data)
            setEntries([])
            setTotals({
                total_cash_in: 0,
                total_cash_out: 0,
                closing_balance: bal,
            })
            setIsOpeningDay(false)
            toast.success('Cash Book opened successfully!')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to open Cash Book'
            toast.error(errMsg)
        } finally {
            setIsSubmittingOpen(false)
        }
    }

    // ── Add Entry ────────────────────────────────────────────
    const handleAddEntry = async () => {
        if (!entryModal || !session) return
        const amount = parseFloat(entryForm.amount)
        if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
        if (!entryForm.description.trim()) { toast.error('Description is required'); return }
        if (entryForm.category === 'bank_deposit' && !entryForm.bank_name.trim()) {
            toast.error('Bank name is required for bank deposits');
            return
        }
        if (entryForm.category === 'expense' && !entryForm.expense_category_id) {
            toast.error('Expense category is required');
            return
        }

        setIsSubmittingEntry(true)
        try {
            const res = await fetch('/api/day-book/entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: session.id,
                    type: entryModal.type,
                    amount,
                    description: entryForm.description.trim(),
                    category: entryForm.category,
                    bank_name: (entryForm.category === 'bank_deposit') ? entryForm.bank_name.trim() : null,
                    expense_category_id: (entryForm.category === 'expense') ? entryForm.expense_category_id : undefined,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            const newEntries = [data.data]

            // If cash_out is a bank_deposit, automatically insert a matching bank_in entry of category 'deposit'
            if (entryModal.type === 'cash_out' && entryForm.category === 'bank_deposit') {
                try {
                    const autoRes = await fetch('/api/day-book/entries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: session.id,
                            type: 'bank_in',
                            amount,
                            description: `Deposit: ${entryForm.description.trim()}`,
                            category: 'deposit',
                            bank_name: entryForm.bank_name.trim(),
                        }),
                    })
                    if (autoRes.ok) {
                        toast.success('Cash Out logged and deposited to Bank successfully!')
                    } else {
                        // The cash already left the till; the operator has to know
                        // the matching bank entry never landed.
                        const autoData = await autoRes.json().catch(() => ({}))
                        toast.error(
                            `Cash Out logged, but the matching Bank deposit failed: ${autoData.error ?? autoRes.statusText}. Add it to the Bank Book manually.`
                        )
                    }
                } catch (autoErr) {
                    console.error('Failed to auto-create bank entry', autoErr)
                    toast.error('Cash Out logged, but the matching Bank deposit failed. Add it to the Bank Book manually.')
                }
            } else {
                toast.success('Cash transaction logged successfully!')
            }

            const updated = [...newEntries, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_balance)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'other', bank_name: '', expense_category_id: '' })
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to add entry'
            toast.error(errMsg)
        } finally {
            setIsSubmittingEntry(false)
        }
    }

    // ── Delete Entry ─────────────────────────────────────────
    const handleDeleteEntry = async (id: string) => {
        const ok = await confirm({ title: 'Delete this entry?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        try {
            const res = await fetch(`/api/day-book/entries?id=${id}`, { method: 'DELETE' })
            if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
            const updated = entries.filter(e => e.id !== id)
            setEntries(updated)
            recalc(updated, session!.opening_balance)
            toast.success('Entry deleted')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to delete'
            toast.error(errMsg)
        }
    }

    // ── Close Day ────────────────────────────────────────────
    const handleCloseDay = async () => {
        const ok = await confirm({ title: "Close today's cash book?", message: `Closing Cash: ${fmt(totals.closing_balance)}`, confirmText: 'Close', isDestructive: false })
        if (!ok) return
        setIsClosingDay(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session!.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            // The API auto-opens the next calendar day right behind the close
            // (carrying this session's closing cash forward as its opening
            // balance) — reflect that new open session immediately instead of
            // showing "closed" until the next full page load.
            if (data.next_session) {
                setSession(data.next_session)
                setEntries([])
                setTotals({
                    total_cash_in: 0,
                    total_cash_out: 0,
                    closing_balance: Number(data.next_session.opening_balance),
                })
                toast.success(`Cash Book closed — new day opened with Rs. ${fmt(Number(data.next_session.opening_balance))} opening balance.`)
            } else {
                setSession(data.data)
                toast.success('Cash Book closed successfully!')
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to close day'
            toast.error(errMsg)
        } finally {
            setIsClosingDay(false)
        }
    }

    // ── Re-open Day ──────────────────────────────────────────
    const [isReopeningDay, setIsReopeningDay] = useState(false)
    const handleReopenDay = async () => {
        const ok = await confirm({ title: "Re-open today's cash book?", message: 'This will unlock transactions for editing.', confirmText: 'Reopen', isDestructive: false })
        if (!ok) return
        setIsReopeningDay(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session!.id, action: 'reopen' }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setSession(data.data)
            toast.success('Cash Book re-opened successfully!')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to re-open day book'
            toast.error(errMsg)
        } finally {
            setIsReopeningDay(false)
        }
    }

    const isClosed = session?.status === 'closed'
    const bsEnabled = useFeatureEnabled('bsDateEnabled')
    const dateLabel = (() => {
        const d = new Date(todayDate + 'T00:00:00')
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        const weekday = weekdays[d.getDay()]
        const month = months[d.getMonth()]
        const day = d.getDate()
        const year = d.getFullYear()
        const ad = `${weekday}, ${day} ${month} ${year}`
        if (!bsEnabled) return ad
        try {
            return `${ad} (${toNepaliDate(d, 'MMMM DD, YYYY', 'en')} BS)`
        } catch {
            return ad
        }
    })()

    return (
        <div className="space-y-6 pb-16 animate-fade-up">

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                            <Wallet size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Cash Book</h1>
                            <p className="text-sm text-ink-subtle flex items-center gap-1 mt-0.5">
                                <CalendarDays size={13} /> {dateLabel}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {entries.length > 0 && (
                        <>
                            <button
                                onClick={handleExportCsv}
                                className="flex items-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-muted text-ink font-semibold rounded-xl text-sm transition-all border border-hairline"
                            >
                                <Download size={15} /> Export
                            </button>
                            <button
                                onClick={() => printRef.current?.print()}
                                className="flex items-center gap-2 px-4 py-2.5 bg-surface hover:bg-surface-muted text-ink font-semibold rounded-xl text-sm transition-all border border-hairline"
                            >
                                <Printer size={15} /> Print
                            </button>
                        </>
                    )}
                    {session?.status === 'open' && canManage && (
                        <button
                            onClick={handleCloseDay}
                            disabled={isClosingDay}
                            className="flex items-center gap-2 px-4 py-2.5 bg-ink text-surface hover:opacity-90 font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                        >
                            {isClosingDay ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                            Close Cash Book
                        </button>
                    )}
                    {!session && canManage && !isOpeningDay && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/20"
                        >
                            <Wallet size={16} /> Open Cash Book
                        </button>
                    )}
                    {isClosed && (
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-2 px-4 py-2.5 bg-surface-muted text-ink-subtle font-bold rounded-xl text-sm border border-hairline">
                                <CheckCircle2 size={15} className="text-emerald-500" /> Cash Book Closed
                            </span>
                            {['manager', 'super_admin'].includes(userRole) && (
                                <button
                                    onClick={handleReopenDay}
                                    disabled={isReopeningDay}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-brand-500/10 hover:bg-brand-500/20 text-brand-500 font-extrabold rounded-xl text-xs border border-brand-500/20 transition-all"
                                >
                                    {isReopeningDay ? <Loader2 size={12} className="animate-spin" /> : 'Re-open'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Open Day Form ── */}
            {isOpeningDay && (
                <div className="bg-surface rounded-2xl border border-amber-200 p-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <h3 className="font-extrabold text-ink mb-1 flex items-center gap-2">
                        <Wallet size={18} className="text-amber-600" /> Open Cash Book
                    </h3>
                    <p className="text-sm text-ink-subtle mb-5">
                        Initialize today&apos;s cash ledger opening balance. Yesterday&apos;s closing cash balance is filled automatically if available.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mb-5">
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Opening Cash Balance (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={openingBalanceInput}
                                onChange={e => setOpeningBalanceInput(e.target.value)}
                                placeholder="0.00"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-lg p-3 border bg-surface text-ink font-bold transition-all"
                            />
                            {previousClosingBalance !== null && (
                                <span className="text-[11px] text-ink-subtle font-semibold mt-1 block">Prefilled: {fmt(previousClosingBalance)}</span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleOpenDay}
                            disabled={isSubmittingOpen}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmittingOpen ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            Open Cash Book
                        </button>
                        <button onClick={() => setIsOpeningDay(false)} className="px-4 py-3 text-ink-subtle hover:text-ink font-semibold rounded-xl hover:bg-surface-muted transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── No Session Placeholder ── */}
            {!session && !isOpeningDay && (
                <div className="bg-surface rounded-3xl border border-hairline p-16 text-center shadow-sm">
                    <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Wallet size={28} className="text-amber-500" />
                    </div>
                    <h3 className="font-extrabold text-ink text-xl mb-2">Cash Book Not Opened</h3>
                    <p className="text-ink-subtle text-sm max-w-sm mx-auto mb-6">
                        Open today&apos;s cash book ledger to start recording cash transactions.
                    </p>
                    {canManage && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all shadow-md"
                        >
                            Open Cash Book
                        </button>
                    )}
                </div>
            )}

            {/* ── Summary Cards & Tables ── */}
            {session && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
                        {/* Opening Balance */}
                        <div className="bg-surface rounded-2xl border border-hairline p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Opening cash balance</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Wallet size={15} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-ink">{fmt(session.opening_balance)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Starting cash in register</p>
                        </div>

                        {/* Total Cash In */}
                        <div className="bg-surface rounded-2xl border border-emerald-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Cash In</p>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <TrendingUp size={15} className="text-emerald-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">+{fmt(totals.total_cash_in)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Received today</p>
                        </div>

                        {/* Total Cash Out */}
                        <div className="bg-surface rounded-2xl border border-rose-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Cash Out</p>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={15} className="text-rose-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600">-{fmt(totals.total_cash_out)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Paid / Deposited today</p>
                        </div>

                        {/* Closing Balance */}
                        <div className="bg-surface rounded-2xl border border-hairline p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Closing Cash balance</p>
                                <div className="w-8 h-8 rounded-lg bg-surface-muted flex items-center justify-center">
                                    <Lock size={15} className="text-ink-subtle" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-ink">{fmt(totals.closing_balance)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Calculated current cash</p>
                        </div>
                    </div>

                    {/* Table and Log Control */}
                    <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-hairline flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-extrabold text-ink">Cash Ledger Entries</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">List of cash transactions for today</p>
                            </div>
                            {session.status === 'open' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => openEntryModal('cash_in')}
                                        className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-extrabold rounded-xl text-xs border border-emerald-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Cash In
                                    </button>
                                    <button
                                        onClick={() => openEntryModal('cash_out')}
                                        className="flex items-center gap-1 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold rounded-xl text-xs border border-rose-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Cash Out
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Fixed In/Out sections — click one to view only that side, full width */}
                        <div className="grid grid-cols-2 border-b border-hairline">
                            {(['cash_in', 'cash_out'] as const).map(sideType => {
                                const isIn = sideType === 'cash_in'
                                const count = entries.filter(e => e.type === sideType).length
                                const active = ledgerTab === sideType
                                return (
                                    <button
                                        key={sideType}
                                        onClick={() => setLedgerTab(sideType)}
                                        className={`px-6 py-3 text-xs font-black uppercase tracking-wider transition-colors ${
                                            active
                                                ? (isIn ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')
                                                : 'bg-surface text-ink-subtle hover:bg-surface-muted'
                                        }`}
                                    >
                                        {isIn ? 'Cash In' : 'Cash Out'} ({count})
                                    </button>
                                )
                            })}
                        </div>

                        {(() => {
                            const isIn = ledgerTab === 'cash_in'
                            const sideEntries = entries.filter(e => e.type === ledgerTab)
                            if (sideEntries.length === 0) {
                                return (
                                    <div className="p-16 text-center text-ink-subtle text-sm">
                                        <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                                        No {isIn ? 'cash in' : 'cash out'} entries logged today yet.
                                    </div>
                                )
                            }
                            return (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline">
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-24">Date &amp; Time</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-32">Category</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle">Description</th>
                                                <th className="px-6 py-3 font-bold text-ink-subtle text-right w-36">Amount</th>
                                                {session.status === 'open' && <th className="px-6 py-3 font-bold text-ink-subtle w-20 text-center">Actions</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {sideEntries.map(e => (
                                                <tr key={e.id} className="hover:bg-surface-muted transition-colors">
                                                    <td className="px-6 py-4 text-ink-subtle font-semibold">
                                                        <div>{timeStr(e.created_at)}</div>
                                                        <div className="text-[10px] text-ink-subtle font-bold">{entryDateStr(e.created_at)}</div>
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
                                                    <td className={`px-6 py-4 text-right font-extrabold text-sm ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {isIn ? '+' : '-'}{fmt(e.amount)}
                                                    </td>
                                                    {session.status === 'open' && (
                                                        <td className="px-6 py-4 text-center">
                                                            <button
                                                                onClick={() => handleDeleteEntry(e.id)}
                                                                className="p-1 text-ink-subtle hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        })()}
                    </div>
                </div>
            )}

            {/* ── Add Entry Modal ── */}
            {entryModal && (
                <Modal open onClose={() => setEntryModal(null)} size="md" ariaLabel={`Add cash ${entryModal.type === 'cash_in' ? 'in' : 'out'}`} className="overflow-hidden">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <h3 className="text-h3 text-ink flex items-center gap-2">
                                {entryModal.type === 'cash_in' ? <TrendingUp className="text-emerald-500" size={18} /> : <TrendingDown className="text-rose-500" size={18} />}
                                Add Cash {entryModal.type === 'cash_in' ? 'In' : 'Out'}
                            </h3>
                            <button onClick={() => setEntryModal(null)} className="text-ink-subtle hover:text-ink transition-colors focus-ring rounded-md">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Amount (Rs.)</label>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={entryForm.amount}
                                    onChange={e => setEntryForm(prev => ({ ...prev, amount: e.target.value }))}
                                    placeholder="0.00"
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-lg p-3 border bg-surface text-ink font-bold transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Category</label>
                                <Select
                                    value={entryForm.category}
                                    onChange={e => {
                                        const category = e.target.value as DayBookEntryCategory
                                        setIsOtherBank(false)
                                        setEntryForm(prev => ({ ...prev, category, bank_name: category === 'bank_deposit' ? prev.bank_name : '' }))
                                    }}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                >
                                    <option value="other">Other / General</option>
                                    <option value="refund">Refund</option>
                                    <option value="salary">Salary / Wage</option>
                                    <option value="advance">Advance</option>
                                    {/* Cash Out only: 'expense' writes an expenses row, which only
                                        makes sense for cash leaving the till, and 'bank_deposit'
                                        auto-pairs a matching bank_in. */}
                                    {entryModal.type === 'cash_out' && (
                                        <>
                                            <option value="expense">Expense</option>
                                            <option value="bank_deposit">Bank Deposit (Deposited Cash to Bank)</option>
                                        </>
                                    )}
                                </Select>
                            </div>

                            {entryForm.category === 'bank_deposit' && (
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Bank Name</label>
                                    {isOtherBank ? (
                                        <input
                                            type="text"
                                            autoFocus
                                            value={entryForm.bank_name}
                                            onChange={e => setEntryForm(prev => ({ ...prev, bank_name: e.target.value }))}
                                            placeholder="e.g. NIC Asia, Nabil Bank"
                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                        />
                                    ) : (
                                        <Select
                                            value={entryForm.bank_name}
                                            onChange={e => {
                                                if (e.target.value === OTHERS_BANK_VALUE) {
                                                    setIsOtherBank(true)
                                                    setEntryForm(prev => ({ ...prev, bank_name: '' }))
                                                } else {
                                                    setEntryForm(prev => ({ ...prev, bank_name: e.target.value }))
                                                }
                                            }}
                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                        >
                                            <option value="" disabled>Select bank...</option>
                                            {bankAccounts.map(ba => (
                                                <option key={ba.id} value={ba.name}>{ba.name}</option>
                                            ))}
                                            <option value={OTHERS_BANK_VALUE}>Others (type manually)</option>
                                        </Select>
                                    )}
                                    {isOtherBank && (
                                        <button
                                            type="button"
                                            onClick={() => { setIsOtherBank(false); setEntryForm(prev => ({ ...prev, bank_name: '' })) }}
                                            className="mt-1.5 text-xs font-bold text-brand-600 hover:text-brand-700"
                                        >
                                            ← Choose from list instead
                                        </button>
                                    )}
                                </div>
                            )}

                            {entryForm.category === 'expense' && (
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Expense Category</label>
                                    <Select
                                        value={entryForm.expense_category_id}
                                        onChange={e => setEntryForm(prev => ({ ...prev, expense_category_id: e.target.value }))}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        <option value="">Select category...</option>
                                        {expenseCategories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </Select>
                                    {expenseCategories.length === 0 && (
                                        <span className="text-[11px] text-ink-subtle font-semibold mt-1 block">
                                            No expense categories yet — add one from Income &amp; Expenses.
                                        </span>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Description</label>
                                <input
                                    type="text"
                                    value={entryForm.description}
                                    onChange={e => setEntryForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Enter details..."
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3">
                            <button onClick={() => setEntryModal(null)} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">
                                Cancel
                            </button>
                            <button
                                onClick={handleAddEntry}
                                disabled={isSubmittingEntry}
                                className={`px-6 py-2 rounded-[var(--r-md)] text-white font-bold text-sm flex items-center gap-1.5 transition-all ${
                                    entryModal.type === 'cash_in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                                } disabled:opacity-50`}
                            >
                                {isSubmittingEntry && <Loader2 size={14} className="animate-spin" />}
                                Add Entry
                            </button>
                        </div>
                </Modal>
            )}

            <PrintableReport
                ref={printRef}
                title="Cash Book"
                subtitle={dateLabel}
                columns={reportColumns}
                rows={reportRows}
            />
        </div>
    )
}
