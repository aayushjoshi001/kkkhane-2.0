'use client'

import { useState, useMemo } from 'react'
import {
    Landmark, ArrowRightLeft, TrendingUp, TrendingDown, FileText, LandmarkIcon,
    Plus, X, Loader2
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { createBankAccountAction } from '../bank-book/actions'
import { toast } from 'react-hot-toast'

interface BankAccount {
    id: string
    name: string
    bank_name: string | null
    account_number: string | null
    opening_balance: number
    is_active: boolean
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
    other:           'bg-gray-100 text-gray-600 border-gray-200',
}

export default function BankLedgerManager({
    bankAccounts,
    bankEntries
}: BankLedgerManagerProps) {
    const [bankAccountsList, setBankAccountsList] = useState<BankAccount[]>(bankAccounts)
    const [selectedBankId, setSelectedBankId] = useState<string | null>(
        bankAccounts.length > 0 ? bankAccounts[0].id : null
    )
    const [timeFilter, setTimeFilter] = useState<'this_month' | 'this_year' | 'all'>('this_month')

    // Add Bank Modal state
    const [addBankModalOpen, setAddBankModalOpen] = useState(false)
    const [newBankName, setNewBankName] = useState('')
    const [newBankAccountNumber, setNewBankAccountNumber] = useState('')
    const [newBankDisplayName, setNewBankDisplayName] = useState('')
    const [submittingBank, setSubmittingBank] = useState(false)

    const handleAddBank = async (e: React.FormEvent) => {
        e.preventDefault()
        const bName = newBankName.trim()
        const accNum = newBankAccountNumber.trim()
        const dispName = newBankDisplayName.trim() || bName

        if (!bName) { toast.error('Bank Name is required'); return }
        if (!accNum) { toast.error('Account Number is required'); return }

        setSubmittingBank(true)
        try {
            const res = await createBankAccountAction({
                bank_name: bName,
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

        // 3. Sort ascending (oldest first) to compute running balance correctly
        const sorted = [...filtered].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        let runningBal = Number(activeBankAccount.opening_balance)
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

        // Reverse to display newest first
        return entriesWithBalance.reverse()
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
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Bank Ledger</h1>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Select bank account to analyze detailed statements, running balances, and cash deposits.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAddBankModalOpen(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#e04f00] text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-brand-500/10 focus-ring"
                    >
                        <Plus size={15} /> Add Bank
                    </button>
                </div>
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left Side: Bank Account directory list */}
                <div className="lg:col-span-4 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                        <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Bank Accounts ({bankAccountsWithBalances.length})</p>
                    </div>
                    
                    <div className="divide-y divide-gray-100">
                        {bankAccountsWithBalances.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">
                                <LandmarkIcon size={30} className="mx-auto mb-2 opacity-30" />
                                <p className="text-xs font-bold">No registered bank accounts</p>
                                <p className="text-[10px] text-gray-400 mt-1 px-4 leading-relaxed">
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
                                            isSelected ? 'bg-brand-50/20 border-l-4 border-brand-500 pl-3' : 'bg-white hover:bg-gray-50/50'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="font-extrabold text-sm text-gray-900 truncate">{b.name}</p>
                                            <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
                                                {b.bank_name || 'Bank'} • {b.account_number || 'N/A'}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-xs font-black text-gray-900">{formatCurrency(b.currentBalance)}</p>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase mt-0.5">Balance</p>
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
                            <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                    <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Statement Ledger</span>
                                    <h3 className="text-lg font-extrabold text-gray-900 mt-0.5">{activeBankAccount.name}</h3>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        Account No: {activeBankAccount.account_number || 'N/A'} | Bank: {activeBankAccount.bank_name || 'N/A'}
                                    </p>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-400 whitespace-nowrap">Filter:</span>
                                    <div className="flex bg-gray-50 border border-gray-200 rounded-xl p-1 shrink-0">
                                        {(['this_month', 'this_year', 'all'] as const).map(f => {
                                            const labels = { this_month: 'This Month', this_year: 'This Year', all: 'All Time' }
                                            const active = timeFilter === f
                                            return (
                                                <button
                                                    key={f}
                                                    onClick={() => setTimeFilter(f)}
                                                    className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all focus:outline-none ${
                                                        active ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'
                                                    }`}
                                                >
                                                    {labels[f]}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Summary Metrics Row */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                                        <TrendingUp size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Deposits / Inward</p>
                                        <p className="text-base font-black text-emerald-600 mt-0.5">{formatCurrency(stats.deposited)}</p>
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shrink-0">
                                        <ArrowRightLeft size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cash-to-Bank Transfers</p>
                                        <p className="text-base font-black text-amber-700 mt-0.5">{formatCurrency(stats.cashTransfers)}</p>
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                                        <TrendingDown size={18} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Withdrawals / Outward</p>
                                        <p className="text-base font-black text-rose-600 mt-0.5">{formatCurrency(stats.withdrawn)}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Detailed Statement Table */}
                            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                                    <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Account Statement Transactions ({activeBankEntries.length})</p>
                                </div>

                                <div className="overflow-x-auto">
                                    {activeBankEntries.length === 0 ? (
                                        <div className="text-center py-20 px-4 text-gray-400">
                                            <FileText size={36} className="mx-auto mb-2 opacity-30" />
                                            <p className="text-xs font-bold">No transactions found for this period</p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="bg-gray-55 border-b border-gray-100 text-gray-500">
                                                    <th className="px-4 py-3 font-bold w-24">Date</th>
                                                    <th className="px-4 py-3 font-bold">Description</th>
                                                    <th className="px-4 py-3 font-bold text-right w-28">Bank In</th>
                                                    <th className="px-4 py-3 font-bold text-right w-28">Bank Out</th>
                                                    <th className="px-4 py-3 font-bold text-center w-20">Type</th>
                                                    <th className="px-4 py-3 font-bold text-center w-28">Category</th>
                                                    <th className="px-4 py-3 font-bold text-right w-28 bg-gray-50/50">Running Balance</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {activeBankEntries.map(e => (
                                                    <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                                                        {/* Date */}
                                                        <td className="px-4 py-3 text-gray-500 font-semibold whitespace-nowrap">
                                                            {new Date(e.day_book_sessions?.date || e.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </td>
                                                        {/* Description */}
                                                        <td className="px-4 py-3 font-bold text-gray-800">{e.description}</td>
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
                                                                CATEGORY_COLORS[e.category] || 'bg-gray-50 text-gray-600 border-gray-150'
                                                            }`}>
                                                                {CATEGORY_LABELS[e.category] || e.category}
                                                            </span>
                                                        </td>
                                                        {/* Running Balance */}
                                                        <td className="px-4 py-3 text-right font-black bg-gray-50/30 text-gray-900">
                                                            {formatCurrency(e.runningBalance)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                                
                                {activeBankAccountWithBalance && (
                                    <div className="bg-brand-50/5 border-t border-gray-100 p-4 flex items-center justify-between">
                                        <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Total Amount Left in {activeBankAccountWithBalance.name}:</span>
                                        <span className="text-base font-black text-[#ff5a00]">{formatCurrency(activeBankAccountWithBalance.currentBalance)}</span>
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="bg-white border border-gray-100 rounded-2xl py-20 text-center text-gray-400">
                            <Landmark size={44} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-bold">Select a bank account from the directory to view statement</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Add Bank Modal */}
            {addBankModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-[#0a0a0a]/60 backdrop-blur-md transition-opacity duration-300"
                        onClick={() => setAddBankModalOpen(false)}
                    />
                    
                    {/* Modal Box */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-2xl w-full max-w-md relative z-10 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-200">
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div>
                                <h3 className="font-extrabold text-gray-900 text-sm">Register New Bank Account</h3>
                                <p className="text-[10px] text-gray-400 mt-0.5">Add to your active bank directories</p>
                            </div>
                            <button 
                                onClick={() => setAddBankModalOpen(false)}
                                className="p-1.5 hover:bg-gray-150 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleAddBank} className="p-5 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank Name *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. NIC Asia Bank, Nabil Bank"
                                    value={newBankName}
                                    onChange={e => setNewBankName(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank Account Number *</label>
                                <input
                                    type="text"
                                    placeholder="e.g. 123456789012"
                                    value={newBankAccountNumber}
                                    onChange={e => setNewBankAccountNumber(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Display Label (Optional)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. NIC Asia - Main Account"
                                    value={newBankDisplayName}
                                    onChange={e => setNewBankDisplayName(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={submittingBank}
                                className="w-full mt-2 py-3 bg-[#ff5a00] hover:bg-[#e04f00] text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-md shadow-brand-500/15 flex items-center justify-center gap-2 focus-ring disabled:opacity-50"
                            >
                                {submittingBank ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Register Bank Account
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
