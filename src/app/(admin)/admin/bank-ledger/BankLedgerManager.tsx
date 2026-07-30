'use client'

import { useState, useMemo, useRef } from 'react'
import {
    Landmark, ArrowRightLeft, TrendingUp, TrendingDown, FileText, LandmarkIcon,
    Plus, X, Loader2, Printer, Edit2, ShieldAlert
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { createBankAccountAction, saveBankOpeningBalanceAction } from '../bank-book/actions'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import ExportMenu from '@/components/admin/ExportMenu'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import Select from '@/components/ui/Select'

interface BankAccount {
    id: string
    name: string
    bank_name: string | null
    account_number: string | null
    opening_balance: number
    is_active: boolean
    deactivation_reason?: string | null
    created_at: string
}

interface BankEntry {
    id: string
    session_id: string
    type: 'bank_in' | 'bank_out'
    amount: number
    description: string
    category: string
    created_at: string
    bank_name: string | null
    created_by_name?: string | null
    day_book_sessions?: {
        date: string
    } | null
}

interface BankLedgerManagerProps {
    bankAccounts: BankAccount[]
    bankEntries: BankEntry[]
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
    other:           'bg-surface-muted text-ink-subtle border-hairline',
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

export default function BankLedgerManager({
    bankAccounts,
    bankEntries
}: BankLedgerManagerProps) {
    const [bankAccountsList, setBankAccountsList] = useState<BankAccount[]>(bankAccounts)
    const [selectedBankId, setSelectedBankId] = useState<string | null>(
        bankAccounts.length > 0 ? bankAccounts[0].id : null
    )
    const formatDate = useDateFormatter()
    const [timeFilter, setTimeFilter] = useState<'this_month' | 'this_year' | 'all'>('this_month')

    // Add Bank Modal state
    const [addBankModalOpen, setAddBankModalOpen] = useState(false)
    const [newBankName, setNewBankName] = useState('')
    const [newBankAccountNumber, setNewBankAccountNumber] = useState('')
    const [newBankDisplayName, setNewBankDisplayName] = useState('')
    const [ownershipType, setOwnershipType] = useState<'company' | 'personal' | ''>('')
    const [submittingBank, setSubmittingBank] = useState(false)

    // Opening Balance Modal state
    const [obModalOpen, setObModalOpen] = useState(false)
    const [obAmount, setObAmount] = useState('')
    const [obReason, setObReason] = useState('')
    const [isObEdit, setIsObEdit] = useState(false)
    const [submittingOb, setSubmittingOb] = useState(false)

    const handleOpenAddOb = (currentBal: number) => {
        setObAmount(currentBal > 0 ? String(currentBal) : '')
        setObReason('')
        setIsObEdit(false)
        setObModalOpen(true)
    }

    const handleOpenEditOb = (currentBal: number) => {
        setObAmount(String(currentBal))
        setObReason('')
        setIsObEdit(true)
        setObModalOpen(true)
    }

    const handleSaveOpeningBalance = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedBankId) return
        const amt = parseFloat(obAmount)
        if (isNaN(amt)) { toast.error('Opening balance must be a valid number'); return }
        if (isObEdit && !obReason.trim()) {
            toast.error('Reason for editing opening balance is required')
            return
        }

        setSubmittingOb(true)
        try {
            const res = await saveBankOpeningBalanceAction({
                bank_account_id: selectedBankId,
                opening_balance: amt,
                reason: obReason.trim(),
                is_edit: isObEdit,
            })
            if (res.error) {
                toast.error(res.error)
            } else {
                setBankAccountsList(prev => prev.map(b => b.id === selectedBankId ? { ...b, opening_balance: amt } : b))
                setObModalOpen(false)
                toast.success(isObEdit ? 'Opening balance updated successfully' : 'Opening balance added successfully')
            }
        } catch (err) {
            toast.error('Failed to save opening balance')
        } finally {
            setSubmittingOb(false)
        }
    }

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
                setBankAccountsList(prev => {
                    const updated = [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name))
                    return updated
                })
                // Auto-select the newly added bank
                setSelectedBankId(res.data.id)
                setNewBankName('')
                setNewBankAccountNumber('')
                setNewBankDisplayName('')
                setOwnershipType('')
                setAddBankModalOpen(false)
                toast.success('Bank account created successfully!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create bank account')
        } finally {
            setSubmittingBank(false)
        }
    }

    // Find the currently selected bank account object
    const activeBankAccount = useMemo(() => {
        return bankAccountsList.find(b => b.id === selectedBankId) || null
    }, [bankAccountsList, selectedBankId])

    // Calculate balances for each bank account in the list
    const bankAccountsWithBalances = useMemo(() => {
        return bankAccountsList.map(b => {
            const nameLower = b.name.toLowerCase().trim()
            const entries = bankEntries.filter(e => e.bank_name?.toLowerCase().trim() === nameLower)
            
            const totalIn = entries.filter(e => e.type === 'bank_in').reduce((s, e) => s + Number(e.amount), 0)
            const totalOut = entries.filter(e => e.type === 'bank_out').reduce((s, e) => s + Number(e.amount), 0)
            
            return {
                ...b,
                totalIn,
                totalOut,
                currentBalance: Number(b.opening_balance) + totalIn - totalOut
            }
        })
    }, [bankAccountsList, bankEntries])

    const activeBankAccountWithBalance = useMemo(() => {
        return bankAccountsWithBalances.find(b => b.id === selectedBankId) || null
    }, [bankAccountsWithBalances, selectedBankId])

    // Filter bank entries by active bank and time filter
    const activeBankEntries = useMemo(() => {
        if (!activeBankAccount) return []
        const nameLower = activeBankAccount.name.toLowerCase().trim()

        // 1. Filter entries matching bank name
        let filtered = bankEntries.filter(e => e.bank_name?.toLowerCase().trim() === nameLower)

        // 2. Filter by month/year
        const now = new Date()
        const currentMonth = now.getMonth()
        const currentYear = now.getFullYear()

        filtered = filtered.filter(e => {
            // Get date from parent session or created_at
            const dateStr = e.day_book_sessions?.date || e.created_at.split('T')[0]
            const entryDate = new Date(dateStr)

            if (timeFilter === 'this_month') {
                return entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear
            }
            if (timeFilter === 'this_year') {
                return entryDate.getFullYear() === currentYear
            }
            return true
        })

        // 3. Sort non-opening-balance transactions chronologically
        const sorted = [...filtered].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        const obAmount = Number(activeBankAccount.opening_balance || 0)
        let runningBal = obAmount

        const entriesWithBalance = sorted.map(e => {
            const amount = Number(e.amount)
            if (e.type === 'bank_in') {
                runningBal += amount
            } else {
                runningBal -= amount
            }
            return {
                ...e,
                amount,
                runningBalance: runningBal
            }
        })

        // Always pin Opening Balance at Row #1 (Very Top)
        const obRow = {
            id: `ob-${activeBankAccount.id}`,
            created_at: activeBankAccount.created_at || new Date().toISOString(),
            bank_name: activeBankAccount.bank_name || '',
            account_number: activeBankAccount.account_number || '',
            type: 'bank_in' as const,
            amount: obAmount,
            description: 'Opening Balance (Initial Bank Balance)',
            category: 'opening_balance',
            isOpeningBalance: true,
            runningBalance: obAmount,
            created_by_name: null,
            day_book_sessions: undefined
        }

        return [obRow, ...entriesWithBalance]
    }, [activeBankAccount, bankEntries, timeFilter])

    // Summary calculations for the selected bank in the selected time filter
    const stats = useMemo(() => {
        const deposited = activeBankEntries
            .filter(e => e.type === 'bank_in')
            .reduce((s, e) => s + e.amount, 0)

        const cashTransfers = activeBankEntries
            .filter(e => e.type === 'bank_in' && (e.category === 'deposit' || e.description.toLowerCase().includes('cash')))
            .reduce((s, e) => s + e.amount, 0)

        const withdrawn = activeBankEntries
            .filter(e => e.type === 'bank_out')
            .reduce((s, e) => s + e.amount, 0)

        return {
            deposited,
            cashTransfers,
            withdrawn,
            netChange: deposited - withdrawn
        }
    }, [activeBankEntries])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'description', label: 'Description' },
        { key: 'bank_in', label: 'Bank In', align: 'right' as const },
        { key: 'bank_out', label: 'Bank Out', align: 'right' as const },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'by', label: 'Responsible Name' },
        { key: 'running_balance', label: 'Running Balance', align: 'right' as const },
    ]
    const reportRows = activeBankEntries.map(e => ({
        date: formatDate(e.day_book_sessions?.date || e.created_at),
        description: formatDescription(e.description),
        bank_in: e.type === 'bank_in' ? formatCurrency(e.amount) : '',
        bank_out: e.type === 'bank_out' ? formatCurrency(e.amount) : '',
        type: e.type === 'bank_in' ? 'IN' : 'OUT',
        category: CATEGORY_LABELS[e.category] || e.category,
        by: ('isOpeningBalance' in e && e.isOpeningBalance) ? '—' : (e.created_by_name || 'Unknown'),
        running_balance: formatCurrency(e.runningBalance),
    }))
    const exportFilename = `bank-ledger-${activeBankAccount?.name || 'account'}`
    const handleExportCsv = () => downloadCsv(exportFilename, reportColumns, reportRows)
    const handleExportExcel = () => downloadExcel(exportFilename, reportColumns, reportRows)
    const handleExportPdf = () => printRef.current?.print()

    return (
        <div className="space-y-6 pb-16 animate-fade-up">
            {/* Clean Light Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                            <Landmark size={20} className="text-brand-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Bank Ledger</h1>
                            <p className="text-sm text-ink-subtle mt-0.5">
                                Select bank account to analyze detailed statements, running balances, and cash deposits.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAddBankModalOpen(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-[#e04f00] text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-brand-500/10 focus-ring"
                    >
                        <Plus size={15} /> Add Bank
                    </button>
                </div>
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left Side: Bank Account directory list */}
                <div className="lg:col-span-4 bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-hairline bg-surface-muted/50">
                        <p className="text-xs font-black text-ink uppercase tracking-wider">Bank Accounts ({bankAccountsWithBalances.length})</p>
                    </div>
                    
                    <div className="divide-y divide-hairline">
                        {bankAccountsWithBalances.length === 0 ? (
                            <div className="text-center py-12 text-ink-subtle">
                                <LandmarkIcon size={30} className="mx-auto mb-2 opacity-30" />
                                <p className="text-xs font-bold">No registered bank accounts</p>
                                <p className="text-[10px] text-ink-subtle mt-1 px-4 leading-relaxed">
                                    Go to Bank Book section to register your bank account details.
                                </p>
                            </div>
                        ) : (
                            bankAccountsWithBalances.map(b => {
                                const isSelected = b.id === selectedBankId
                                return (
                                    <button
                                        key={b.id}
                                        onClick={() => setSelectedBankId(b.id)}
                                        className={`w-full text-left p-4 flex items-center justify-between gap-3 transition-colors ${
                                            isSelected ? 'bg-brand-50/20 border-l-4 border-brand-500 pl-3' : 'bg-surface hover:bg-surface-muted/50'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="font-extrabold text-sm text-ink truncate">{b.name}</p>
                                            <p className="text-[10px] text-ink-subtle font-semibold mt-0.5">
                                                {b.bank_name || 'Bank'} • {b.account_number || 'N/A'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-xs font-black text-ink">{formatCurrency(b.currentBalance)}</p>
                                            <p className="text-[9px] text-ink-subtle font-bold uppercase mt-0.5">Balance</p>
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>

                {/* Right Side: Account statement and filters */}
                <div className="lg:col-span-8 space-y-6">
                    {activeBankAccount ? (
                        <>
                            {/* Controls and filter card */}
                            <div className="bg-surface border border-hairline rounded-[var(--r-lg)] p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Statement Ledger</span>
                                    <h3 className="text-lg font-extrabold text-ink mt-0.5">{activeBankAccount.name}</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">
                                        Account No: {activeBankAccount.account_number || 'N/A'} | Bank: {activeBankAccount.bank_name || 'N/A'}
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    {activeBankAccount.opening_balance > 0 ? (
                                        <button
                                            onClick={() => handleOpenEditOb(activeBankAccount.opening_balance)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold border border-amber-200 rounded-xl text-xs transition-all shadow-sm"
                                            title="Edit Opening Balance (requires reason)"
                                        >
                                            <Edit2 size={13} /> Edit Opening Balance ({formatCurrency(activeBankAccount.opening_balance)})
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleOpenAddOb(0)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold border border-emerald-200 rounded-xl text-xs transition-all shadow-sm"
                                        >
                                            <Plus size={13} /> Add Opening Balance
                                        </button>
                                    )}

                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-ink-subtle whitespace-nowrap">Filter:</span>
                                        <div className="flex bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] p-1 shrink-0">
                                            {(['this_month', 'this_year', 'all'] as const).map(f => {
                                                const labels = { this_month: 'This Month', this_year: 'This Year', all: 'All Time' }
                                                const active = timeFilter === f
                                                return (
                                                    <button
                                                        key={f}
                                                        onClick={() => setTimeFilter(f)}
                                                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-[var(--r-md)] transition-all focus:outline-none ${
                                                            active ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-subtle hover:text-ink'
                                                        }`}
                                                    >
                                                        {labels[f]}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Metrics Row */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                                        <TrendingUp size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Deposits / Inward</p>
                                        <p className="text-base font-black text-emerald-600 mt-0.5">{formatCurrency(stats.deposited)}</p>
                                    </div>
                                </div>

                                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shrink-0">
                                        <ArrowRightLeft size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Cash-to-Bank Transfers</p>
                                        <p className="text-base font-black text-amber-700 mt-0.5">{formatCurrency(stats.cashTransfers)}</p>
                                    </div>
                                </div>

                                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                                        <TrendingDown size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Withdrawals / Outward</p>
                                        <p className="text-base font-black text-rose-600 mt-0.5">{formatCurrency(stats.withdrawn)}</p>
                                    </div>
                                </div>
                            </div>

                        </>
                    ) : (
                        <div className="bg-surface border border-hairline rounded-2xl py-20 text-center text-ink-subtle">
                            <Landmark size={44} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-bold">Select a bank account from the directory to view statement</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Detailed Statement Table — full width, breaking out of the
                sidebar+statement grid above so it spans edge to edge */}
            {activeBankAccount && (
                <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-hairline bg-surface-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-black text-ink uppercase tracking-wider">Account Statement Transactions ({activeBankEntries.length})</p>
                        {activeBankEntries.length > 0 && (
                            <div className="flex items-center gap-2">
                                <ExportMenu
                                    onExportCsv={handleExportCsv}
                                    onExportExcel={handleExportExcel}
                                    onExportPdf={handleExportPdf}
                                />
                                <button
                                    onClick={() => printRef.current?.print()}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase tracking-wider border border-hairline transition-all shrink-0"
                                >
                                    <Printer size={13} /> Print
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        {activeBankEntries.length === 0 ? (
                            <div className="text-center py-20 px-4 text-ink-subtle">
                                <FileText size={36} className="mx-auto mb-2 opacity-30" />
                                <p className="text-xs font-bold">No transactions found for this period</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                        <th className="px-4 py-3 font-bold w-24">Date</th>
                                        <th className="px-4 py-3 font-bold">Description</th>
                                        <th className="px-4 py-3 font-bold text-right w-28">Bank In</th>
                                        <th className="px-4 py-3 font-bold text-right w-28">Bank Out</th>
                                        <th className="px-4 py-3 font-bold text-center w-20">Type</th>
                                        <th className="px-4 py-3 font-bold text-center w-28">Category</th>
                                        <th className="px-4 py-3 font-bold w-32">Responsible Name</th>
                                        <th className="px-4 py-3 font-bold text-right w-28 bg-surface-muted/50">Running Balance</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                    {activeBankEntries.map(e => (
                                        <tr key={e.id} className="hover:bg-surface-muted/50 transition-colors">
                                            {/* Date */}
                                            <td className="px-4 py-3 text-ink-subtle font-semibold">
                                                {formatDate(e.day_book_sessions?.date || e.created_at)}
                                            </td>
                                            {/* Description */}
                                            <td className="px-4 py-3 font-bold text-ink">{formatDescription(e.description)}</td>
                                            {/* Bank In */}
                                            <td className="px-4 py-3 text-right font-black text-xs text-emerald-600">
                                                {e.type === 'bank_in' ? `+${formatCurrency(e.amount)}` : '-'}
                                            </td>
                                            {/* Bank Out */}
                                            <td className="px-4 py-3 text-right font-black text-xs text-rose-600">
                                                {e.type === 'bank_out' ? `-${formatCurrency(e.amount)}` : '-'}
                                            </td>
                                            {/* Type */}
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                                    e.type === 'bank_in' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                                }`}>
                                                    {e.type === 'bank_in' ? 'IN' : 'OUT'}
                                                </span>
                                            </td>
                                            {/* Category */}
                                            <td className="px-4 py-3 text-center">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase ${
                                                    CATEGORY_COLORS[e.category] || 'bg-surface-muted text-ink-subtle border-hairline'
                                                }`}>
                                                    {CATEGORY_LABELS[e.category] || e.category}
                                                </span>
                                            </td>
                                            {/* Responsible Name */}
                                            <td className="px-4 py-3 font-bold text-ink">
                                                {'isOpeningBalance' in e && e.isOpeningBalance ? '—' : (e.created_by_name || 'Unknown')}
                                            </td>
                                            {/* Running Balance */}
                                            <td className="px-4 py-3 text-right font-black bg-surface-muted/30 text-ink">
                                                {formatCurrency(e.runningBalance)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {activeBankAccountWithBalance && (
                        <div className="bg-brand-50/5 border-t border-hairline p-4 flex items-center justify-between">
                            <span className="text-xs font-black text-ink uppercase tracking-wider">Total Amount Left in {activeBankAccountWithBalance.name}:</span>
                            <span className="text-base font-black text-brand-500">{formatCurrency(activeBankAccountWithBalance.currentBalance)}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Add Bank Modal */}
            {addBankModalOpen && (
                <Modal open onClose={() => setAddBankModalOpen(false)} size="md" ariaLabel="Add bank account" className="bg-surface overflow-hidden">
                        <div className="p-5 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="font-extrabold text-ink text-sm">Register New Bank Account</h3>
                                <p className="text-[10px] text-ink-subtle mt-0.5">Add to your active bank directories</p>
                            </div>
                            <button 
                                onClick={() => setAddBankModalOpen(false)}
                                className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink-subtle transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleAddBank} className="p-5 space-y-4">
                            {/* Ownership Category */}
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Ownership Category *</label>
                                <Select
                                    value={ownershipType}
                                    onChange={e => setOwnershipType(e.target.value as 'company' | 'personal' | '')}
                                    required
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                >
                                    <option value="">Choose Category *</option>
                                    <option value="company">Company Account (A/C Payee)</option>
                                    <option value="personal">Personal Account (Manager/Owner)</option>
                                </Select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Bank Name *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. NIC Asia Bank, Nabil Bank"
                                    value={newBankName}
                                    onChange={e => setNewBankName(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Bank Account Number *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 123456789012"
                                    value={newBankAccountNumber}
                                    onChange={e => setNewBankAccountNumber(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Display Label (Optional)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. NIC Asia - Main Account"
                                    value={newBankDisplayName}
                                    onChange={e => setNewBankDisplayName(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submittingBank}
                                className="w-full mt-2 py-3 bg-brand-500 hover:bg-[#e04f00] text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-md shadow-brand-500/15 flex items-center justify-center gap-2 focus-ring disabled:opacity-50"
                            >
                                {submittingBank ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Register Bank Account
                            </button>
                        </form>
                </Modal>
            )}

            {/* Opening Balance Modal */}
            {obModalOpen && activeBankAccount && (
                <Modal open onClose={() => setObModalOpen(false)} size="md" ariaLabel={isObEdit ? "Edit Opening Balance" : "Add Opening Balance"} className="bg-surface overflow-hidden">
                    <div className="p-5 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                        <div>
                            <h3 className="font-extrabold text-ink text-sm flex items-center gap-2">
                                {isObEdit ? <Edit2 size={16} className="text-amber-500" /> : <Plus size={16} className="text-emerald-500" />}
                                {isObEdit ? `Edit Opening Balance for ${activeBankAccount.name}` : `Add Opening Balance for ${activeBankAccount.name}`}
                            </h3>
                            <p className="text-[10px] text-ink-subtle mt-0.5">
                                {isObEdit ? 'A reason is required before editing an existing opening balance.' : 'Set the initial balance for this bank account.'}
                            </p>
                        </div>
                        <button 
                            onClick={() => setObModalOpen(false)}
                            className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink-subtle transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    
                    <form onSubmit={handleSaveOpeningBalance} className="p-5 space-y-4">
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Opening Balance Amount (Rs.) *</label>
                            <input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={obAmount}
                                onChange={e => setObAmount(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                {isObEdit ? 'Reason for Editing *' : 'Note / Reference (Optional)'}
                            </label>
                            <textarea
                                placeholder={isObEdit ? 'State the reason for modifying the opening balance...' : 'e.g. Initial bank deposit'}
                                value={obReason}
                                onChange={e => setObReason(e.target.value)}
                                required={isObEdit}
                                rows={3}
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-semibold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            />
                            {isObEdit && (
                                <p className="text-[10px] text-amber-600 font-semibold flex items-center gap-1 mt-1">
                                    <ShieldAlert size={12} /> This reason will be permanently recorded in the Manager Activities Log.
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={submittingOb}
                            className={`w-full mt-2 py-3 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-md flex items-center justify-center gap-2 focus-ring disabled:opacity-50 ${
                                isObEdit ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/15' : 'bg-brand-500 hover:bg-[#e04f00] shadow-brand-500/15'
                            }`}
                        >
                            {submittingOb ? <Loader2 size={16} className="animate-spin" /> : isObEdit ? <Edit2 size={16} /> : <Plus size={16} />}
                            {isObEdit ? 'Save Changes with Reason' : 'Save Opening Balance'}
                        </button>
                    </form>
                </Modal>
            )}

            {activeBankAccount && (
                <PrintableReport
                    ref={printRef}
                    title={`Bank Ledger — ${activeBankAccount.name}`}
                    subtitle={`Account No: ${activeBankAccount.account_number || 'N/A'} | Bank: ${activeBankAccount.bank_name || 'N/A'}`}
                    columns={reportColumns}
                    rows={reportRows}
                />
            )}
        </div>
    )
}
