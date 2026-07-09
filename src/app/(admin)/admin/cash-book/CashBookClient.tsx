'use client'

import { useState, useCallback } from 'react'
import {
    TrendingUp, TrendingDown, BookOpen, Plus, X, Loader2,
    Wallet, Lock, Trash2, CalendarDays, CheckCircle2, AlertCircle
} from 'lucide-react'
import type { DayBookSession, DayBookEntry, DayBookEntryType, DayBookEntryCategory } from '@/types/database'
import { toast } from 'react-hot-toast'

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
}

const CATEGORY_LABELS: Record<string, string> = {
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

const CATEGORY_COLORS: Record<string, string> = {
    order_payment:   'bg-emerald-50 text-emerald-700 border-emerald-100',
    room_deposit:    'bg-blue-50 text-blue-700 border-blue-100',
    booking_payment: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    expense:         'bg-red-50 text-red-700 border-red-100',
    refund:          'bg-orange-50 text-orange-700 border-orange-100',
    salary:          'bg-purple-50 text-purple-700 border-purple-100',
    advance:         'bg-yellow-50 text-yellow-700 border-yellow-100',
    bank_deposit:    'bg-cyan-50 text-cyan-700 border-cyan-100',
    other:           'bg-gray-100 text-gray-600 border-gray-200',
}

function fmt(amount: number) {
    return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function CashBookClient({
    initialSession,
    initialEntries,
    initialTotals,
    todayDate,
    userRole,
    previousClosingBalance,
    previousClosingBankBalance,
}: CashBookClientProps) {
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
    const [entryModal, setEntryModal] = useState<{ type: 'cash_in' | 'cash_out' } | null>(null)
    const [entryForm, setEntryForm]   = useState({ amount: '', description: '', category: 'other' as DayBookEntryCategory, bank_name: '' })
    const [isSubmittingEntry, setIsSubmittingEntry] = useState(false)

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
                // Retain previous closing bank balance so bank ledger isn't wiped out
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
        } catch (e: any) {
            toast.error(e.message || 'Failed to open Cash Book')
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
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            let newEntries = [data.data]

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
                    const autoData = await autoRes.json()
                    if (autoRes.ok) {
                        toast.success('Cash Out logged and deposited to Bank successfully!')
                    }
                } catch (autoErr) {
                    console.error('Failed to auto-create bank entry', autoErr)
                }
            } else {
                toast.success('Cash transaction logged successfully!')
            }

            const updated = [...newEntries, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_balance)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'other', bank_name: '' })
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
        if (!confirm(`Close today's cash book?\n\nClosing Cash: ${fmt(totals.closing_balance)}`)) return
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
            toast.success('Cash Book closed successfully!')
        } catch (e: any) {
            toast.error(e.message || 'Failed to close day')
        } finally {
            setIsClosingDay(false)
        }
    }

    // ── Re-open Day ──────────────────────────────────────────
    const [isReopeningDay, setIsReopeningDay] = useState(false)
    const handleReopenDay = async () => {
        if (!confirm("Are you sure you want to re-open today's cash book? This will unlock transactions editing.")) return
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
        } catch (e: any) {
            toast.error(e.message || 'Failed to re-open day book')
        } finally {
            setIsReopeningDay(false)
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
                            <Wallet size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Cash Book</h1>
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
                            Close Cash Book
                        </button>
                    )}
                    {!session && canManage && !isOpeningDay && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/20"
                        >
                            <Wallet size={16} /> Open Cash Book
                        </button>
                    )}
                    {isClosed && (
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-2 px-4 py-2.5 bg-gray-150 text-gray-600 font-bold rounded-xl text-sm border border-gray-200">
                                <CheckCircle2 size={15} className="text-emerald-500" /> Cash Book Closed
                            </span>
                            {['manager', 'super_admin'].includes(userRole) && (
                                <button
                                    onClick={handleReopenDay}
                                    disabled={isReopeningDay}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-[#ff5a00]/10 hover:bg-[#ff5a00]/20 text-[#ff5a00] font-extrabold rounded-xl text-xs border border-[#ff5a00]/20 transition-all"
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
                <div className="bg-white rounded-2xl border border-amber-200 p-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <h3 className="font-extrabold text-gray-900 mb-1 flex items-center gap-2">
                        <Wallet size={18} className="text-amber-600" /> Open Cash Book
                    </h3>
                    <p className="text-sm text-gray-500 mb-5">
                        Initialize today's cash ledger opening balance. Yesterday's closing cash balance is filled automatically if available.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mb-5">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Opening Cash Balance (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={openingBalanceInput}
                                onChange={e => setOpeningBalanceInput(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                            />
                            {previousClosingBalance !== null && (
                                <span className="text-[11px] text-gray-400 font-semibold mt-1 block">Prefilled: {fmt(previousClosingBalance)}</span>
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
                        <Wallet size={28} className="text-amber-500" />
                    </div>
                    <h3 className="font-extrabold text-gray-900 text-xl mb-2">Cash Book Not Opened</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
                        Open today's cash book ledger to start recording cash transactions.
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
                        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Opening cash balance</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Wallet size={15} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-gray-900">{fmt(session.opening_balance)}</p>
                            <p className="text-xs text-gray-400 mt-1">Starting cash in register</p>
                        </div>

                        {/* Total Cash In */}
                        <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Cash In</p>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <TrendingUp size={15} className="text-emerald-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">+{fmt(totals.total_cash_in)}</p>
                            <p className="text-xs text-gray-400 mt-1">Received today</p>
                        </div>

                        {/* Total Cash Out */}
                        <div className="bg-white rounded-2xl border border-rose-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Cash Out</p>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={15} className="text-rose-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600">-{fmt(totals.total_cash_out)}</p>
                            <p className="text-xs text-gray-400 mt-1">Paid / Deposited today</p>
                        </div>

                        {/* Closing Balance */}
                        <div className="bg-white rounded-2xl border border-gray-150 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Closing Cash balance</p>
                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                                    <Lock size={15} className="text-gray-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-gray-900">{fmt(totals.closing_balance)}</p>
                            <p className="text-xs text-gray-400 mt-1">Calculated current cash</p>
                        </div>
                    </div>

                    {/* Table and Log Control */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-extrabold text-gray-900">Cash Ledger Entries</h3>
                                <p className="text-xs text-gray-400 mt-0.5">List of cash transactions for today</p>
                            </div>
                            {session.status === 'open' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEntryModal({ type: 'cash_in' })}
                                        className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-extrabold rounded-xl text-xs border border-emerald-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Cash In
                                    </button>
                                    <button
                                        onClick={() => setEntryModal({ type: 'cash_out' })}
                                        className="flex items-center gap-1 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold rounded-xl text-xs border border-rose-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Cash Out
                                    </button>
                                </div>
                            )}
                        </div>

                        {entries.length === 0 ? (
                            <div className="p-16 text-center text-gray-400 text-sm">
                                <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                                No cash transactions logged today yet.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-150">
                                            <th className="px-6 py-3 font-bold text-gray-500 w-24">Time</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 w-24">Type</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 w-32">Category</th>
                                            <th className="px-6 py-3 font-bold text-gray-500">Description</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 text-right w-36">Amount</th>
                                            {session.status === 'open' && <th className="px-6 py-3 font-bold text-gray-500 w-20 text-center">Actions</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {entries.map(e => (
                                            <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4 text-gray-500 font-semibold">{timeStr(e.created_at)}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                                                        e.type === 'cash_in' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                                    }`}>
                                                        {e.type === 'cash_in' ? 'IN' : 'OUT'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${
                                                        CATEGORY_COLORS[e.category] || 'bg-gray-50 text-gray-600 border-gray-150'
                                                    }`}>
                                                        {CATEGORY_LABELS[e.category] || e.category}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">
                                                    {e.description}
                                                    {e.bank_name && (
                                                        <span className="block text-[10px] text-gray-400 font-bold mt-0.5">Bank: {e.bank_name}</span>
                                                    )}
                                                </td>
                                                <td className={`px-6 py-4 text-right font-extrabold text-sm ${
                                                    e.type === 'cash_in' ? 'text-emerald-600' : 'text-rose-600'
                                                }`}>
                                                    {e.type === 'cash_in' ? '+' : '-'}{fmt(e.amount)}
                                                </td>
                                                {session.status === 'open' && (
                                                    <td className="px-6 py-4 text-center">
                                                        <button
                                                            onClick={() => handleDeleteEntry(e.id)}
                                                            className="p-1 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
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
                        )}
                    </div>
                </div>
            )}

            {/* ── Add Entry Modal ── */}
            {entryModal && (
                <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full border border-gray-150 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                {entryModal.type === 'cash_in' ? <TrendingUp className="text-emerald-500" size={18} /> : <TrendingDown className="text-rose-500" size={18} />}
                                Add Cash {entryModal.type === 'cash_in' ? 'In' : 'Out'}
                            </h3>
                            <button onClick={() => setEntryModal(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Amount (Rs.)</label>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={entryForm.amount}
                                    onChange={e => setEntryForm(prev => ({ ...prev, amount: e.target.value }))}
                                    placeholder="0.00"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category</label>
                                <select
                                    value={entryForm.category}
                                    onChange={e => setEntryForm(prev => ({ ...prev, category: e.target.value as DayBookEntryCategory }))}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                                >
                                    <option value="other">Other / General</option>
                                    <option value="expense">Expense</option>
                                    <option value="refund">Refund</option>
                                    <option value="salary">Salary / Wage</option>
                                    <option value="advance">Advance</option>
                                    {entryModal.type === 'cash_out' && (
                                        <option value="bank_deposit">Bank Deposit (Deposited Cash to Bank)</option>
                                    )}
                                </select>
                            </div>

                            {entryForm.category === 'bank_deposit' && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Bank Name</label>
                                    <input
                                        type="text"
                                        value={entryForm.bank_name}
                                        onChange={e => setEntryForm(prev => ({ ...prev, bank_name: e.target.value }))}
                                        placeholder="e.g. NIC Asia, Nabil Bank"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description</label>
                                <input
                                    type="text"
                                    value={entryForm.description}
                                    onChange={e => setEntryForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Enter details..."
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                            <button onClick={() => setEntryModal(null)} className="px-4 py-2 text-gray-500 hover:text-gray-700 font-bold text-sm">
                                Cancel
                            </button>
                            <button
                                onClick={handleAddEntry}
                                disabled={isSubmittingEntry}
                                className={`px-6 py-2 rounded-xl text-white font-extrabold text-sm flex items-center gap-1.5 transition-colors ${
                                    entryModal.type === 'cash_in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                                } disabled:opacity-50`}
                            >
                                {isSubmittingEntry && <Loader2 size={14} className="animate-spin" />}
                                Add Entry
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
