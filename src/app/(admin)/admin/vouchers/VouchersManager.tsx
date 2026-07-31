'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
    FileText, Plus, Search, Trash2, Printer, X, Loader2, ArrowUpRight, ArrowDownRight, RefreshCw, Check, AlertCircle, Download
} from 'lucide-react'
import { formatCurrency, parseBankAccountOwnership, chequeTypeForBankAccount } from '@/lib/utils'
import { createVoucherAction, deleteVoucherAction, approveChequeAction, rejectChequeAction, openTodayDayBookSessionAction, getSupplierOutstandingBalanceAction, getStaffCurrentDueAction } from './actions'
import { toast } from 'react-hot-toast'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import VoucherPrintSlip from '@/components/admin/VoucherPrintSlip'
import { useDateFormatter, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

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
    payment_mode: 'cash' | 'qr' | 'cheque' | 'bank'
    bank_name: string
    reference_no: string
    receiver_name: string
    status: 'approved' | 'pending_approval' | 'rejected'
    category: 'suppliers' | 'staff' | 'expenses' | 'other'
    supplier_id?: string
    staff_user_id?: string
    cheque_details?: {
        written_name: string
        bank_cheque: string // Issuer Bank
        cheque_number: string
        cheque_date: string
        cheque_type: 'ac_payee' | 'normal'
    }
}

interface VouchersManagerProps {
    bankAccounts: BankAccount[]
    initialEntries: RawVoucherEntry[]
    suppliers: { id: string; name: string }[]
    staffList: { id: string; full_name: string }[]
    hasOpenSession: boolean
}

export default function VouchersManager({
    bankAccounts,
    initialEntries,
    suppliers,
    staffList,
    hasOpenSession
}: VouchersManagerProps) {
    const { confirm } = useConfirmStore()
    const [entriesList, setEntriesList] = useState<RawVoucherEntry[]>(initialEntries)
    const formatDate = useDateFormatter()

    // Session opening states
    const [openingSession, setOpeningSession] = useState(false)
    const [sessionOpenState, setSessionOpenState] = useState(hasOpenSession)

    const handleOpenSession = async () => {
        setOpeningSession(true)
        try {
            const res = await openTodayDayBookSessionAction()
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success("Day Book session opened successfully!")
                setSessionOpenState(true)
                window.location.reload()
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to open session")
        } finally {
            setOpeningSession(false)
        }
    }

    // Form Modal states
    const [createModalOpen, setCreateModalOpen] = useState(false)
    const [voucherType, setVoucherType] = useState<'receipt' | 'payment'>('receipt')
    const [partyName, setPartyName] = useState('')
    const [amount, setAmount] = useState('')
    const [paymentMode, setPaymentMode] = useState<'cash' | 'qr' | 'cheque'>('cash')
    const [bankName, setBankName] = useState('') // Destination / Source Bank
    const [particulars, setParticulars] = useState('')
    const [referenceNo, setReferenceNo] = useState('') // Payer phone
    const [receiverName, setReceiverName] = useState('')
    const [saving, setSaving] = useState(false)

    // Category and specific targets for Payments
    const [payoutCategory, setPayoutCategory] = useState<'suppliers' | 'staff' | 'expenses' | 'other'>('other')
    const [selectedSupplierId, setSelectedSupplierId] = useState('')
    const [selectedStaffUserId, setSelectedStaffUserId] = useState('')
    // Salary Payout is capped at the staff member's current due; Advance
    // Payment and Bonus are not (paid before due, or discretionary).
    const [staffEntryType, setStaffEntryType] = useState<'salary_payout' | 'advance_payment' | 'bonus'>('salary_payout')

    const [supplierDue, setSupplierDue] = useState<number | null>(null)
    const [staffDue, setStaffDue] = useState<number | null>(null)
    const [loadingDue, setLoadingDue] = useState(false)

    useEffect(() => {
        if (!selectedSupplierId || payoutCategory !== 'suppliers') {
            setSupplierDue(null)
            return
        }
        setLoadingDue(true)
        getSupplierOutstandingBalanceAction(selectedSupplierId)
            .then(res => {
                if (res.data !== undefined) setSupplierDue(res.data)
            })
            .catch(() => {})
            .finally(() => setLoadingDue(false))
    }, [selectedSupplierId, payoutCategory])

    useEffect(() => {
        if (!selectedStaffUserId || payoutCategory !== 'staff') {
            setStaffDue(null)
            return
        }
        setLoadingDue(true)
        getStaffCurrentDueAction(selectedStaffUserId)
            .then(res => {
                if (res.data !== undefined) setStaffDue(res.data)
            })
            .catch(() => {})
            .finally(() => setLoadingDue(false))
    }, [selectedStaffUserId, payoutCategory])

    // Cheque specific form fields
    const [chequeWrittenName, setChequeWrittenName] = useState('')
    const [chequeBank, setChequeBank] = useState('')
    const [chequeNumber, setChequeNumber] = useState('')
    const [chequeDate, setChequeDate] = useState('')
    const [chequeType, setChequeType] = useState<'ac_payee' | 'normal'>('ac_payee')

    // Print Modal states
    const [printVoucher, setPrintVoucher] = useState<ParsedVoucher | null>(null)

    // View tab state
    const [activeTab, setActiveTab] = useState<'vouchers' | 'approvals'>('vouchers')

    // Filters state
    const [searchQuery, setSearchQuery] = useState('')
    const [filterType, setFilterType] = useState<'all' | 'receipt' | 'payment'>('all')
    const [filterMode, setFilterMode] = useState<'all' | 'cash' | 'qr' | 'cheque'>('all')

    // Pending approvals action state
    const [actioningId, setActioningId] = useState<string | null>(null)

    // Delete-voucher reason prompt
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; number: string } | null>(null)
    const [deleteReason, setDeleteReason] = useState('')
    const [deleting, setDeleting] = useState(false)

    // Parse bank account ownership labels reactively
    const parsedBankAccounts = useMemo(() => {
        return bankAccounts.map(b => {
            const { ownership, displayName } = parseBankAccountOwnership(b.bank_name)
            return {
                ...b,
                ownership: ownership ?? 'company',
                displayName
            }
        })
    }, [bankAccounts])

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
                reference_no: '',
                receiver_name: '',
                status: 'approved' as const,
                amount: Number(e.amount),
                category: 'other' as const,
                supplier_id: '',
                staff_user_id: '',
                cheque_details: undefined
            }
            try {
                if (e.description.startsWith('{')) {
                    const data = JSON.parse(e.description)
                    parsed = { ...parsed, ...data }
                }
            } catch {
                // Fallback for non-json
            }
            return {
                id: e.id,
                session_id: e.session_id,
                type: e.type,
                created_at: e.created_at,
                date: e.day_book_sessions?.date || e.created_at.split('T')[0],
                ...parsed,
                amount: parsed.amount
            }
        })
    }, [entriesList])

    // Filtered Vouchers list
    const filteredVouchers = useMemo(() => {
        return parsedVouchers.filter(v => {
            if (activeTab === 'vouchers') {
                if (v.status === 'pending_approval') return false
            } else {
                if (v.status !== 'pending_approval') return false
            }

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
    }, [parsedVouchers, searchQuery, filterType, filterMode, activeTab])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'voucher_number', label: 'Voucher No' },
        { key: 'type', label: 'Type' },
        { key: 'party_name', label: 'Party Name' },
        { key: 'mode', label: 'Mode' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'particulars', label: 'Particulars' },
    ]
    const reportRows = filteredVouchers.map(v => ({
        date: formatDate(v.date),
        voucher_number: v.voucher_number,
        type: v.voucher_type === 'receipt' ? 'Receipt' : 'Payment',
        party_name: v.party_name,
        mode: v.payment_mode === 'cash' ? 'Cash' : v.payment_mode === 'qr' ? `QR (${v.bank_name})` : v.payment_mode === 'cheque' ? `Cheque (${v.bank_name})` : v.bank_name,
        amount: (v.voucher_type === 'receipt' ? '+' : '-') + formatCurrency(v.amount),
        particulars: v.payment_mode === 'cheque' && v.cheque_details ? `No: ${v.cheque_details.cheque_number} (${v.cheque_details.bank_cheque})` : v.particulars,
    }))
    const handleExportCsv = () => downloadCsv(`vouchers-ledger-${activeTab}`, reportColumns, reportRows)

    // Summary calculations
    const stats = useMemo(() => {
        const approvedVouchers = parsedVouchers.filter(v => v.status === 'approved')

        const totalReceipts = approvedVouchers
            .filter(v => v.voucher_type === 'receipt')
            .reduce((s, v) => s + v.amount, 0)

        const totalPayments = approvedVouchers
            .filter(v => v.voucher_type === 'payment')
            .reduce((s, v) => s + v.amount, 0)

        const pendingCheques = parsedVouchers.filter(v => v.status === 'pending_approval').length

        return {
            receipts: totalReceipts,
            payments: totalPayments,
            net: totalReceipts - totalPayments,
            pendingCount: pendingCheques
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

        const isBankSelect = paymentMode === 'qr' || paymentMode === 'cheque'
        if (isBankSelect && bankAccounts.length > 0 && !bankName) {
            toast.error('Please select a bank account')
            return
        }

        if (voucherType === 'payment') {
            if (payoutCategory === 'suppliers' && !selectedSupplierId) {
                toast.error('Please select a supplier')
                return
            }
            if (payoutCategory === 'staff' && !selectedStaffUserId) {
                toast.error('Please select a staff member')
                return
            }
        }

        if (paymentMode === 'cheque') {
            if (!chequeWrittenName.trim()) {
                toast.error('Cheque Written Name is required')
                return
            }
            if (!chequeBank.trim()) {
                toast.error('Which Bank Cheque (Issuer Bank) is required')
                return
            }
            if (!chequeNumber.trim()) {
                toast.error('Cheque Number is required')
                return
            }
            if (!chequeDate.trim()) {
                toast.error('Cheque Date is required')
                return
            }
        }

        setSaving(true)
        try {
            const res = await createVoucherAction({
                voucher_type: voucherType,
                party_name: partyName,
                amount: amt,
                payment_mode: paymentMode,
                bank_name: isBankSelect ? (bankName || 'General Bank') : undefined,
                particulars: particulars,
                reference_no: referenceNo,
                receiver_name: receiverName,
                category: voucherType === 'payment' ? payoutCategory : undefined,
                supplier_id: voucherType === 'payment' && payoutCategory === 'suppliers' ? selectedSupplierId : undefined,
                staff_user_id: voucherType === 'payment' && payoutCategory === 'staff' ? selectedStaffUserId : undefined,
                staff_entry_type: voucherType === 'payment' && payoutCategory === 'staff' ? staffEntryType : undefined,
                cheque_details: paymentMode === 'cheque' ? {
                    written_name: chequeWrittenName.trim(),
                    bank_cheque: chequeBank.trim(),
                    cheque_number: chequeNumber.trim(),
                    cheque_date: chequeDate.trim(),
                    cheque_type: chequeType
                } : undefined
            })

            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                setEntriesList(prev => [res.data, ...prev])
                setPartyName('')
                setAmount('')
                setParticulars('')
                setReferenceNo('')
                setReceiverName('')
                setChequeWrittenName('')
                setChequeBank('')
                setChequeNumber('')
                setChequeDate('')
                setChequeType('ac_payee')
                setSelectedSupplierId('')
                setSelectedStaffUserId('')
                setPayoutCategory('other')
                setStaffEntryType('salary_payout')
                setCreateModalOpen(false)
                
                // Determine redirect tab
                const isPendingCheque = res.data.description.includes('"status":"pending_approval"')
                if (isPendingCheque) {
                    toast.success('Cheque issued! Pending manager approval to deduct balance.')
                    setActiveTab('approvals')
                } else {
                    toast.success('Voucher created successfully!')
                    setActiveTab('vouchers')
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create voucher')
        } finally {
            setSaving(false)
        }
    }

    // Approve Cheque handler
    const handleApproveCheque = async (id: string) => {
        setActioningId(id)
        try {
            const res = await approveChequeAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Cheque approved and cleared successfully!')
                setEntriesList(prev => prev.map(e => {
                    if (e.id === id) {
                        try {
                            const parsed = JSON.parse(e.description)
                            parsed.status = 'approved'
                            return {
                                ...e,
                                amount: parsed.amount,
                                description: JSON.stringify(parsed)
                            }
                        } catch {}
                    }
                    return e
                }))
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to approve cheque')
        } finally {
            setActioningId(null)
        }
    }

    // Reject Cheque handler
    const handleRejectCheque = async (id: string) => {
        const ok = await confirm({ title: 'Are you sure you want to reject this cheque?', message: 'This action cannot be undone.', confirmText: 'Reject', isDestructive: true })
        if (!ok) return
        setActioningId(id)
        try {
            const res = await rejectChequeAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Cheque marked as rejected.')
                setEntriesList(prev => prev.map(e => {
                    if (e.id === id) {
                        try {
                            const parsed = JSON.parse(e.description)
                            parsed.status = 'rejected'
                            return {
                                ...e,
                                description: JSON.stringify(parsed)
                            }
                        } catch {}
                    }
                    return e
                }))
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reject cheque')
        } finally {
            setActioningId(null)
        }
    }

    // Delete handler — opens the reason-prompt modal instead of deleting directly
    const handleDeleteVoucher = (id: string, number: string) => {
        setDeleteTarget({ id, number })
        setDeleteReason('')
    }

    const confirmDeleteVoucher = async () => {
        if (!deleteTarget) return
        if (!deleteReason.trim()) { toast.error('Please enter a reason.'); return }
        setDeleting(true)
        try {
            const res = await deleteVoucherAction(deleteTarget.id, deleteReason)
            if (res.error) {
                toast.error(res.error)
            } else {
                setEntriesList(prev => prev.filter(e => e.id !== deleteTarget.id))
                toast.success(`Voucher ${deleteTarget.number} deleted successfully!`)
                setDeleteTarget(null)
                setDeleteReason('')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete voucher')
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div className="space-y-6 pb-16 animate-fade-up">
            {/* Session Alert Banner */}
            {!sessionOpenState && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                            <AlertCircle size={20} />
                        </div>
                        <div>
                            <h4 className="font-extrabold text-amber-900 text-sm">No Active Day Book Session Open</h4>
                            <p className="text-xs text-amber-700 mt-0.5 font-bold">
                                You must open today&apos;s Day Book session to create vouchers and post entries.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleOpenSession}
                        disabled={openingSession}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition shadow-md shadow-amber-600/10 focus-ring shrink-0 flex items-center gap-1.5 disabled:opacity-50"
                    >
                        {openingSession ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Open Today&apos;s Session
                    </button>
                </div>
            )}

            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
                            <FileText size={20} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Receipt & Payment Vouchers</h1>
                            <p className="text-sm text-ink-subtle mt-0.5">
                                Log cash, bank QR, or cheques to auto-update books with manager approvals.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => {
                            if (!sessionOpenState) {
                                toast.error("Please open today's Day Book session first!")
                                return
                            }
                            setVoucherType('receipt');
                            setPaymentMode('cash');
                            setCreateModalOpen(true);
                        }}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-500/10 focus-ring"
                    >
                        <Plus size={15} /> Receipt Voucher (In)
                    </button>
                    <button
                        onClick={() => {
                            if (!sessionOpenState) {
                                toast.error("Please open today's Day Book session first!")
                                return
                            }
                            setVoucherType('payment');
                            setPaymentMode('cash');
                            setCreateModalOpen(true);
                            setPayoutCategory('other');
                        }}
                        className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md shadow-rose-500/10 focus-ring"
                    >
                        <Plus size={15} /> Payment Voucher (Out)
                    </button>
                </div>
            </div>

            {/* Stats calculated boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                        <ArrowUpRight size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Receipts</p>
                        <p className="text-base font-black text-emerald-600 mt-0.5">{formatCurrency(stats.receipts)}</p>
                    </div>
                </div>

                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                        <ArrowDownRight size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Payments</p>
                        <p className="text-base font-black text-rose-600 mt-0.5">{formatCurrency(stats.payments)}</p>
                    </div>
                </div>

                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${stats.net >= 0 ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                        <RefreshCw size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Net Cash Flow</p>
                        <p className={`text-base font-black mt-0.5 ${stats.net >= 0 ? 'text-indigo-600' : 'text-rose-600'}`}>{stats.net >= 0 ? '+' : ''}{formatCurrency(stats.net)}</p>
                    </div>
                </div>

                <div className="bg-surface border border-hairline rounded-2xl p-4 shadow-sm flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${stats.pendingCount > 0 ? 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse' : 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                        <AlertCircle size={18} />
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Pending Cheques</p>
                        <p className={`text-base font-black mt-0.5 ${stats.pendingCount > 0 ? 'text-amber-600' : 'text-ink-subtle'}`}>{stats.pendingCount} Cheques</p>
                    </div>
                </div>
            </div>

            {/* Directory Navigation Tabs */}
            <div className="flex border-b border-hairline gap-6">
                <button
                    onClick={() => setActiveTab('vouchers')}
                    className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all relative ${activeTab === 'vouchers' ? 'border-brand-500 text-brand-600 font-extrabold' : 'border-transparent text-ink-subtle hover:text-ink-subtle'}`}
                >
                    Active Vouchers
                </button>
                <button
                    onClick={() => setActiveTab('approvals')}
                    className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all relative flex items-center gap-1.5 ${activeTab === 'approvals' ? 'border-amber-500 text-amber-600 font-extrabold' : 'border-transparent text-ink-subtle hover:text-ink-subtle'}`}
                >
                    Pending Cheque Approvals
                    {stats.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded-full text-[9px] font-bold">
                            {stats.pendingCount}
                        </span>
                    )}
                </button>
            </div>

            {/* List and Filter controls */}
            <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-hairline flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h3 className="font-extrabold text-ink text-sm">
                            {activeTab === 'vouchers' ? 'Active Voucher Logs' : 'Pending Cheque Approvals Queue'}
                        </h3>
                        <p className="text-[10px] text-ink-subtle mt-0.5">
                            {activeTab === 'vouchers' 
                                ? 'List of all approved and posted transactions' 
                                : 'Cheques awaiting manager deposit approval to post to ledger'}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                        <Select
                            value={filterType}
                            onChange={e => setFilterType(e.target.value as typeof filterType)}
                            className="px-3 py-2 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                        >
                            <option value="all">All Types</option>
                            <option value="receipt">Receipts (RV)</option>
                            <option value="payment">Payments (PV)</option>
                        </Select>

                        <Select
                            value={filterMode}
                            onChange={e => setFilterMode(e.target.value as typeof filterMode)}
                            className="px-3 py-2 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                        >
                            <option value="all">All Modes</option>
                            <option value="cash">Cash Only</option>
                            <option value="qr">QR Only</option>
                            <option value="cheque">Cheque Only</option>
                        </Select>

                        <div className="relative w-full sm:w-60">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search party, voucher no..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                            />
                        </div>

                        {filteredVouchers.length > 0 && (
                            <div className="flex gap-2">
                                <button
                                    onClick={handleExportCsv}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase tracking-wider border border-hairline transition-all shrink-0"
                                >
                                    <Download size={13} /> Export
                                </button>
                                <button
                                    onClick={() => printRef.current?.print()}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase tracking-wider border border-hairline transition-all shrink-0"
                                >
                                    <Printer size={13} /> Print
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="overflow-x-auto">
                    {filteredVouchers.length === 0 ? (
                        <div className="text-center py-20 text-ink-subtle">
                            <FileText size={44} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm font-bold">No voucher logs found in this view</p>
                        </div>
                    ) : (
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                    <th className="px-5 py-3 font-bold w-28">Date</th>
                                    <th className="px-5 py-3 font-bold w-32">Voucher No</th>
                                    <th className="px-5 py-3 font-bold w-28">Type</th>
                                    <th className="px-5 py-3 font-bold w-44">Party Name</th>
                                    <th className="px-5 py-3 font-bold w-32">Mode</th>
                                    <th className="px-5 py-3 font-bold text-right w-28">Amount</th>
                                    <th className="px-5 py-3 font-bold">Particulars / Cheque No</th>
                                    <th className="px-5 py-3 font-bold text-center w-36">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                                {filteredVouchers.map(v => (
                                    <tr key={v.id} className="hover:bg-surface-muted/50 transition-colors">
                                        <td className="px-5 py-4 text-ink-subtle font-semibold">
                                            <DateCell value={v.date} />
                                        </td>
                                        <td className="px-5 py-4 font-extrabold text-ink whitespace-nowrap">{v.voucher_number}</td>
                                        <td className="px-5 py-4">
                                            <div className="flex flex-col gap-0.5">
                                                <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase w-fit ${
                                                    v.voucher_type === 'receipt' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                                                }`}>
                                                    {v.voucher_type === 'receipt' ? 'Receipt' : 'Payment'}
                                                </span>
                                                {v.voucher_type === 'payment' && v.category && v.category !== 'other' && (
                                                    <span className="text-[9px] text-ink-subtle font-bold uppercase tracking-wider pl-1">
                                                        ↳ {v.category}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 font-bold text-ink truncate max-w-[150px]" title={v.party_name}>
                                            {v.party_name}
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase ${
                                                v.payment_mode === 'bank' || v.payment_mode === 'qr' ? 'bg-indigo-50 border border-indigo-100 text-indigo-700' : v.payment_mode === 'cheque' ? 'bg-purple-50 border border-purple-100 text-purple-700' : 'bg-amber-50 border border-amber-100 text-amber-700'
                                            }`}>
                                                {v.payment_mode === 'cash' ? 'Cash' : v.payment_mode === 'qr' ? `QR (${v.bank_name})` : v.payment_mode === 'cheque' ? `CHEQUE (${v.bank_name})` : v.bank_name}
                                            </span>
                                        </td>
                                        <td className={`px-5 py-4 text-right font-black text-xs ${v.voucher_type === 'receipt' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {v.voucher_type === 'receipt' ? '+' : '-'}{formatCurrency(v.amount)}
                                        </td>
                                        <td className="px-5 py-4 font-bold text-ink-subtle max-w-[180px] truncate">
                                            {v.payment_mode === 'cheque' && v.cheque_details ? (
                                                <span className="text-purple-600">
                                                    No: {v.cheque_details.cheque_number} ({v.cheque_details.bank_cheque})
                                                </span>
                                            ) : (
                                                v.particulars
                                            )}
                                        </td>
                                        <td className="px-5 py-4 text-center whitespace-nowrap">
                                            {v.status === 'pending_approval' ? (
                                                <div className="inline-flex gap-1">
                                                    <button
                                                        onClick={() => handleApproveCheque(v.id)}
                                                        disabled={actioningId === v.id}
                                                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-extrabold uppercase border border-emerald-200 transition-all flex items-center gap-0.5 focus-ring"
                                                    >
                                                        {actioningId === v.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectCheque(v.id)}
                                                        disabled={actioningId === v.id}
                                                        className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[10px] font-extrabold uppercase border border-rose-200 transition-all flex items-center gap-0.5 focus-ring"
                                                    >
                                                        Reject
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="inline-flex gap-2">
                                                    <button
                                                        onClick={() => setPrintVoucher(v)}
                                                        className="p-1.5 hover:bg-indigo-50 hover:text-indigo-600 border border-transparent hover:border-indigo-100 rounded-lg text-ink-subtle transition-all focus-ring"
                                                        title="View / Print Slip"
                                                    >
                                                        <Printer size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteVoucher(v.id, v.voucher_number)}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100 rounded-lg text-ink-subtle transition-all focus-ring"
                                                        title="Delete / Void"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            )}
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
                    
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl w-full max-w-lg relative z-10 overflow-hidden animate-in fade-in-50 zoom-in-95 duration-200">
                        <div className="p-5 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="font-extrabold text-ink text-sm">
                                    Create New {voucherType === 'receipt' ? 'Receipt' : 'Payment'} Voucher
                                </h3>
                                <p className="text-[10px] text-ink-subtle mt-0.5">Logs money {voucherType === 'receipt' ? 'inward' : 'outward'} transaction</p>
                            </div>
                            <button 
                                onClick={() => setCreateModalOpen(false)}
                                className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink-subtle transition-colors focus:outline-none"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        
                        <form onSubmit={handleCreateVoucher} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
                            {/* Payout Category Selection (Only for Payment Vouchers) */}
                            {voucherType === 'payment' && (
                                <div className="space-y-3 bg-surface-muted p-3 rounded-xl border border-hairline">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Payment Ledger Category</label>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {(['suppliers', 'staff', 'expenses', 'other'] as const).map(cat => (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => {
                                                        setPayoutCategory(cat)
                                                        setPartyName('')
                                                        setSelectedSupplierId('')
                                                        setSelectedStaffUserId('')
                                                    }}
                                                    className={`py-1.5 rounded-lg text-[10px] font-bold border transition capitalize ${payoutCategory === cat ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                                                >
                                                    {cat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {payoutCategory === 'suppliers' && (
                                        <div className="animate-in slide-in-from-top-1 duration-150">
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Select Supplier *</label>
                                            <Select
                                                value={selectedSupplierId}
                                                onChange={(e) => {
                                                    const sId = e.target.value
                                                    setSelectedSupplierId(sId)
                                                    const match = suppliers.find(s => s.id === sId)
                                                    if (match) setPartyName(match.name)
                                                }}
                                                required
                                                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            >
                                                <option value="">Choose Supplier</option>
                                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                            </Select>

                                            {selectedSupplierId && (
                                                <div className="mt-2 p-2 rounded-lg bg-rose-50/50 border border-rose-100 flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider">Outstanding Due:</span>
                                                    <span className="text-xs font-black text-rose-600 flex items-center gap-1">
                                                        {loadingDue ? (
                                                            <Loader2 className="animate-spin text-rose-500" size={12} />
                                                        ) : supplierDue !== null ? (
                                                            formatCurrency(supplierDue)
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {payoutCategory === 'staff' && (
                                        <div className="animate-in slide-in-from-top-1 duration-150">
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Select Staff Member *</label>
                                            <Select
                                                value={selectedStaffUserId}
                                                onChange={(e) => {
                                                    const sId = e.target.value
                                                    setSelectedStaffUserId(sId)
                                                    const match = staffList.find(s => s.id === sId)
                                                    if (match) setPartyName(match.full_name)
                                                }}
                                                required
                                                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            >
                                                <option value="">Choose Staff Profile</option>
                                                {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                                            </Select>

                                            {selectedStaffUserId && (
                                                <div className="mt-2 p-2 rounded-lg bg-indigo-50/50 border border-indigo-100 flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider">Current Salary Due:</span>
                                                    <span className="text-xs font-black text-indigo-600 flex items-center gap-1">
                                                        {loadingDue ? (
                                                            <Loader2 className="animate-spin text-indigo-500" size={12} />
                                                        ) : staffDue !== null ? (
                                                            formatCurrency(staffDue)
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </span>
                                                </div>
                                            )}

                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1 mt-3">Pay Category *</label>
                                            <div className="grid grid-cols-3 gap-2">
                                                {([
                                                    { value: 'salary_payout', label: 'Salary Payout' },
                                                    { value: 'advance_payment', label: 'Advance Payment' },
                                                    { value: 'bonus', label: 'Bonus' },
                                                ] as const).map(opt => (
                                                    <button
                                                        key={opt.value}
                                                        type="button"
                                                        onClick={() => setStaffEntryType(opt.value)}
                                                        className={`py-2 text-[10px] font-black uppercase tracking-wider border rounded-lg transition-all ${
                                                            staffEntryType === opt.value ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <p className="text-[10px] text-ink-subtle mt-1">
                                                Salary Payout is capped at what&apos;s currently due; Advance Payment and Bonus are not.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                        {voucherType === 'receipt' ? 'Received From *' : 'Paid To *'}
                                    </label>
                                    <input
                                        type="text"
                                        placeholder={voucherType === 'receipt' ? "Payer Name" : "Receiver Name"}
                                        value={partyName}
                                        onChange={e => setPartyName(e.target.value)}
                                        required
                                        disabled={voucherType === 'payment' && (payoutCategory === 'suppliers' || payoutCategory === 'staff')}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] disabled:bg-surface-muted disabled:text-ink-subtle"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Amount (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={e => setAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Reference / Phone Number</label>
                                    <input
                                        type="tel"
                                        placeholder="e.g. 98XXXXXXXX"
                                        value={referenceNo}
                                        onChange={e => setReferenceNo(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Receiver Staff Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Cashier Ram"
                                        value={receiverName}
                                        onChange={e => setReceiverName(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Payment Method</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['cash', 'qr', 'cheque'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => { setPaymentMode(mode); setBankName(''); }}
                                            className={`py-2.5 rounded-xl text-xs font-bold border transition capitalize ${paymentMode === mode ? 'bg-brand-50 border-brand-500 text-brand-600 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {(paymentMode === 'qr' || paymentMode === 'cheque') && (
                                <div className="animate-in slide-in-from-top-1 duration-150">
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                        Destination / Source Bank Account *
                                    </label>
                                    <Select
                                        value={bankName}
                                        onChange={e => {
                                            const baName = e.target.value
                                            setBankName(baName)
                                            // Picking an account whose ownership was
                                            // set when it was added (Company → A/C
                                            // Payee, Personal → Normal) default-selects
                                            // the matching Cheque Type below.
                                            const matched = bankAccounts.find(b => b.name === baName)
                                            const suggested = chequeTypeForBankAccount(matched?.bank_name)
                                            if (suggested) setChequeType(suggested)
                                        }}
                                        required
                                        className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    >
                                        <option value="">Select Account</option>
                                        {parsedBankAccounts.map(b => (
                                            <option key={b.id} value={b.name}>
                                                {b.name} ({b.displayName} — {b.ownership === 'personal' ? 'Personal' : 'Company (A/C Payee)'})
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                            )}

                            {/* Cheque specific inputs */}
                            {paymentMode === 'cheque' && (
                                <div className="space-y-4 border-t border-hairline pt-4 animate-in slide-in-from-top-2 duration-200">
                                    <p className="text-xs font-black text-purple-700 uppercase tracking-wider">Cheque Specifications</p>
                                    
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Written Name on Cheque *</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. KKKhane Restaurant"
                                                value={chequeWrittenName}
                                                onChange={e => setChequeWrittenName(e.target.value)}
                                                required
                                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Which Bank Cheque (Issuer) *</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Global IME Bank"
                                                value={chequeBank}
                                                onChange={e => setChequeBank(e.target.value)}
                                                required
                                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Number *</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 10293847"
                                                value={chequeNumber}
                                                onChange={e => setChequeNumber(e.target.value)}
                                                required
                                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Date *</label>
                                            <input
                                                type="date"
                                                value={chequeDate}
                                                onChange={e => setChequeDate(e.target.value)}
                                                required
                                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Type / Payee Category</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setChequeType('ac_payee')}
                                                className={`py-2 rounded-xl text-xs font-bold border transition ${chequeType === 'ac_payee' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-extrabold' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                                            >
                                                A/C Payee (Company Cheque)
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setChequeType('normal')}
                                                className={`py-2 rounded-xl text-xs font-bold border transition ${chequeType === 'normal' ? 'bg-amber-50 border-amber-500 text-amber-700 font-extrabold' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                                            >
                                                Normal Person Cheque
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Particulars / Description *</label>
                                <textarea
                                    placeholder="Details of the payment or receipt..."
                                    value={particulars}
                                    onChange={e => setParticulars(e.target.value)}
                                    required
                                    rows={2}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] resize-none"
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

            {printVoucher && (
                <VoucherPrintSlip voucher={printVoucher} onClose={() => setPrintVoucher(null)} />
            )}

            {/* Delete voucher — requires a reason, same pattern as refunds
                (RefundOrderButton.tsx), and gets logged via logAudit in
                deleteVoucherAction so there's a record of who deleted it and why. */}
            {deleteTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-surface rounded-card shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-hairline w-full max-w-sm p-6 space-y-5">
                        <div className="flex items-center gap-2">
                            <Trash2 size={18} className="text-danger-fg" />
                            <h2 className="text-h3 text-ink">Delete Voucher {deleteTarget.number}</h2>
                        </div>
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-[var(--r-md)] px-3 py-2 font-medium">
                            This will reverse its Cash/Bank book entry. This cannot be undone.
                        </p>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Reason</label>
                            <textarea
                                value={deleteReason}
                                onChange={(e) => setDeleteReason(e.target.value)}
                                placeholder="e.g. entered by mistake, duplicate voucher…"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all resize-none"
                                rows={3}
                                maxLength={200}
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-3 justify-end pt-2 border-t border-hairline mt-2">
                            <button
                                onClick={() => { setDeleteTarget(null); setDeleteReason('') }}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring"
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteVoucher}
                                disabled={deleting || !deleteReason.trim()}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-danger-fg rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(239,68,68,0.25)] hover:shadow-[0_6px_16px_rgba(239,68,68,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 focus-ring"
                            >
                                {deleting && <Loader2 size={16} className="animate-spin" />}
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <PrintableReport
                ref={printRef}
                title="Vouchers Ledger"
                subtitle={activeTab === 'vouchers' ? 'Active Voucher Logs' : 'Pending Cheque Approvals Queue'}
                columns={reportColumns}
                rows={reportRows}
            />
        </div>
    )
}
