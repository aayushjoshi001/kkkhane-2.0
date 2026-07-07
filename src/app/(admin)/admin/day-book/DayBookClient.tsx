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
    bank_deposit:     'Bank Deposit',
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
    bank_deposit:    'bg-cyan-50 text-cyan-700 border-cyan-100',
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
    const [entryForm, setEntryForm]   = useState({ amount: '', description: '', category: 'other' as DayBookEntryCategory, bank_name: '' })
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
        if (entryForm.category === 'bank_deposit' && !entryForm.bank_name.trim()) {
            toast.error('Bank name is required for bank deposits');
            return
        }
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
                    bank_name: entryForm.category === 'bank_deposit' ? entryForm.bank_name.trim() : null,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            const updated = [data.data, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_balance)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'other', bank_name: '' })
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

    // Group bank deposits to show a summarized list of totals per bank name
    const bankDeposits = entries
        .filter(e => e.category === 'bank_deposit' && e.bank_name)
        .reduce((acc, e) => {
            const name = e.bank_name!.trim()
            acc[name] = (acc[name] || 0) + e.amount
            return acc
        }, {} as Record<string, number>)

    const hasBankDeposits = Object.keys(bankDeposits).length > 0

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
                        <button
                            onClick={handleCloseDay}
                            disabled={isClosingDay}
                            className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                        >
                            {isClosingDay ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />}
                            Close Day
                        </button>
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

                    {/* ── Bank Deposits Summary ── */}
                    {hasBankDeposits && (
                        <div className="bg-white rounded-2xl border border-cyan-100 p-5 shadow-sm space-y-3">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                                <h3 className="font-extrabold text-gray-800 text-sm">Bank Deposits Summary</h3>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                {Object.entries(bankDeposits).map(([bankName, amount]) => (
                                    <div key={bankName} className="bg-cyan-50/30 border border-cyan-100/50 rounded-xl px-4 py-3 flex items-center justify-between">
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Bank Name</p>
                                            <p className="text-sm font-extrabold text-gray-800 truncate">{bankName}</p>
                                        </div>
                                        <span className="text-sm font-black text-cyan-700 tabular-nums shrink-0">{fmt(amount)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Split Screen: Cash In | Cash Out ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">

                        {/* ── LEFT: Cash In Panel ── */}
                        <div className="bg-white border-r border-gray-100">
                            {/* Panel Header */}
                            <div className="px-5 py-4 border-b border-emerald-100 bg-emerald-50/60 flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                                        <ArrowDownCircle size={16} className="text-emerald-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-extrabold text-emerald-800 text-sm">Cash In</h3>
                                        <p className="text-xs text-emerald-600 font-semibold">
                                            {entries.filter(e => e.type === 'cash_in').length} entries · +{fmt(totals.total_cash_in)}
                                        </p>
                                    </div>
                                </div>
                                {session?.status === 'open' && canManage && (
                                    <button
                                        onClick={() => { setEntryModal({ type: 'cash_in' }); setEntryForm({ amount: '', description: '', category: 'order_payment' }) }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-all"
                                    >
                                        <Plus size={13} /> Add
                                    </button>
                                )}
                            </div>

                            {/* Cash In Entries */}
                            {entries.filter(e => e.type === 'cash_in').length === 0 ? (
                                <div className="py-12 text-center">
                                    <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <ArrowDownCircle size={18} className="text-emerald-200" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-400">No cash in entries yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {entries.filter(e => e.type === 'cash_in').map(entry => (
                                        <div key={entry.id} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-emerald-50/30 transition-colors">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-gray-900 truncate">{entry.description}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[11px] text-gray-400 font-medium">
                                                        <Clock size={10} className="inline mr-0.5" />{timeStr(entry.created_at)}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CATEGORY_COLORS[entry.category]}`}>
                                                        {CATEGORY_LABELS[entry.category]}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-sm font-black text-emerald-600 tabular-nums">+{fmt(entry.amount)}</span>
                                                {!isClosed && canManage && (
                                                    <button
                                                        onClick={() => handleDeleteEntry(entry.id)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Cash In Footer Total */}
                            <div className="px-5 py-3 bg-emerald-50/40 border-t border-emerald-100 flex justify-between items-center">
                                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Total Cash In</span>
                                <span className="text-base font-black text-emerald-700">+{fmt(totals.total_cash_in)}</span>
                            </div>
                        </div>

                        {/* ── RIGHT: Cash Out Panel ── */}
                        <div className="bg-white">
                            {/* Panel Header */}
                            <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/60 flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center">
                                        <ArrowUpCircle size={16} className="text-rose-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-extrabold text-rose-800 text-sm">Cash Out</h3>
                                        <p className="text-xs text-rose-600 font-semibold">
                                            {entries.filter(e => e.type === 'cash_out').length} entries · −{fmt(totals.total_cash_out)}
                                        </p>
                                    </div>
                                </div>
                                {session?.status === 'open' && canManage && (
                                    <button
                                        onClick={() => { setEntryModal({ type: 'cash_out' }); setEntryForm({ amount: '', description: '', category: 'expense' }) }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs transition-all"
                                    >
                                        <Plus size={13} /> Add
                                    </button>
                                )}
                            </div>

                            {/* Cash Out Entries */}
                            {entries.filter(e => e.type === 'cash_out').length === 0 ? (
                                <div className="py-12 text-center">
                                    <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <ArrowUpCircle size={18} className="text-rose-200" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-400">No cash out entries yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {entries.filter(e => e.type === 'cash_out').map(entry => (
                                        <div key={entry.id} className="group flex items-center gap-3 px-5 py-3.5 hover:bg-rose-50/30 transition-colors">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-gray-900 truncate">{entry.description}</p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[11px] text-gray-400 font-medium">
                                                        <Clock size={10} className="inline mr-0.5" />{timeStr(entry.created_at)}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CATEGORY_COLORS[entry.category]}`}>
                                                        {CATEGORY_LABELS[entry.category]}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-sm font-black text-rose-600 tabular-nums">−{fmt(entry.amount)}</span>
                                                {!isClosed && canManage && (
                                                    <button
                                                        onClick={() => handleDeleteEntry(entry.id)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Cash Out Footer Total */}
                            <div className="px-5 py-3 bg-rose-50/40 border-t border-rose-100 flex justify-between items-center">
                                <span className="text-xs font-bold text-rose-700 uppercase tracking-wider">Total Cash Out</span>
                                <span className="text-base font-black text-rose-700">−{fmt(totals.total_cash_out)}</span>
                            </div>
                        </div>
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

                            {/* Bank Name (conditional) */}
                            {entryForm.category === 'bank_deposit' && (
                                <div className="animate-in fade-in slide-in-from-top-1 duration-150">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Bank Name *</label>
                                    <input
                                        type="text"
                                        value={entryForm.bank_name}
                                        onChange={e => setEntryForm(f => ({ ...f, bank_name: e.target.value }))}
                                        placeholder="e.g. NIC Asia Bank, Global IME Bank"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>
                            )}
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
