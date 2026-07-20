'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { createBankAccountAction } from './actions'
import {
    TrendingUp, TrendingDown, Plus, X, Loader2,
    Lock, Trash2, CalendarDays, CheckCircle2, AlertCircle, Landmark,
    Download, Printer
} from 'lucide-react'
import type { DayBookSession, DayBookEntry, DayBookEntryCategory, ExpenseCategory } from '@/types/database'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { toNepaliDate } from '@/lib/nepaliDate'
import { useConfirmStore } from '@/lib/stores/confirm'
import { orderCategoriesForDisplay, findMainCategory } from '@/lib/utils'
import Select from '@/components/ui/Select'

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
    bankAccounts: Array<{ id: string; name: string; bank_name: string | null; account_number: string | null }>
    expenseCategories: ExpenseCategory[]
}

const CATEGORY_LABELS: Record<string, string> = {
    qr_payment:       'QR Payment',
    card:             'Card Payment',
    transfer:         'Bank Transfer',
    deposit:          'Bank Deposit',
    withdrawal:       'Cash Withdrawal',
    bank_charges:     'Bank Charges',
    transfer_out:     'Transfer Out',
    expense:          'Expense',
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
    expense:         'bg-red-50 text-red-700 border-red-100',
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
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' })
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

export default function BankBookClient({
    initialSession,
    initialEntries,
    initialTotals,
    todayDate,
    userRole,
    previousClosingBankBalance,
    previousClosingCashBalance,
    bankAccounts,
    expenseCategories
}: BankBookClientProps) {
    const { confirm } = useConfirmStore()
    const [session, setSession]   = useState<DayBookSession | null>(initialSession)
    const [entries, setEntries]   = useState<DayBookEntry[]>(initialEntries)
    const [totals, setTotals]     = useState(initialTotals)
    const [bankAccountsList, setBankAccountsList] = useState(bankAccounts)
    const expenseCategoryOptions = useMemo(() => orderCategoriesForDisplay(expenseCategories), [expenseCategories])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'time', label: 'Time' },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'bank_name', label: 'Bank Name' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
    ]
    const reportRows = entries.map(e => ({
        time: timeStr(e.created_at),
        type: e.type === 'bank_in' ? 'IN' : 'OUT',
        category: CATEGORY_LABELS[e.category] || e.category,
        bank_name: e.bank_name || '',
        description: formatDescription(e.description),
        amount: (e.type === 'bank_in' ? '+' : '-') + fmt(e.amount),
    }))
    const handleExportCsv = () => downloadCsv(`bank-book-${todayDate}`, reportColumns, reportRows)

    // Add Bank Modal state
    const [addBankModalOpen, setAddBankModalOpen] = useState(false)
    const [newBankName, setNewBankName] = useState('')
    const [newBankAccountNumber, setNewBankAccountNumber] = useState('')
    const [newBankDisplayName, setNewBankDisplayName] = useState('')
    const [ownershipType, setOwnershipType] = useState<'company' | 'personal' | ''>('')
    const [submittingBank, setSubmittingBank] = useState(false)

    // Open Day state
    const [isOpeningDay, setIsOpeningDay]       = useState(false)
    const [openingBankBalanceInput, setOpeningBankBalanceInput] = useState(
        previousClosingBankBalance !== null ? String(previousClosingBankBalance) : ''
    )
    const [isSubmittingOpen, setIsSubmittingOpen] = useState(false)

    // Add Entry modal
    const EMPTY_ENTRY_FORM = { amount: '', description: '', category: 'transfer' as DayBookEntryCategory, bank_name: '', expense_category_id: '' }
    const [entryModal, setEntryModal] = useState<{ type: 'bank_in' | 'bank_out' } | null>(null)
    const [entryForm, setEntryForm]   = useState(EMPTY_ENTRY_FORM)
    // Auto-identifies the main category once a subcategory is picked.
    const selectedMainExpenseCategory = useMemo(
        () => findMainCategory(expenseCategories, entryForm.expense_category_id),
        [expenseCategories, entryForm.expense_category_id],
    )

    // Reset on open so a Bank Out-only category ('expense', 'withdrawal') left
    // behind by a cancelled entry can't be submitted against a Bank In.
    const openEntryModal = (type: 'bank_in' | 'bank_out') => {
        setEntryForm(EMPTY_ENTRY_FORM)
        setEntryModal({ type })
    }
    const [isSubmittingEntry, setIsSubmittingEntry] = useState(false)
    const [ledgerTab, setLedgerTab] = useState<'bank_in' | 'bank_out'>('bank_in')

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
                    bank_name: entryForm.bank_name.trim(),
                    expense_category_id: (entryForm.category === 'expense') ? entryForm.expense_category_id : undefined,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            const newEntries = [data.data]

            // If a bank_out is a Cash Withdrawal, automatically insert a matching
            // cash_in entry so the cash actually lands in the Cash Book register
            // (mirrors Cash Book's own Bank Deposit -> bank_in auto-pairing).
            if (entryModal.type === 'bank_out' && entryForm.category === 'withdrawal') {
                try {
                    const autoRes = await fetch('/api/day-book/entries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: session.id,
                            type: 'cash_in',
                            amount,
                            description: `Cash Withdrawal: ${entryForm.description.trim()}`,
                            category: 'withdrawal',
                            bank_name: entryForm.bank_name.trim(),
                        }),
                    })
                    if (autoRes.ok) {
                        toast.success('Bank Out logged and withdrawn to Cash successfully!')
                    } else {
                        // The money already left the bank account; the operator has
                        // to know the matching cash entry never landed.
                        const autoData = await autoRes.json().catch(() => ({}))
                        toast.error(
                            `Bank Out logged, but the matching Cash In failed: ${autoData.error ?? autoRes.statusText}. Add it to the Cash Book manually.`
                        )
                    }
                } catch (autoErr) {
                    console.error('Failed to auto-create cash entry', autoErr)
                    toast.error('Bank Out logged, but the matching Cash In failed. Add it to the Cash Book manually.')
                }
            } else {
                toast.success('Bank transaction logged successfully!')
            }

            const updated = [...newEntries, ...entries]
            setEntries(updated)
            recalc(updated, session.opening_bank_balance ?? 0)
            setEntryModal(null)
            setEntryForm({ amount: '', description: '', category: 'transfer', bank_name: '', expense_category_id: '' })
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
            recalc(updated, session!.opening_bank_balance ?? 0)
            toast.success('Entry deleted')
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to delete'
            toast.error(errMsg)
        }
    }

    // ── Close Day ────────────────────────────────────────────
    const handleCloseDay = async () => {
        const ok = await confirm({ title: "Close today's bank book?", message: `Closing Bank: ${fmt(totals.closing_bank_balance)}`, confirmText: 'Close', isDestructive: false })
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
            // (carrying this session's closing bank balance forward as its
            // opening balance) — reflect that new open session immediately
            // instead of showing "closed" until the next full page load.
            if (data.next_session) {
                setSession(data.next_session)
                setEntries([])
                setTotals({
                    total_bank_in: 0,
                    total_bank_out: 0,
                    closing_bank_balance: Number(data.next_session.opening_bank_balance),
                })
                toast.success(`Bank Book closed — new day opened with Rs. ${fmt(Number(data.next_session.opening_bank_balance))} opening balance.`)
            } else {
                setSession(data.data)
                toast.success('Bank Book closed successfully!')
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to close day'
            toast.error(errMsg)
        } finally {
            setIsClosingDay(false)
        }
    }

    // ── Add Bank Account ──────────────────────────────────────
    const handleAddBank = async (e: React.FormEvent) => {
        e.preventDefault()
        const bName = newBankName.trim()
        const accNum = newBankAccountNumber.trim()
        const dispName = newBankDisplayName.trim() || bName

        if (!ownershipType) { toast.error('Ownership Category is required'); return }
        if (!bName) { toast.error('Bank Name is required'); return }
        if (!accNum) { toast.error('Account Number is required'); return }

        const finalBankName = `${ownershipType}:${bName}`

        setSubmittingBank(true)
        try {
            const res = await createBankAccountAction({
                bank_name: finalBankName,
                account_number: accNum,
                display_name: dispName,
            })
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                setBankAccountsList(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
                setNewBankName('')
                setNewBankAccountNumber('')
                setNewBankDisplayName('')
                setOwnershipType('')
                setAddBankModalOpen(false)
                
                // Auto select it in the entry form
                setEntryForm(prev => ({ ...prev, bank_name: res.data.name }))
                
                toast.success('Bank account created successfully!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create bank account')
        } finally {
            setSubmittingBank(false)
        }
    }

    // ── Re-open Day ──────────────────────────────────────────
    const [isReopeningDay, setIsReopeningDay] = useState(false)
    const handleReopenDay = async () => {
        const ok = await confirm({ title: "Re-open today's bank book?", message: 'This will unlock transactions for editing.', confirmText: 'Reopen', isDestructive: false })
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
            toast.success('Bank Book re-opened successfully!')
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
        const ad = d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
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
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <Landmark size={20} className="text-indigo-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Bank Book</h1>
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
                    {canManage && (
                        <button
                            onClick={() => setAddBankModalOpen(true)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/20"
                        >
                            <Plus size={16} /> Add Bank
                        </button>
                    )}
                    {session?.status === 'open' && canManage && (
                        <button
                            onClick={handleCloseDay}
                            disabled={isClosingDay}
                            className="flex items-center gap-2 px-4 py-2.5 bg-ink text-surface hover:opacity-90 font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
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
                            <span className="flex items-center gap-2 px-4 py-2.5 bg-surface-muted text-ink-subtle font-bold rounded-xl text-sm border border-hairline">
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
                <div className="bg-surface rounded-2xl border border-indigo-200 p-6 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <h3 className="font-extrabold text-ink mb-1 flex items-center gap-2">
                        <Landmark size={18} className="text-indigo-600" /> Open Bank Book
                    </h3>
                    <p className="text-sm text-ink-subtle mb-5">
                        Initialize today&apos;s bank ledger opening balance. Yesterday&apos;s closing bank balance is pre-filled if available.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mb-5">
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Opening Bank Balance (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={openingBankBalanceInput}
                                onChange={e => setOpeningBankBalanceInput(e.target.value)}
                                placeholder="0.00"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-lg p-3 border bg-surface text-ink font-bold transition-all"
                            />
                            {previousClosingBankBalance !== null && (
                                <span className="text-[11px] text-ink-subtle font-semibold mt-1 block">Prefilled: {fmt(previousClosingBankBalance)}</span>
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
                        <button onClick={() => setIsOpeningDay(false)} className="px-4 py-3 text-ink-subtle hover:text-ink font-semibold rounded-xl hover:bg-surface-muted transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* ── No Session Placeholder ── */}
            {!session && !isOpeningDay && (
                <div className="bg-surface rounded-3xl border border-hairline p-16 text-center shadow-sm">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Landmark size={28} className="text-indigo-500" />
                    </div>
                    <h3 className="font-extrabold text-ink text-xl mb-2">Bank Book Not Opened</h3>
                    <p className="text-ink-subtle text-sm max-w-sm mx-auto mb-6">
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
                        <div className="bg-surface rounded-2xl border border-hairline p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Opening bank balance</p>
                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <Landmark size={15} className="text-blue-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-ink">{fmt(session.opening_bank_balance ?? 0)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Starting bank ledger balance</p>
                        </div>

                        {/* Total Bank In */}
                        <div className="bg-surface rounded-2xl border border-emerald-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Bank In</p>
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <TrendingUp size={15} className="text-emerald-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-emerald-600">+{fmt(totals.total_bank_in)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Received today</p>
                        </div>

                        {/* Total Bank Out */}
                        <div className="bg-surface rounded-2xl border border-rose-100 p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Bank Out</p>
                                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <TrendingDown size={15} className="text-rose-600" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-rose-600">-{fmt(totals.total_bank_out)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Paid / Transferred today</p>
                        </div>

                        {/* Closing Balance */}
                        <div className="bg-surface rounded-2xl border border-hairline p-5 shadow-sm">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Closing Bank balance</p>
                                <div className="w-8 h-8 rounded-lg bg-surface-muted flex items-center justify-center">
                                    <Lock size={15} className="text-ink-subtle" />
                                </div>
                            </div>
                            <p className="text-2xl font-black text-ink">{fmt(totals.closing_bank_balance)}</p>
                            <p className="text-xs text-ink-subtle mt-1">Calculated current bank balance</p>
                        </div>
                    </div>

                    {/* Table and Log Control */}
                    <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-hairline flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-extrabold text-ink">Bank Ledger Entries</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">List of bank transactions for today</p>
                            </div>
                            {session.status === 'open' && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => openEntryModal('bank_in')}
                                        className="flex items-center gap-1 px-3 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-extrabold rounded-xl text-xs border border-emerald-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Bank In (Receive)
                                    </button>
                                    <button
                                        onClick={() => openEntryModal('bank_out')}
                                        className="flex items-center gap-1 px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 font-extrabold rounded-xl text-xs border border-rose-200 transition-colors"
                                    >
                                        <Plus size={14} /> Add Bank Out (Payment)
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Fixed In/Out sections — click one to view only that side, full width */}
                        <div className="grid grid-cols-2 border-b border-hairline">
                            {(['bank_in', 'bank_out'] as const).map(sideType => {
                                const isIn = sideType === 'bank_in'
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
                                        {isIn ? 'Bank In' : 'Bank Out'} ({count})
                                    </button>
                                )
                            })}
                        </div>

                        {(() => {
                            const isIn = ledgerTab === 'bank_in'
                            const sideEntries = entries.filter(e => e.type === ledgerTab)
                            if (sideEntries.length === 0) {
                                return (
                                    <div className="p-16 text-center text-ink-subtle text-sm">
                                        <AlertCircle size={24} className="mx-auto mb-2 opacity-50" />
                                        No {isIn ? 'bank in' : 'bank out'} entries logged today yet.
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
                                                <th className="px-6 py-3 font-bold text-ink-subtle w-32">Bank Name</th>
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
                                                    <td className="px-6 py-4 font-bold text-ink">{e.bank_name || 'N/A'}</td>
                                                    <td className="px-6 py-4 font-bold text-ink">{formatDescription(e.description)}</td>
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
                <Modal open onClose={() => setEntryModal(null)} size="md" ariaLabel={`Add bank ${entryModal.type === 'bank_in' ? 'in' : 'out'}`} className="overflow-hidden">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <h3 className="text-h3 text-ink flex items-center gap-2">
                                {entryModal.type === 'bank_in' ? <TrendingUp className="text-emerald-500" size={18} /> : <TrendingDown className="text-rose-500" size={18} />}
                                Add Bank {entryModal.type === 'bank_in' ? 'In' : 'Out'}
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
                                    onChange={e => setEntryForm(prev => ({ ...prev, category: e.target.value as DayBookEntryCategory }))}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                >
                                    <option value="transfer">Bank Transfer</option>
                                    <option value="qr_payment">QR Payment</option>
                                    <option value="card">Card Payment</option>
                                    <option value="deposit">Bank Deposit</option>
                                    <option value="bank_charges">Bank Charges</option>
                                    <option value="transfer_out">Transfer Out</option>
                                    {entryModal.type === 'bank_out' && (
                                        <option value="withdrawal">Cash Withdrawal (Moves to Cash Book)</option>
                                    )}
                                    {entryModal.type === 'bank_out' && (
                                        <option value="expense">Expense</option>
                                    )}
                                    <option value="other">Other</option>
                                </Select>
                            </div>

                            {entryForm.category === 'expense' && (
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Expense Category</label>
                                    <Select
                                        value={entryForm.expense_category_id}
                                        onChange={e => setEntryForm(prev => ({ ...prev, expense_category_id: e.target.value }))}
                                        searchable
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        <option value="">Select category...</option>
                                        {expenseCategoryOptions.map(({ category, label }) => (
                                            <option key={category.id} value={category.id}>{label}</option>
                                        ))}
                                    </Select>
                                    {selectedMainExpenseCategory && (
                                        <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mt-1 block">
                                            Main Category: <span className="text-ink-subtle normal-case">{selectedMainExpenseCategory.name}</span>
                                        </span>
                                    )}
                                    {expenseCategories.length === 0 && (
                                        <span className="text-[11px] text-ink-subtle font-semibold mt-1 block">
                                            No expense categories yet — add one from Income &amp; Expenses.
                                        </span>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Bank Name</label>
                                <Select
                                    value={entryForm.bank_name}
                                    onChange={e => setEntryForm(prev => ({ ...prev, bank_name: e.target.value }))}
                                    required
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                >
                                    <option value="">Select Bank Account</option>
                                    {bankAccountsList.map(b => (
                                        <option key={b.id} value={b.name}>{b.name} ({b.account_number})</option>
                                    ))}
                                    {bankAccountsList.length === 0 && (
                                        <option value="General Bank">General Bank</option>
                                    )}
                                </Select>
                            </div>

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
                                    entryModal.type === 'bank_in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                                } disabled:opacity-50`}
                            >
                                {isSubmittingEntry && <Loader2 size={14} className="animate-spin" />}
                                Add Entry
                            </button>
                        </div>
                </Modal>
            )}

            {/* ── ADD BANK ACCOUNT MODAL ── */}
            {addBankModalOpen && (
                <Modal open onClose={() => setAddBankModalOpen(false)} size="md" ariaLabel="Add bank account" className="overflow-hidden">
                        {/* Modal Header */}
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <h3 className="text-h3 text-ink flex items-center gap-2">
                                <Landmark size={18} className="text-brand-500" />
                                Add New Bank Account
                            </h3>
                            <button onClick={() => setAddBankModalOpen(false)} className="text-ink-subtle hover:text-ink transition-colors focus-ring rounded-md">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleAddBank}>
                            <div className="p-6 space-y-4">
                                {/* Ownership Category */}
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Ownership Category *</label>
                                    <Select
                                        value={ownershipType}
                                        onChange={e => setOwnershipType(e.target.value as 'company' | 'personal' | '')}
                                        required
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        <option value="">Choose Category *</option>
                                        <option value="company">Company Account (A/C Payee)</option>
                                        <option value="personal">Personal Account (Manager/Owner)</option>
                                    </Select>
                                </div>

                                {/* Bank Name */}
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Bank Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. NIC Asia Bank, Nabil Bank"
                                        value={newBankName}
                                        onChange={e => setNewBankName(e.target.value)}
                                        required
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    />
                                </div>

                                {/* Account Number */}
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Account Number *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 1234567890"
                                        value={newBankAccountNumber}
                                        onChange={e => setNewBankAccountNumber(e.target.value)}
                                        required
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    />
                                </div>

                                {/* Account Display Name / Nickname */}
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Account Display Name (Optional)</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. NIC Asia - Main Business"
                                        value={newBankDisplayName}
                                        onChange={e => setNewBankDisplayName(e.target.value)}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAddBankModalOpen(false)}
                                    className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingBank}
                                    className="px-6 py-2.5 bg-brand-500 text-white font-bold text-sm rounded-[var(--r-md)] flex items-center justify-center gap-1.5 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none"
                                >
                                    {submittingBank && <Loader2 size={14} className="animate-spin" />}
                                    Create Bank
                                </button>
                            </div>
                        </form>
                </Modal>
            )}

            <PrintableReport
                ref={printRef}
                title="Bank Book"
                subtitle={dateLabel}
                columns={reportColumns}
                rows={reportRows}
            />
        </div>
    )
}
