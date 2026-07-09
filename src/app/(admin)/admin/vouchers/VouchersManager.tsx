'use client'

import { useState, useMemo } from 'react'
import {
    FileText, Plus, Search, Trash2, Printer, X, Loader2, ArrowUpRight, ArrowDownRight, RefreshCw
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { createVoucherAction, deleteVoucherAction } from './actions'
import { toast } from 'react-hot-toast'

interface BankAccount {
    id: string
    name: string
    bank_name: string | null
    account_number: string | null
}

interface RawVoucherEntry {
    id: string
    session_id: string
    type: 'cash_in' | 'cash_out' | 'bank_in' | 'bank_out'
    amount: number
    description: string
    category: string
    created_at: string
    bank_name: string | null
    day_book_sessions?: {
        date: string
    } | null
}

interface ParsedVoucher {
    id: string
    session_id: string
    type: 'cash_in' | 'cash_out' | 'bank_in' | 'bank_out'
    amount: number
    created_at: string
    date: string
    // Parsed JSON fields
    voucher_type: 'receipt' | 'payment'
    voucher_number: string
    party_name: string
    particulars: string
    payment_mode: 'cash' | 'bank'
    bank_name: string
    reference_no: string
}

interface VouchersManagerProps {
    bankAccounts: BankAccount[]
    initialEntries: RawVoucherEntry[]
}

function amountInWords(amount: number): string {
    const num = Math.floor(amount)
    if (num === 0) return 'Zero Rupees Only'
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
    
    function helper(n: number): string {
        if (n < 20) return ones[n]
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '')
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + helper(n % 100) : '')
        if (n < 100000) return helper(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + helper(n % 1000) : '')
        if (n < 10000000) return helper(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + helper(n % 100000) : '')
        return helper(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + helper(n % 10000000) : '')
    }
    
    return helper(num) + ' Rupees Only'
}

export default function VouchersManager({
    bankAccounts,
    initialEntries
}: VouchersManagerProps) {
    const [entriesList, setEntriesList] = useState<RawVoucherEntry[]>(initialEntries)

    // Form Modal states
    const [createModalOpen, setCreateModalOpen] = useState(false)
    const [voucherType, setVoucherType] = useState<'receipt' | 'payment'>('receipt')
    const [partyName, setPartyName] = useState('')
    const [amount, setAmount] = useState('')
    const [paymentMode, setPaymentMode] = useState<'cash' | 'bank'>('cash')
    const [bankName, setBankName] = useState('')
    const [particulars, setParticulars] = useState('')
    const [referenceNo, setReferenceNo] = useState('')
    const [saving, setSaving] = useState(false)

    // Print Modal states
    const [printVoucher, setPrintVoucher] = useState<ParsedVoucher | null>(null)

    // Filters state
    const [searchQuery, setSearchQuery] = useState('')
    const [filterType, setFilterType] = useState<'all' | 'receipt' | 'payment'>('all')
    const [filterMode, setFilterMode] = useState<'all' | 'cash' | 'bank'>('all')

    // Parse description JSON reactively
    const parsedVouchers = useMemo((): ParsedVoucher[] => {
        return entriesList.map(e => {
            let parsed = {
                voucher_type: 'receipt' as const,
                voucher_number: 'N/A',
                party_name: 'N/A',
                particulars: e.description,
                payment_mode: 'cash' as const,
                bank_name: '',
                reference_no: ''
            }
            try {
                if (e.description.startsWith('{')) {
                    parsed = JSON.parse(e.description)
                }
            } catch {
                // Fallback for non-json
            }
            return {
                id: e.id,
                session_id: e.session_id,
                type: e.type,
                amount: Number(e.amount),
                created_at: e.created_at,
                date: e.day_book_sessions?.date || e.created_at.split('T')[0],
                ...parsed
            }
        })
    }, [entriesList])

    // Filtered Vouchers list
    const filteredVouchers = useMemo(() => {
        return parsedVouchers.filter(v => {
            const q = searchQuery.toLowerCase().trim()
            const matchSearch = q === '' ||
                v.voucher_number.toLowerCase().includes(q) ||
                v.party_name.toLowerCase().includes(q) ||
                v.particulars.toLowerCase().includes(q) ||
                v.reference_no.toLowerCase().includes(q)

            const matchType = filterType === 'all' || v.voucher_type === filterType
            const matchMode = filterMode === 'all' || v.payment_mode === filterMode

            return matchSearch && matchType && matchMode
        })
    }, [parsedVouchers, searchQuery, filterType, filterMode])

    // Summary calculations
    const stats = useMemo(() => {
        const totalReceipts = parsedVouchers
            .filter(v => v.voucher_type === 'receipt')
            .reduce((s, v) => s + v.amount, 0)

        const totalPayments = parsedVouchers
            .filter(v => v.voucher_type === 'payment')
            .reduce((s, v) => s + v.amount, 0)

        return {
            receipts: totalReceipts,
            payments: totalPayments,
            net: totalReceipts - totalPayments
        }
    }, [parsedVouchers])

    // Submit handler
    const handleCreateVoucher = async (e: React.FormEvent) => {
        e.preventDefault()
        const amt = parseFloat(amount)
        if (isNaN(amt) || amt <= 0) {
            toast.error('Please enter a valid amount greater than zero')
            return
        }

        if (paymentMode === 'bank' && bankAccounts.length > 0 && !bankName) {
            toast.error('Please select a bank account')
            return
        }

        setSaving(true)
        try {
            const res = await createVoucherAction({
                voucher_type: voucherType,
                party_name: partyName,
                amount: amt,
                payment_mode: paymentMode,
                bank_name: paymentMode === 'bank' ? (bankName || 'General Bank') : undefined,
                particulars: particulars,
                reference_no: referenceNo
            })

            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                setEntriesList(prev => [res.data, ...prev])
                setPartyName('')
                setAmount('')
                setParticulars('')
                setReferenceNo('')
                setCreateModalOpen(false)
                toast.success('Voucher created successfully!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create voucher')
        } finally {
            setSaving(false)
        }
    }

    // Delete handler
    const handleDeleteVoucher = async (id: string, number: string) => {
        if (!confirm(`Are you sure you want to delete/void voucher ${number}? This will reverse its Cash/Bank book entry.`)) return

        try {
            const res = await deleteVoucherAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                setEntriesList(prev => prev.filter(e => e.id !== id))
                toast.success(`Voucher ${number} deleted successfully!`)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete voucher')
        }
    }

    const handlePrint = () => {
        window.print()
    }

    return (
        <div className="space-y-6 pb-16 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
                            <FileText size={20} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Receipt & Payment Vouchers</h1>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Log business receipt/payment vouchers to auto-update Cash Books & Bank Ledgers.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => { setVoucherType('receipt'); setPaymentMode('cash'); setCreateModalOpen(true); }}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-500/10 focus-ring"
                    >
                        <Plus size={15} /> Receipt Voucher (In)
                    </button>
                    <button
                        onClick={() => { setVoucherType('payment'); setPaymentMode('cash'); setCreateModalOpen(true); }}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-rose-500/10 focus-ring"
                    >
                        <Plus size={15} /> Payment Voucher (Out)
                    </button>
                </div>
            </div>

            {/* Stats calculated boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                        <ArrowUpRight size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Receipts</p>
                        <p className="text-base font-black text-emerald-600 mt-0.5">{formatCurrency(stats.receipts)}</p>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                        <ArrowDownRight size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Payments</p>
                        <p className="text-base font-black text-rose-600 mt-0.5">{formatCurrency(stats.payments)}</p>
                    </div>
                </div>

                <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${stats.net >= 0 ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                        <RefreshCw size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Net Cash Flow</p>
                        <p className={`text-base font-black mt-0.5 ${stats.net >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>{stats.net >= 0 ? '+' : ''}{formatCurrency(stats.net)}</p>
                    </div>
                </div>
            </div>

            {/* List and Filter controls */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="font-extrabold text-gray-900 text-sm">Voucher Log History</h3>
                        <p className="text-[10px] text-gray-400 mt-0.5">Chronological record of business payouts and receipts</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                        <select
                            value={filterType}
                            onChange={e => setFilterType(e.target.value as typeof filterType)}
                            className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                        >
                            <option value="all">All Types</option>
                            <option value="receipt">Receipts (RV)</option>
                            <option value="payment">Payments (PV)</option>
                        </select>

                        <select
                            value={filterMode}
                            onChange={e => setFilterMode(e.target.value as typeof filterMode)}
                            className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                        >
                            <option value="all">All Modes</option>
                            <option value="cash">Cash Only</option>
                            <option value="bank">Bank Only</option>
                        </select>

                        <div className="relative w-full sm:w-60">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search party, voucher no..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    {filteredVouchers.length === 0 ? (
                        <div className="text-center py-20 text-gray-400">
                            <FileText size={44} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-bold">No voucher logs found</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
                                    <th className="px-5 py-3 font-bold w-28">Date</th>
                                    <th className="px-5 py-3 font-bold w-32">Voucher No</th>
                                    <th className="px-5 py-3 font-bold w-24">Type</th>
                                    <th className="px-5 py-3 font-bold w-48">Party Name</th>
                                    <th className="px-5 py-3 font-bold w-28">Mode</th>
                                    <th className="px-5 py-3 font-bold text-right w-32">Amount</th>
                                    <th className="px-5 py-3 font-bold">Particulars</th>
                                    <th className="px-5 py-3 font-bold text-center w-28">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredVouchers.map(v => (
                                    <tr key={v.id} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-5 py-4 text-gray-500 font-semibold whitespace-nowrap">
                                            {new Date(v.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </td>
                                        <td className="px-5 py-4 font-extrabold text-gray-800 whitespace-nowrap">{v.voucher_number}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase ${
                                                v.voucher_type === 'receipt' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                            }`}>
                                                {v.voucher_type === 'receipt' ? 'Receipt' : 'Payment'}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 font-bold text-gray-800 truncate max-w-[180px]" title={v.party_name}>
                                            {v.party_name}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase ${
                                                v.payment_mode === 'bank' ? 'bg-indigo-50 border border-indigo-100 text-indigo-700' : 'bg-amber-50 border border-amber-100 text-amber-700'
                                            }`}>
                                                {v.payment_mode === 'bank' ? v.bank_name : 'Cash'}
                                            </span>
                                        </td>
                                        <td className={`px-5 py-4 text-right font-black text-xs ${v.voucher_type === 'receipt' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {v.voucher_type === 'receipt' ? '+' : '-'}{formatCurrency(v.amount)}
                                        </td>
                                        <td className="px-5 py-4 font-bold text-gray-500 max-w-[200px] truncate" title={v.particulars}>{v.particulars}</td>
                                        <td className="px-5 py-4 text-center whitespace-nowrap">
                                            <div className="inline-flex gap-2">
                                                <button
                                                    onClick={() => setPrintVoucher(v)}
                                                    className="p-1.5 hover:bg-indigo-50 hover:text-indigo-600 border border-transparent hover:border-indigo-100 rounded-lg text-gray-400 transition-all focus-ring"
                                                    title="View / Print Slip"
                                                >
                                                    <Printer size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteVoucher(v.id, v.voucher_number)}
                                                    className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100 rounded-lg text-gray-400 transition-all focus-ring"
                                                    title="Delete / Void"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Create Voucher Modal */}
            {createModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div 
                        className="fixed inset-0 bg-[#0a0a0a]/60 backdrop-blur-md transition-opacity duration-300"
                        onClick={() => setCreateModalOpen(false)}
                    />
                    
                    <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl w-full max-w-md relative z-10 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-200">
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div>
                                <h3 className="font-extrabold text-gray-900 text-sm">
                                    Create New {voucherType === 'receipt' ? 'Receipt' : 'Payment'} Voucher
                                </h3>
                                <p className="text-[10px] text-gray-400 mt-0.5">Logs money {voucherType === 'receipt' ? 'inward' : 'outward'} transaction</p>
                            </div>
                            <button 
                                onClick={() => setCreateModalOpen(false)}
                                className="p-1.5 hover:bg-gray-150 rounded-xl text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleCreateVoucher} className="p-5 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                    {voucherType === 'receipt' ? 'Received From *' : 'Paid To *'}
                                </label>
                                <input
                                    type="text"
                                    placeholder={voucherType === 'receipt' ? "e.g. Ram Prasad, Partner Investment" : "e.g. Supplier name, Landlord rent"}
                                    value={partyName}
                                    onChange={e => setPartyName(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Amount (Rupees) *</label>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Payment Mode</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setPaymentMode('cash'); setBankName(''); }}
                                        className={`py-2 rounded-xl text-xs font-bold border transition ${paymentMode === 'cash' ? 'bg-brand-50 border-brand-500 text-brand-600 shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        Cash Drawer
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPaymentMode('bank')}
                                        className={`py-2 rounded-xl text-xs font-bold border transition ${paymentMode === 'bank' ? 'bg-brand-50 border-brand-500 text-brand-600 shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        Bank Book
                                    </button>
                                </div>
                            </div>

                            {paymentMode === 'bank' && (
                                <div className="animate-in slide-in-from-top-1 duration-150">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Select Bank Account *</label>
                                    <select
                                        value={bankName}
                                        onChange={e => setBankName(e.target.value)}
                                        required
                                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    >
                                        <option value="">Select Bank Account</option>
                                        {bankAccounts.map(b => (
                                            <option key={b.id} value={b.name}>{b.name} ({b.account_number})</option>
                                        ))}
                                        {bankAccounts.length === 0 && (
                                            <option value="General Bank">General Bank</option>
                                        )}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Particulars / Description *</label>
                                <textarea
                                    placeholder="Details of the payment or receipt..."
                                    value={particulars}
                                    onChange={e => setParticulars(e.target.value)}
                                    required
                                    rows={3}
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Reference No / Document No (Optional)</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Check No, Transfer Reference"
                                    value={referenceNo}
                                    onChange={e => setReferenceNo(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={saving}
                                className={`w-full mt-2 py-3 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-colors shadow-md flex items-center justify-center gap-2 focus-ring disabled:opacity-50 ${
                                    voucherType === 'receipt' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/10' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/10'
                                }`}
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                Issue {voucherType === 'receipt' ? 'Receipt' : 'Payment'} Voucher
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Printable Voucher Slip Modal (Real-world thermal/A4 slip format) */}
            {printVoucher && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:p-0 print:absolute print:inset-0">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-[#0a0a0a]/60 backdrop-blur-md transition-opacity duration-300 print:hidden"
                        onClick={() => setPrintVoucher(null)}
                    />

                    {/* Modal Box */}
                    <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl w-full max-w-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] print:max-h-none print:w-full print:border-none print:shadow-none print:static">
                        
                        {/* Modal controls header */}
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 print:hidden shrink-0">
                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Voucher Print Preview</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={handlePrint}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition shadow-md shadow-brand-500/10 focus-ring"
                                >
                                    <Printer size={13} /> Print Slip
                                </button>
                                <button
                                    onClick={() => setPrintVoucher(null)}
                                    className="p-1.5 hover:bg-gray-150 rounded-xl text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Slip print target page layout */}
                        <div className="flex-1 overflow-y-auto p-8 print:p-0 print:overflow-visible">
                            <div className="border border-gray-300 p-6 rounded-xl font-mono text-xs text-gray-800 space-y-6 print:border-none print:p-0 print:rounded-none">
                                
                                {/* Header */}
                                <div className="text-center border-b border-dashed border-gray-300 pb-4">
                                    <h2 className="text-lg font-black tracking-tight text-gray-900">KKKHANE RESTAURANT</h2>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-0.5">Workspace Account Voucher</p>
                                </div>

                                {/* Title Banner */}
                                <div className="text-center py-1.5 bg-gray-100 border border-gray-200 rounded-lg">
                                    <h3 className="text-sm font-black tracking-widest text-gray-900 uppercase">
                                        {printVoucher.voucher_type === 'receipt' ? 'RECEIPT VOUCHER' : 'PAYMENT VOUCHER'}
                                    </h3>
                                </div>

                                {/* Info grid */}
                                <div className="grid grid-cols-2 gap-y-2 border-b border-dashed border-gray-300 pb-4 text-[11px]">
                                    <div>
                                        <span className="font-bold text-gray-400 uppercase">Voucher No:</span>{' '}
                                        <span className="font-black text-gray-900">{printVoucher.voucher_number}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="font-bold text-gray-400 uppercase">Date:</span>{' '}
                                        <span className="font-black text-gray-900">
                                            {new Date(printVoucher.date).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-gray-400 uppercase">
                                            {printVoucher.voucher_type === 'receipt' ? 'Received From:' : 'Paid To:'}
                                        </span>{' '}
                                        <span className="font-black text-gray-900 uppercase">{printVoucher.party_name}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="font-bold text-gray-400 uppercase">Payment Mode:</span>{' '}
                                        <span className="font-black text-gray-900 uppercase">
                                            {printVoucher.payment_mode === 'bank' ? `BANK (${printVoucher.bank_name})` : 'CASH'}
                                        </span>
                                    </div>
                                    {printVoucher.reference_no && (
                                        <div className="col-span-2">
                                            <span className="font-bold text-gray-400 uppercase">Ref / Document No:</span>{' '}
                                            <span className="font-black text-gray-900">{printVoucher.reference_no}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Details / Particulars Table */}
                                <div className="space-y-2">
                                    <table className="w-full text-left text-[11px] border-collapse">
                                        <thead>
                                            <tr className="border-b border-gray-300 text-gray-500 font-bold uppercase">
                                                <th className="py-2 w-12 text-center">S.N.</th>
                                                <th className="py-2">Particulars / Description</th>
                                                <th className="py-2 text-right w-36">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="border-b border-dashed border-gray-200">
                                                <td className="py-3 text-center font-bold">1.</td>
                                                <td className="py-3 font-semibold leading-relaxed">{printVoucher.particulars}</td>
                                                <td className="py-3 text-right font-black text-gray-900">{formatCurrency(printVoucher.amount)}</td>
                                            </tr>
                                            <tr className="font-black text-gray-900">
                                                <td colSpan={2} className="py-3 text-right uppercase text-[10px] text-gray-400">Total Amount:</td>
                                                <td className="py-3 text-right text-base border-double border-b-4 border-gray-400">
                                                    {formatCurrency(printVoucher.amount)}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Sum in Words */}
                                <div className="p-3 bg-gray-50 border border-gray-150 rounded-lg text-[11px] flex gap-2">
                                    <span className="font-bold text-gray-400 uppercase shrink-0">Sum In Words:</span>
                                    <span className="font-black text-gray-800 italic capitalize">{amountInWords(printVoucher.amount)}</span>
                                </div>

                                {/* Signatures grid */}
                                <div className="grid grid-cols-3 gap-6 pt-16 text-center text-[10px] font-bold text-gray-400 uppercase">
                                    <div className="space-y-1">
                                        <div className="border-t border-gray-300 pt-2 text-gray-800 font-black">Prepared By</div>
                                        <div>Cashier / Accountant</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="border-t border-gray-300 pt-2 text-gray-800 font-black">Approved By</div>
                                        <div>Manager / Owner</div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="border-t border-gray-300 pt-2 text-gray-800 font-black">
                                            {printVoucher.voucher_type === 'receipt' ? 'Paid By' : 'Received By'}
                                        </div>
                                        <div>Receiver Signature</div>
                                    </div>
                                </div>

                            </div>
                        </div>

                    </div>
                </div>
            )}
        </div>
    )
}
