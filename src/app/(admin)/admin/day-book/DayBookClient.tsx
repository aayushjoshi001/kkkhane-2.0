'use client'

import { useState, useCallback } from 'react'
import {
    ArrowDownCircle, ArrowUpCircle, BookOpen, Plus, X, Loader2,
    TrendingUp, TrendingDown, Wallet, Lock, ChevronDown, Trash2,
    CalendarDays, Clock, CheckCircle2, AlertCircle, RefreshCw
} from 'lucide-react'
import type { DayBookSession, DayBookEntry, DayBookEntryType, DayBookEntryCategory } from '@/types/database'
import { toast } from 'react-hot-toast'

interface DayBookClientProps {
    initialSession: DayBookSession | null
    initialEntries: DayBookEntry[]
    initialTotals: { total_cash_in: number; total_cash_out: number; closing_balance: number }
    todayDate: string   // YYYY-MM-DD
    userRole: string
    previousClosingBalance: number | null
}

const CATEGORY_LABELS: Record<DayBookEntryCategory, string> = {
    order_payment:    'Order Payment',
    room_deposit:     'Room Deposit',
    booking_payment:  'Booking Payment',
    expense:          'Expense',
    refund:           'Refund',
    salary:           'Salary / Wage',
    advance:          'Advance',
    other:            'Other',
}

const CATEGORY_COLORS: Record<DayBookEntryCategory, string> = {
    order_payment:   'bg-emerald-50 text-emerald-700',
    room_deposit:    'bg-blue-50 text-blue-700',
    booking_payment: 'bg-indigo-50 text-indigo-700',
    expense:         'bg-red-50 text-red-700',
    refund:          'bg-orange-50 text-orange-700',
    salary:          'bg-purple-50 text-purple-700',
    advance:         'bg-yellow-50 text-yellow-700',
    other:           'bg-gray-100 text-gray-600',
}

function fmt(amount: number) {
    return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function DayBookClient({
    initialSession,
    initialEntries,
    initialTotals,
    todayDate,
    userRole,
    previousClosingBalance,
}: DayBookClientProps) {
    const [session, setSession]   = useState<DayBookSession | null>(initialSession)
    const [entries, setEntries]   = useState<DayBookEntry[]>(initialEntries)
    const [totals, setTotals]     = useState(initialTotals)

    // Open Day state
    const [isOpeningDay, setIsOpeningDay]       = useState(false)
    const [openingBalanceInput, setOpeningBalanceInput] = useState(
        previousClosingBalance !== null ? String(previousClosingBalance) : ''
    )
    const [isSubmittingOpen, setIsSubmittingOpen] = useState(false)

    // Add Entry modal
    const [entryModal, setEntryModal] = useState<{ type: DayBookEntryType } | null>(null)
    const [entryForm, setEntryForm]   = useState({ amount: '', description: '', category: 'other' as DayBookEntryCategory })
    const [isSubmittingEntry, setIsSubmittingEntry] = useState(false)

    // Close Day
    const [isClosingDay, setIsClosingDay] = useState(false)

    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)

    // ── Refresh totals from entries ──────────────────────────
    const recalc = useCallback((updatedEntries: DayBookEntry[], openingBal: number) => {
        const cashIn  = updatedEntries.filter(e => e.type === 'cash_in').reduce((s, e) => s + e.amount, 0)
        const cashOut = updatedEntries.filter(e => e.type === 'cash_out').reduce((s, e) => s + e.amount, 0)
        setTotals({ total_cash_in: cashIn, total_cash_out: cashOut, closing_balance: openingBal + cashIn - cashOut })
    }, [])

    // ── Open Day ─────────────────────────────────────────────
    const handleOpenDay = async () => {
        const bal = parseFloat(openingBalanceInput)
        if (isNaN(bal) || bal < 0) { toast.error('Enter a valid opening balance'); return }
        setIsSubmittingOpen(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opening_balance: bal }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setSession(data.data)
            setEntries([])
            setTotals({ total_cash_in: 0, total_cash_out: 0, closing_balance: bal })
            setIsOpeningDay(false)
            toast.success('Day opened successfully!')
        } catch (e: any) {
            toast.error(e.message || 'Failed to open day')
        } finally {
            setIsSubmittingOpen(false)
        }
    }

    // ── Add Entry ────────────────────────────────────────────
    const handleAddEntry = async () => {
        const amount = parseFloat(entryForm.amount)
        if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
        if (!entryForm.description.trim()) { toast.error('Description is required'); return }
        if (!entryModal || !session) return

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
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            const updated = [data.data, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_balance)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'other' })
            toast.success(`${entryModal.type === 'cash_in' ? 'Cash In' : 'Cash Out'} recorded!`)
        } catch (e: any) {
            toast.error(e.message || 'Failed to add entry')
        } finally {
            setIsSubmittingEntry(false)
        }
    }

    // ── Delete Entry ─────────────────────────────────────────
    const handleDeleteEntry = async (id: string) => {
        if (!confirm('Delete this entry?')) return
        try {
            const res = await fetch(`/api/day-book/entries?id=${id}`, { method: 'DELETE' })
            if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
            const updated = entries.filter(e => e.id !== id)
            setEntries(updated)
            recalc(updated, session!.opening_balance)
            toast.success('Entry deleted')
        } catch (e: any) {
            toast.error(e.message || 'Failed to delete')
        }
    }

    // ── Close Day ────────────────────────────────────────────
    const handleCloseDay = async () => {
        if (!confirm(`Close today's day book? Closing balance will be ${fmt(totals.closing_balance)}.`)) return
        setIsClosingDay(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session!.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setSession(data.data)
            toast.success('Day closed! Closing balance will carry over tomorrow.')
        } catch (e: any) {
            toast.error(e.message || 'Failed to close day')
        } finally {
            setIsClosingDay(false)
        }
    }

    const isClosed = session?.status === 'closed'
    const dateLabel = new Date(todayDate + 'T00:00:00').toLocaleDateString('en-IN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })

    return (
        <div className="space-y-6 pb-16 animate-fade-up">

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                            <BookOpen size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Day Book</h1>
                            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                                <CalendarDays size={13} /> {dateLabel}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {session?.status === 'open' && canManage && (
                        <>
                            <button
                                onClick={() => { setEntryModal({ type: 'cash_in' }); setEntryForm({ amount: '', description: '', category: 'order_payment' }) }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-emerald-600/15"
                            >
                                <ArrowDownCircle size={16} /> Cash In
                            </button>
                            <button
                                onClick={() => { setEntryModal({ type: 'cash_out' }); setEntryForm({ amount: '', description: '', category: 'expense' }) }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-rose-600/15"
                            >
                                <ArrowUpCircle size={16} /> Cash Out
                            </button>
                            <button
                                onClick={handleCloseDay}
                                disabled={isClosingDay}
                                className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                            >
                                {isClosingDay ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                                Close Day
                            </button>
                        </>
                    )}
                    {!session && canManage && !isOpeningDay && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/20"
                        >
                            <BookOpen size={16} /> Open Day Book
                        </button>
                    )}
                    {isClosed && (
                        <span className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-600 font-semibold rounded-xl text-sm">
                            <CheckCircle2 size={15} className="text-emerald-500" /> Day Closed
                        </span>
                    )}
                </div>
            </div>

            {/* ── Open Day Form ── */}
            {isOpeningDay && (
                <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <h3 className="font-extrabold text-gray-900 mb-1 flex items-center gap-2">
                        <BookOpen size={18} className="text-amber-600" /> Open Day Book
                    </h3>
                    <p className="text-sm text-gray-500 mb-5">
                        {previousClosingBalance !== null
                            ? `Yesterday's closing balance (${fmt(previousClosingBalance)}) has been pre-filled as today's opening balance.`
                            : "First time using Day Book — enter your current cash in hand as the opening balance."}
                    </p>
                    <div className="flex items-end gap-4">
                        <div className="flex-1 max-w-xs">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Opening Balance (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={openingBalanceInput}
                                onChange={e => setOpeningBalanceInput(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                            />
                        </div>
                        <button
                            onClick={handleOpenDay}
                            disabled={isSubmittingOpen}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmittingOpen ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            Open Day
                        </button>
                        <button onClick={() => setIsOpeningDay(false)} className="px-4 py-3 text-gray-500 hover:text-gray-700 font-semibold rounded-xl hover:bg-gray-100 transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── No Session Placeholder ── */}
            {!session && !isOpeningDay && (
                <div className="bg-white rounded-3xl border border-gray-100 p-16 text-center shadow-sm">
                    <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <BookOpen size={28} className="text-amber-500" />
                    </div>
                    <h3 className="font-extrabold text-gray-900 text-xl mb-2">Day Book Not Opened</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
                        Open today's day book to start tracking cash in and cash out transactions.
                    </p>
                    {canManage && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-all shadow-md"
                        >
                            Open Day Book
                        </button>
                    )}
                    {!canManage && (
                        <p className="text-xs text-gray-400 font-semibold">Only managers and cashiers can open the day book.</p>
                    )}
                </div>
            )}

            {/* ── Summary Cards ── */}
            {session && (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Opening Balance */}
                        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Opening Balance</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Wallet size={15} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-gray-900">{fmt(session.opening_balance)}</p>
                            <p className="text-xs text-gray-400 mt-1">Start of day cash</p>
                        </div>

                        {/* Cash In */}
                        <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Cash In</p>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <TrendingUp size={15} className="text-emerald-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">+{fmt(totals.total_cash_in)}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                {entries.filter(e => e.type === 'cash_in').length} entries
                            </p>
                        </div>

                        {/* Cash Out */}
                        <div className="bg-white rounded-2xl border border-rose-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Cash Out</p>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={15} className="text-rose-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600">−{fmt(totals.total_cash_out)}</p>
                            <p className="text-xs text-gray-400 mt-1">
                                {entries.filter(e => e.type === 'cash_out').length} entries
                            </p>
                        </div>

                        {/* Closing Balance */}
                        <div className={`rounded-2xl border p-5 shadow-sm ${isClosed ? 'bg-gray-900 border-gray-700' : 'bg-white border-amber-100'}`}>
                            <div className="flex items-center justify-between mb-3">
                                <p className={`text-xs font-bold uppercase tracking-wider ${isClosed ? 'text-white/50' : 'text-gray-400'}`}>
                                    {isClosed ? 'Closed Balance' : 'Current Balance'}
                                </p>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isClosed ? 'bg-white/10' : 'bg-amber-50'}`}>
                                    {isClosed
                                        ? <Lock size={15} className="text-white/70" />
                                        : <Wallet size={15} className="text-amber-600" />}
                                </div>
                            </div>
                            <p className={`text-2xl font-black ${isClosed ? 'text-white' : totals.closing_balance >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>
                                {fmt(totals.closing_balance)}
                            </p>
                            <p className={`text-xs mt-1 ${isClosed ? 'text-white/40' : 'text-gray-400'}`}>
                                {isClosed ? `Closed at ${timeStr(session.closed_at!)}` : 'Auto-calculated'}
                            </p>
                        </div>
                    </div>

                    {/* ── Closed Notice ── */}
                    {isClosed && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                            <p className="text-sm font-semibold text-emerald-800">
                                Day closed at {timeStr(session.closed_at!)}. Tomorrow's opening balance will automatically be set to <strong>{fmt(totals.closing_balance)}</strong>.
                            </p>
                        </div>
                    )}

                    {/* ── Entries Table ── */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h2 className="font-extrabold text-gray-900">Transactions</h2>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{entries.length} entries</span>
                        </div>

                        {entries.length === 0 ? (
                            <div className="py-16 text-center">
                                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <BookOpen size={20} className="text-gray-300" />
                                </div>
                                <p className="text-sm font-semibold text-gray-400">No transactions yet</p>
                                <p className="text-xs text-gray-300 mt-1">Use Cash In / Cash Out buttons to record transactions</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[600px]">
                                    <thead>
                                        <tr className="text-[11px] uppercase tracking-wider font-bold text-gray-400 bg-gray-50/50">
                                            <th className="px-6 py-3 text-left border-b border-gray-100">Time</th>
                                            <th className="px-6 py-3 text-left border-b border-gray-100">Type</th>
                                            <th className="px-6 py-3 text-left border-b border-gray-100">Description</th>
                                            <th className="px-6 py-3 text-left border-b border-gray-100">Category</th>
                                            <th className="px-6 py-3 text-right border-b border-gray-100">Amount</th>
                                            {!isClosed && canManage && <th className="px-4 py-3 border-b border-gray-100" />}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {entries.map(entry => (
                                            <tr key={entry.id} className="group hover:bg-gray-50/50 transition-colors">
                                                <td className="px-6 py-4 text-xs text-gray-400 font-medium whitespace-nowrap">
                                                    <Clock size={12} className="inline mr-1" />
                                                    {timeStr(entry.created_at)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {entry.type === 'cash_in' ? (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                            <ArrowDownCircle size={11} /> Cash In
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-100">
                                                            <ArrowUpCircle size={11} /> Cash Out
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-sm font-semibold text-gray-800 max-w-[200px] truncate">
                                                    {entry.description}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${CATEGORY_COLORS[entry.category]}`}>
                                                        {CATEGORY_LABELS[entry.category]}
                                                    </span>
                                                </td>
                                                <td className={`px-6 py-4 text-right font-black tabular-nums ${entry.type === 'cash_in' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {entry.type === 'cash_in' ? '+' : '−'}{fmt(entry.amount)}
                                                </td>
                                                {!isClosed && canManage && (
                                                    <td className="px-4 py-4">
                                                        <button
                                                            onClick={() => handleDeleteEntry(entry.id)}
                                                            className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Add Entry Modal ── */}
            {entryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        {/* Modal Header */}
                        <div className={`px-6 py-5 flex items-center justify-between ${entryModal.type === 'cash_in' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                            <div className="flex items-center gap-3">
                                {entryModal.type === 'cash_in'
                                    ? <ArrowDownCircle size={22} className="text-white" />
                                    : <ArrowUpCircle size={22} className="text-white" />}
                                <h3 className="text-white font-extrabold text-lg">
                                    {entryModal.type === 'cash_in' ? 'Record Cash In' : 'Record Cash Out'}
                                </h3>
                            </div>
                            <button
                                onClick={() => setEntryModal(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-5">
                            {/* Amount */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Amount (Rs.) *</label>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    autoFocus
                                    value={entryForm.amount}
                                    onChange={e => setEntryForm(f => ({ ...f, amount: e.target.value }))}
                                    placeholder="0.00"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xl font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description *</label>
                                <input
                                    type="text"
                                    value={entryForm.description}
                                    onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))}
                                    placeholder={entryModal.type === 'cash_in' ? 'e.g. Table 5 cash payment' : 'e.g. Milk and vegetables'}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            {/* Category */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category</label>
                                <div className="relative">
                                    <select
                                        value={entryForm.category}
                                        onChange={e => setEntryForm(f => ({ ...f, category: e.target.value as DayBookEntryCategory }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] appearance-none cursor-pointer"
                                    >
                                        {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                                            <option key={val} value={val}>{label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setEntryModal(null)}
                                className="px-4 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddEntry}
                                disabled={isSubmittingEntry}
                                className={`px-6 py-2.5 text-sm font-bold text-white rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center gap-2 ${entryModal.type === 'cash_in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                            >
                                {isSubmittingEntry ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                Add {entryModal.type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
