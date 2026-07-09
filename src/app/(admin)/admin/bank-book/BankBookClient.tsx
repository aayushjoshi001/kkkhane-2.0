'use client'

import { useState, useCallback } from 'react'
import {
    TrendingUp, TrendingDown, Plus, X, Loader2,
    Lock, Trash2, CalendarDays, CheckCircle2, AlertCircle, Landmark
} from 'lucide-react'
import type { DayBookSession, DayBookEntry, DayBookEntryCategory } from '@/types/database'
import { toast } from 'react-hot-toast'

interface BankBookClientProps {
    initialSession: DayBookSession | null
    initialEntries: DayBookEntry[]
    initialTotals: {
        total_bank_in: number
        total_bank_out: number
        closing_bank_balance: number
    }
    todayDate: string   // YYYY-MM-DD
    userRole: string
    previousClosingBankBalance: number | null
    previousClosingCashBalance: number
}

const CATEGORY_LABELS: Record<string, string> = {
    qr_payment:       'QR Payment',
    card:             'Card Payment',
    transfer:         'Bank Transfer',
    deposit:          'Bank Deposit',
    withdrawal:       'Cash Withdrawal',
    bank_charges:     'Bank Charges',
    transfer_out:     'Transfer Out',
    other:            'Other',
}

const CATEGORY_COLORS: Record<string, string> = {
    qr_payment:      'bg-teal-50 text-teal-700 border-teal-100',
    card:            'bg-sky-50 text-sky-700 border-sky-100',
    transfer:        'bg-indigo-50 text-indigo-700 border-indigo-100',
    deposit:         'bg-emerald-50 text-emerald-700 border-emerald-100',
    withdrawal:      'bg-amber-50 text-amber-700 border-amber-100',
    bank_charges:    'bg-rose-50 text-rose-700 border-rose-100',
    transfer_out:    'bg-violet-50 text-violet-700 border-violet-100',
    other:           'bg-gray-100 text-gray-600 border-gray-200',
}

function fmt(amount: number) {
    return 'Rs. ' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function BankBookClient({
    initialSession,
    initialEntries,
    initialTotals,
    todayDate,
    userRole,
    previousClosingBankBalance,
    previousClosingCashBalance,
}: BankBookClientProps) {
    const [session, setSession]   = useState<DayBookSession | null>(initialSession)
    const [entries, setEntries]   = useState<DayBookEntry[]>(initialEntries)
    const [totals, setTotals]     = useState(initialTotals)

    // Open Day state
    const [isOpeningDay, setIsOpeningDay]       = useState(false)
    const [openingBankBalanceInput, setOpeningBankBalanceInput] = useState(
        previousClosingBankBalance !== null ? String(previousClosingBankBalance) : ''
    )
    const [isSubmittingOpen, setIsSubmittingOpen] = useState(false)

    // Add Entry modal
    const [entryModal, setEntryModal] = useState<{ type: 'bank_in' | 'bank_out' } | null>(null)
    const [entryForm, setEntryForm]   = useState({ amount: '', description: '', category: 'transfer' as DayBookEntryCategory, bank_name: '' })
    const [isSubmittingEntry, setIsSubmittingEntry] = useState(false)

    // Close Day
    const [isClosingDay, setIsClosingDay] = useState(false)

    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)

    // ── Refresh totals from entries ──────────────────────────
    const recalc = useCallback((updatedEntries: DayBookEntry[], openingBankBal: number) => {
        const bankIn  = updatedEntries.filter(e => e.type === 'bank_in').reduce((s, e) => s + e.amount, 0)
        const bankOut = updatedEntries.filter(e => e.type === 'bank_out').reduce((s, e) => s + e.amount, 0)

        setTotals({
            total_bank_in: bankIn,
            total_bank_out: bankOut,
            closing_bank_balance: openingBankBal + bankIn - bankOut,
        })
    }, [])

    // ── Open Day ─────────────────────────────────────────────
    const handleOpenDay = async () => {
        const bankBal = parseFloat(openingBankBalanceInput)
        if (isNaN(bankBal) || bankBal < 0) { toast.error('Enter a valid opening bank balance'); return }
        setIsSubmittingOpen(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ opening_balance: previousClosingCashBalance, opening_bank_balance: bankBal, date: todayDate }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setSession(data.data)
            setEntries([])
            setTotals({
                total_bank_in: 0,
                total_bank_out: 0,
                closing_bank_balance: bankBal,
            })
            setIsOpeningDay(false)
            toast.success('Bank Book opened successfully!')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to open Bank Book'
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
        if (!entryForm.bank_name.trim()) {
            toast.error('Bank name is required');
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
                    bank_name: entryForm.bank_name.trim(),
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            toast.success('Bank transaction logged successfully!')

            const updated = [data.data, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_bank_balance ?? 0)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'transfer', bank_name: '' })
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to add entry'
            toast.error(errMsg)
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
            recalc(updated, session!.opening_bank_balance ?? 0)
            toast.success('Entry deleted')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to delete'
            toast.error(errMsg)
        }
    }

    // ── Close Day ────────────────────────────────────────────
    const handleCloseDay = async () => {
        if (!confirm(`Close today's bank book?\n\nClosing Bank: ${fmt(totals.closing_bank_balance)}`)) return
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
            toast.success('Bank Book closed successfully!')
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
        if (!confirm("Are you sure you want to re-open today's bank book? This will unlock transactions editing.")) return
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
            toast.success('Bank Book re-opened successfully!')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to re-open day book'
            toast.error(errMsg)
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
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <Landmark size={20} className="text-indigo-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Bank Book</h1>
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
                            Close Bank Book
                        </button>
                    )}
                    {!session && canManage && !isOpeningDay && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-indigo-600/20"
                        >
                            <Landmark size={16} /> Open Bank Book
                        </button>
                    )}
                    {isClosed && (
                        <div className="flex items-center gap-2">
                            <span className="flex items-center gap-2 px-4 py-2.5 bg-gray-150 text-gray-600 font-bold rounded-xl text-sm border border-gray-200">
                                <CheckCircle2 size={15} className="text-emerald-500" /> Bank Book Closed
                            </span>
                            {['manager', 'super_admin'].includes(userRole) && (
                                <button
                                    onClick={handleReopenDay}
                                    disabled={isReopeningDay}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-600 font-extrabold rounded-xl text-xs border border-indigo-600/20 transition-all"
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
                <div className="bg-white rounded-2xl border border-indigo-200 p-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <h3 className="font-extrabold text-gray-900 mb-1 flex items-center gap-2">
                        <Landmark size={18} className="text-indigo-600" /> Open Bank Book
                    </h3>
                    <p className="text-sm text-gray-500 mb-5">
                        Initialize today&apos;s bank ledger opening balance. Yesterday&apos;s closing bank balance is pre-filled if available.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mb-5">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Opening Bank Balance (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={openingBankBalanceInput}
                                onChange={e => setOpeningBankBalanceInput(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                            />
                            {previousClosingBankBalance !== null && (
                                <span className="text-[11px] text-gray-400 font-semibold mt-1 block">Prefilled: {fmt(previousClosingBankBalance)}</span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleOpenDay}
                            disabled={isSubmittingOpen}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSubmittingOpen ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                            Open Bank Book
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
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Landmark size={28} className="text-indigo-500" />
                    </div>
                    <h3 className="font-extrabold text-gray-900 text-xl mb-2">Bank Book Not Opened</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
                        Open today&apos;s bank book ledger to start tracking bank transactions.
                    </p>
                    {canManage && (
                        <button
                            onClick={() => setIsOpeningDay(true)}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md"
                        >
                            Open Bank Book
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
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Opening bank balance</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Landmark size={15} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-gray-900">{fmt(session.opening_bank_balance ?? 0)}</p>
                            <p className="text-xs text-gray-400 mt-1">Starting bank ledger balance</p>
                        </div>

                        {/* Total Bank In */}
                        <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Bank In</p>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <TrendingUp size={15} className="text-emerald-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">+{fmt(totals.total_bank_in)}</p>
                            <p className="text-xs text-gray-400 mt-1">Received today</p>
                        </div>

                        {/* Total Bank Out */}
                        <div className="bg-white rounded-2xl border border-rose-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Bank Out</p>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={15} className="text-rose-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600">-{fmt(totals.total_bank_out)}</p>
                            <p className="text-xs text-gray-400 mt-1">Paid / Transferred today</p>
                        </div>

                        {/* Closing Balance */}
                        <div className="bg-white rounded-2xl border border-gray-150 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Closing Bank balance</p>
                                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                                    <Lock size={15} className="text-gray-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-gray-900">{fmt(totals.closing_bank_balance)}</p>
                            <p className="text-xs text-gray-400 mt-1">Calculated current bank balance</p>
                        </div>
                    </div>

                    {/* Table and Log Control */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-extrabold text-gray-900">Bank Ledger Entries</h3>
                                <p className="text-xs text-gray-400 mt-0.5">List of bank transactions for today</p>
                            </div>
                            {session.status === 'open' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setEntryModal({ type: 'bank_in' })}
                                        className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-extrabold rounded-xl text-xs border border-emerald-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Bank In (Receive)
                                    </button>
                                    <button
                                        onClick={() => setEntryModal({ type: 'bank_out' })}
                                        className="flex items-center gap-1 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold rounded-xl text-xs border border-rose-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Bank Out (Payment)
                                    </button>
                                </div>
                            )}
                        </div>

                        {entries.length === 0 ? (
                            <div className="p-16 text-center text-gray-400 text-sm">
                                <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                                No bank transactions logged today yet.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-150">
                                            <th className="px-6 py-3 font-bold text-gray-500 w-24">Time</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 w-24">Type</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 w-32">Category</th>
                                            <th className="px-6 py-3 font-bold text-gray-500 w-32">Bank Name</th>
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
                                                        e.type === 'bank_in' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                                    }`}>
                                                        {e.type === 'bank_in' ? 'IN' : 'OUT'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase ${
                                                        CATEGORY_COLORS[e.category] || 'bg-gray-50 text-gray-600 border-gray-150'
                                                    }`}>
                                                        {CATEGORY_LABELS[e.category] || e.category}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-gray-800">{e.bank_name || 'N/A'}</td>
                                                <td className="px-6 py-4 font-bold text-gray-800">{e.description}</td>
                                                <td className={`px-6 py-4 text-right font-extrabold text-sm ${
                                                    e.type === 'bank_in' ? 'text-emerald-600' : 'text-rose-600'
                                                }`}>
                                                    {e.type === 'bank_in' ? '+' : '-'}{fmt(e.amount)}
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
                    <div className="bg-white rounded-2xl max-w-md w-full border border-gray-155 shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                {entryModal.type === 'bank_in' ? <TrendingUp className="text-emerald-500" size={18} /> : <TrendingDown className="text-rose-500" size={18} />}
                                Add Bank {entryModal.type === 'bank_in' ? 'In' : 'Out'}
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
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category</label>
                                <select
                                    value={entryForm.category}
                                    onChange={e => setEntryForm(prev => ({ ...prev, category: e.target.value as DayBookEntryCategory }))}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                >
                                    <option value="transfer">Bank Transfer</option>
                                    <option value="qr_payment">QR Payment</option>
                                    <option value="card">Card Payment</option>
                                    <option value="deposit">Bank Deposit</option>
                                    <option value="withdrawal">Cash Withdrawal</option>
                                    <option value="bank_charges">Bank Charges</option>
                                    <option value="transfer_out">Transfer Out</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Bank Name</label>
                                <input
                                    type="text"
                                    value={entryForm.bank_name}
                                    onChange={e => setEntryForm(prev => ({ ...prev, bank_name: e.target.value }))}
                                    placeholder="e.g. NIC Asia, Nabil Bank"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description</label>
                                <input
                                    type="text"
                                    value={entryForm.description}
                                    onChange={e => setEntryForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Enter details..."
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
                                    entryModal.type === 'bank_in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
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
