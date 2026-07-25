'use client'

import { useState, useMemo, useRef } from 'react'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, Users, Download, Printer, HandCoins, TrendingUp, TrendingDown
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
    createCustomerCreditAccountAction, updateCustomerCreditAccountAction, deleteCustomerCreditAccountAction,
    createReceivableTransactionAction, deleteReceivableTransactionAction,
} from '../finance/receivables/actions'
import { formatCurrency } from '@/lib/utils'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import { downloadPdf } from '@/lib/exportPdf'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { CustomerCreditAccount, ReceivableTransaction, ReceivableTransactionType } from '@/types/database'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

interface CustomersLedgerManagerProps {
    initialAccounts: CustomerCreditAccount[]
    initialTransactions: ReceivableTransaction[]
}

export default function CustomersLedgerManager({ initialAccounts, initialTransactions }: CustomersLedgerManagerProps) {
    const { confirm } = useConfirmStore()
    const [accounts, setAccounts] = useState<CustomerCreditAccount[]>(initialAccounts)
    const [transactions, setTransactions] = useState<ReceivableTransaction[]>(initialTransactions)
    const formatDate = useDateFormatter()
    const [searchQuery, setSearchQuery] = useState('')

    // Create/Edit customer modal
    const [modalOpen, setModalOpen] = useState<'create' | 'edit' | null>(null)
    const [selectedAccount, setSelectedAccount] = useState<CustomerCreditAccount | null>(null)
    const [name, setName] = useState('')
    const [phone, setPhone] = useState('')
    const [creditLimit, setCreditLimit] = useState('0')
    const [submitting, setSubmitting] = useState(false)

    // Ledger statement view
    const [ledgerAccount, setLedgerAccount] = useState<CustomerCreditAccount | null>(null)

    // Record transaction modal
    const [txnModalOpen, setTxnModalOpen] = useState(false)
    const [txnType, setTxnType] = useState<ReceivableTransactionType>('charge')
    const [txnAmount, setTxnAmount] = useState('')
    const [txnDesc, setTxnDesc] = useState('')
    const [submittingTxn, setSubmittingTxn] = useState(false)

    const openAddModal = () => {
        setName('')
        setPhone('')
        setCreditLimit('0')
        setModalOpen('create')
    }

    const openEditModal = (account: CustomerCreditAccount) => {
        setSelectedAccount(account)
        setName(account.customer_name)
        setPhone(account.customer_phone || '')
        setCreditLimit(String(account.credit_limit))
        setModalOpen('edit')
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { toast.error('Customer name is required'); return }

        setSubmitting(true)
        try {
            if (modalOpen === 'create') {
                const res = await createCustomerCreditAccountAction({
                    customer_name: name.trim(),
                    customer_phone: phone.trim(),
                    credit_limit: parseFloat(creditLimit) || 0,
                })
                if (res.error) {
                    toast.error(res.error)
                } else if (res.data) {
                    setAccounts(prev => [...prev, res.data as CustomerCreditAccount].sort((a, b) => a.customer_name.localeCompare(b.customer_name)))
                    setModalOpen(null)
                    toast.success('Customer account created')
                }
            } else if (modalOpen === 'edit' && selectedAccount) {
                const res = await updateCustomerCreditAccountAction(selectedAccount.id, {
                    customer_name: name.trim(),
                    customer_phone: phone.trim(),
                    credit_limit: parseFloat(creditLimit) || 0,
                })
                if (res.error) {
                    toast.error(res.error)
                } else {
                    const updated = { ...selectedAccount, customer_name: name.trim(), customer_phone: phone.trim() || null, credit_limit: parseFloat(creditLimit) || 0 }
                    setAccounts(prev => prev.map(a => a.id === selectedAccount.id ? updated : a))
                    if (ledgerAccount?.id === selectedAccount.id) setLedgerAccount(updated)
                    setModalOpen(null)
                    toast.success('Customer updated')
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred')
        } finally {
            setSubmitting(false)
        }
    }

    const toggleActive = async (a: CustomerCreditAccount) => {
        const res = await updateCustomerCreditAccountAction(a.id, { is_active: !a.is_active })
        if (res.error) { toast.error(res.error); return }
        setAccounts(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x))
    }

    const handleDelete = async (id: string, cName: string) => {
        const ok = await confirm({ title: `Are you sure you want to delete the customer "${cName}"?`, message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const res = await deleteCustomerCreditAccountAction(id)
        if (res.error) { toast.error(res.error); return }
        setAccounts(prev => prev.filter(a => a.id !== id))
        if (ledgerAccount?.id === id) setLedgerAccount(null)
        toast.success('Customer deleted')
    }

    const handleRecordTxn = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ledgerAccount) return
        const amount = parseFloat(txnAmount)
        if (isNaN(amount) || amount <= 0) { toast.error('Amount must be positive'); return }
        if (!txnDesc.trim()) { toast.error('Description is required'); return }

        setSubmittingTxn(true)
        try {
            const res = await createReceivableTransactionAction({
                customer_credit_account_id: ledgerAccount.id,
                type: txnType,
                amount,
                description: txnDesc.trim(),
            })
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const newTxn = res.data as ReceivableTransaction
                setTransactions(prev => [newTxn, ...prev])
                setTxnModalOpen(false)
                setTxnType('charge')
                setTxnAmount('')
                setTxnDesc('')
                toast.success('Transaction recorded')

                // Calculate if running balance reaches zero
                const updatedTxns = [newTxn, ...transactions]
                const customerTxns = updatedTxns.filter(t => t.customer_credit_account_id === ledgerAccount.id)
                let currentBalance = 0
                customerTxns.forEach(t => {
                    if (t.type === 'payment') currentBalance -= t.amount
                    else currentBalance += t.amount
                })

                if (Math.abs(currentBalance) <= 0.01) {
                    setTimeout(async () => {
                        const deleteOk = await confirm({
                            title: 'Outstanding Due Settled',
                            message: `The outstanding balance for "${ledgerAccount.customer_name}" is now zero. Would you like to remove this customer account from the ledger?`,
                            confirmText: 'Yes, Delete Account',
                            cancelText: 'Keep Account',
                            isDestructive: true
                        })
                        if (deleteOk) {
                            const delRes = await deleteCustomerCreditAccountAction(ledgerAccount.id)
                            if (delRes.error) {
                                toast.error(delRes.error)
                            } else {
                                setAccounts(prev => prev.filter(a => a.id !== ledgerAccount.id))
                                setLedgerAccount(null)
                                toast.success('Customer ledger account deleted')
                            }
                        }
                    }, 300)
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to record transaction')
        } finally {
            setSubmittingTxn(false)
        }
    }

    const handleDeleteTxn = async (id: string) => {
        const ok = await confirm({ title: 'Delete this transaction?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const res = await deleteReceivableTransactionAction(id)
        if (res.error) { toast.error(res.error); return }
        setTransactions(prev => prev.filter(t => t.id !== id))
        toast.success('Transaction deleted')
    }

    const filteredAccounts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (!q) return accounts
        return accounts.filter(a =>
            a.customer_name.toLowerCase().includes(q) ||
            (a.customer_phone && a.customer_phone.includes(q))
        )
    }, [accounts, searchQuery])

    // Per-customer Paid / Due totals for the directory table, so balances are visible without opening the statement.
    const accountBalances = useMemo(() => {
        const map = new Map<string, { paid: number; due: number }>()
        for (const t of transactions) {
            const entry = map.get(t.customer_credit_account_id) || { paid: 0, due: 0 }
            if (t.type === 'payment') entry.paid += t.amount
            else entry.due += t.amount
            map.set(t.customer_credit_account_id, entry)
        }
        return map
    }, [transactions])

    // Ledger statement transactions with running balance (charge increases what's owed, payment reduces it)
    const customerLedgerEntries = useMemo(() => {
        if (!ledgerAccount) return []
        const filtered = transactions
            .filter(t => t.customer_credit_account_id === ledgerAccount.id)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        let cumulativeBalance = 0
        const mapped = filtered.map(t => {
            cumulativeBalance += t.type === 'charge' ? t.amount : -t.amount
            return { ...t, runningBalance: cumulativeBalance }
        })
        return mapped.reverse()
    }, [ledgerAccount, transactions])

    const totalCharged = useMemo(() => customerLedgerEntries.reduce((sum, t) => sum + (t.type === 'charge' ? t.amount : 0), 0), [customerLedgerEntries])
    const totalCollected = useMemo(() => customerLedgerEntries.reduce((sum, t) => sum + (t.type === 'payment' ? t.amount : 0), 0), [customerLedgerEntries])
    const outstandingBalance = useMemo(() => customerLedgerEntries[0]?.runningBalance ?? 0, [customerLedgerEntries])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'type', label: 'Type' },
        { key: 'description', label: 'Description' },
        { key: 'due', label: 'Due', align: 'right' as const },
        { key: 'paid', label: 'Paid', align: 'right' as const },
        { key: 'running_balance', label: 'Running Balance', align: 'right' as const },
    ]
    const reportRows = customerLedgerEntries.map(t => ({
        date: formatDate(t.created_at),
        type: t.type === 'charge' ? 'Charge' : 'Payment Collected',
        description: t.description,
        due: t.type === 'charge' ? formatCurrency(t.amount) : '',
        paid: t.type === 'payment' ? formatCurrency(t.amount) : '',
        running_balance: formatCurrency(t.runningBalance),
    }))
    const handleExportCsv = () => downloadCsv(`customer-statement-${ledgerAccount?.customer_name || 'customer'}`, reportColumns, reportRows)
    const handleExportExcel = () => downloadExcel(`customer-statement-${ledgerAccount?.customer_name || 'customer'}`, reportColumns, reportRows)
    const handleExportPdf = () => {
        if (!ledgerAccount) return
        const pdfCols = reportColumns.map(c => ({ key: c.key, label: c.label }))
        downloadPdf(
            `customer-statement-${ledgerAccount.customer_name}`,
            `Customer Statement: ${ledgerAccount.customer_name}`,
            `Phone: ${ledgerAccount.customer_phone || 'N/A'} | Credit Limit: ${formatCurrency(ledgerAccount.credit_limit)} | Outstanding: ${formatCurrency(outstandingBalance)}`,
            pdfCols,
            reportRows
        )
    }

    const directoryColumns = [
        { key: 'name', label: 'Customer Name' },
        { key: 'phone', label: 'Phone Number' },
        { key: 'limit', label: 'Credit Limit' },
        { key: 'due', label: 'Outstanding Due' },
        { key: 'paid', label: 'Total Paid' },
        { key: 'status', label: 'Status' }
    ]
    const getDirectoryRows = () => filteredAccounts.map(a => {
        const bal = accountBalances.get(a.id) ?? { paid: 0, due: 0 }
        const outstanding = Math.max(bal.due - bal.paid, 0)
        return {
            name: a.customer_name,
            phone: a.customer_phone || 'N/A',
            limit: formatCurrency(a.credit_limit),
            due: formatCurrency(outstanding),
            paid: formatCurrency(bal.paid),
            status: a.is_active ? 'Active' : 'Inactive'
        }
    })

    const handleExportDirectoryCsv = () => downloadCsv('customers-directory', directoryColumns, getDirectoryRows())
    const handleExportDirectoryExcel = () => downloadExcel('customers-directory', directoryColumns, getDirectoryRows())
    const handleExportDirectoryPdf = () => {
        downloadPdf(
            'customers-directory',
            'Customers Credit Ledger Directory',
            `Total Credit Customers: ${filteredAccounts.length}`,
            directoryColumns,
            getDirectoryRows()
        )
    }

    return (
        <>
            <div className="space-y-6 pb-16 animate-fade-up">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                            <Users size={20} className="text-brand-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-ink tracking-tight">Customers Ledger</h1>
                            <p className="text-sm text-ink-subtle mt-0.5">
                                Track customers who carry a running balance — charges and collected payments.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={openAddModal}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/20"
                    >
                        <Plus size={16} /> Add Customer
                    </button>
                </div>

                <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-hairline bg-surface-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-black text-ink uppercase tracking-wider">Customers Directory ({filteredAccounts.length})</p>
                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                            <div className="flex items-center gap-1.5 print:hidden">
                                <button
                                    onClick={handleExportDirectoryCsv}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase border border-hairline transition-all shadow-sm"
                                >
                                    <Download size={12} /> CSV
                                </button>
                                <button
                                    onClick={handleExportDirectoryExcel}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase border border-hairline transition-all shadow-sm"
                                >
                                    <Download size={12} /> Excel
                                </button>
                                <button
                                    onClick={handleExportDirectoryPdf}
                                    className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-[10px] uppercase border border-hairline transition-all shadow-sm"
                                >
                                    <Download size={12} /> PDF
                                </button>
                            </div>
                            <div className="relative w-full sm:w-64">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
                                    <Search size={14} />
                                </span>
                                <input
                                    type="text"
                                    placeholder="Search customers..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        {filteredAccounts.length === 0 ? (
                            <div className="text-center py-16 px-4">
                                <FileText size={40} className="text-ink-subtle mx-auto mb-3" />
                                <p className="text-xs font-bold text-ink-subtle">No customers found</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-surface-muted border-b border-hairline">
                                        <th className="px-6 py-4 font-bold text-ink-subtle">Customer Details</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle w-32 text-right">Credit Limit</th>
                                        <th className="px-6 py-4 font-bold text-rose-500 w-32 text-right">Due</th>
                                        <th className="px-6 py-4 font-bold text-emerald-600 w-32 text-right">Paid</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle w-24 text-center">Status</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle w-44 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                    {filteredAccounts.map((a, idx) => {
                                        const bal = accountBalances.get(a.id) ?? { paid: 0, due: 0 }
                                        const outstanding = Math.max(bal.due - bal.paid, 0)
                                        return (
                                        <tr key={a.id} className={`transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/20'} hover:bg-surface-muted/50`}>
                                            <td className="px-6 py-4">
                                                <p className="font-extrabold text-sm text-ink">{a.customer_name}</p>
                                                <p className="text-[10px] text-ink-subtle font-semibold flex items-center gap-1 mt-1">
                                                    <Phone size={10} /> {a.customer_phone || 'N/A'}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4 text-right font-bold text-ink">{formatCurrency(a.credit_limit)}</td>
                                            <td className="px-6 py-4 text-right font-black text-rose-600">{formatCurrency(outstanding)}</td>
                                            <td className="px-6 py-4 text-right font-black text-emerald-600">{formatCurrency(bal.paid)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-muted text-ink-subtle'}`}>
                                                    {a.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center space-x-2 whitespace-nowrap">
                                                <button
                                                    onClick={() => setLedgerAccount(a)}
                                                    className="px-3 py-1.5 rounded-lg font-black text-[10px] uppercase border bg-surface hover:bg-surface-muted border-hairline text-ink-subtle hover:text-ink transition-all shadow-sm"
                                                >
                                                    Ledger Statement
                                                </button>
                                                <button
                                                    onClick={() => toggleActive(a)}
                                                    className="p-1.5 hover:bg-surface-muted hover:text-ink border border-transparent rounded-lg text-ink-subtle transition-all inline-flex align-middle"
                                                    title={a.is_active ? 'Deactivate' : 'Activate'}
                                                >
                                                    {a.is_active ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                                                </button>
                                                <button
                                                    onClick={() => openEditModal(a)}
                                                    className="p-1.5 hover:bg-surface-muted hover:text-ink border border-transparent rounded-lg text-ink-subtle transition-all inline-flex align-middle"
                                                    title="Edit Customer"
                                                >
                                                    <Edit2 size={12} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(a.id, a.customer_name)}
                                                    className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent rounded-lg text-ink-subtle transition-all inline-flex align-middle"
                                                    title="Delete Customer"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </td>
                                        </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {/* ── CUSTOMER LEDGER STATEMENT MODAL ── */}
            {ledgerAccount && (
                <div className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <div>
                                <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Customer Account Statement</span>
                                <h2 className="text-xl font-extrabold text-ink mt-0.5">{ledgerAccount.customer_name}</h2>
                                <p className="text-xs text-ink-subtle mt-1">
                                    {[ledgerAccount.customer_phone && `Phone: ${ledgerAccount.customer_phone}`, `Credit Limit: ${formatCurrency(ledgerAccount.credit_limit)}`].filter(Boolean).join(' | ')}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                {customerLedgerEntries.length > 0 && (
                                    <>
                                        <button
                                            onClick={handleExportCsv}
                                            className="flex items-center gap-1 px-2.5 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all"
                                        >
                                            <Download size={14} /> CSV
                                        </button>
                                        <button
                                            onClick={handleExportExcel}
                                            className="flex items-center gap-1 px-2.5 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all"
                                        >
                                            <Download size={14} /> Excel
                                        </button>
                                        <button
                                            onClick={handleExportPdf}
                                            className="flex items-center gap-1 px-2.5 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all"
                                        >
                                            <Download size={14} /> PDF
                                        </button>
                                        <button
                                            onClick={() => printRef.current?.print()}
                                            className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all"
                                        >
                                            <Printer size={14} /> Print
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => setTxnModalOpen(true)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-colors"
                                >
                                    <Plus size={14} /> Record Transaction
                                </button>
                                <button
                                    onClick={() => setLedgerAccount(null)}
                                    className="p-1.5 text-ink-subtle hover:text-ink-subtle hover:bg-surface-muted rounded-lg transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 border-b border-hairline divide-x divide-hairline bg-surface">
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Charged</p>
                                <p className="text-lg font-black text-ink mt-1">{formatCurrency(totalCharged)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Collected</p>
                                <p className="text-lg font-black text-emerald-600 mt-1">{formatCurrency(totalCollected)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Outstanding Balance</p>
                                <p className="text-lg font-black text-rose-600 mt-1">{formatCurrency(outstandingBalance)}</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-6 bg-surface-muted/30">
                            {customerLedgerEntries.length === 0 ? (
                                <div className="text-center py-20 bg-surface border border-dashed border-hairline rounded-2xl text-ink-subtle">
                                    <HandCoins size={32} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-sm font-bold">No transactions recorded for this customer yet.</p>
                                    <p className="text-xs text-ink-subtle mt-1 max-w-sm mx-auto leading-relaxed">
                                        Click &quot;Record Transaction&quot; above to log a charge or a payment collected, and calculate the running balance.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-surface border border-hairline rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                                <th className="px-4 py-3 font-bold">Date</th>
                                                <th className="px-4 py-3 font-bold text-center w-32">Type</th>
                                                <th className="px-4 py-3 font-bold">Description</th>
                                                <th className="px-4 py-3 font-bold text-right w-28 text-rose-500">Due</th>
                                                <th className="px-4 py-3 font-bold text-right w-28 text-emerald-600">Paid</th>
                                                <th className="px-4 py-3 font-bold text-right w-32 bg-surface-muted/50">Running Balance</th>
                                                <th className="px-4 py-3 font-bold text-center w-14"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {customerLedgerEntries.map(t => (
                                                <tr key={t.id} className="hover:bg-surface-muted/50 transition-colors">
                                                    <td className="px-4 py-3 text-ink-subtle font-semibold"><DateCell value={t.created_at} /></td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${t.type === 'charge' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                            {t.type === 'charge' ? 'Charge' : 'Payment'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-ink">{t.description}</td>
                                                    <td className="px-4 py-3 text-right font-black text-rose-600">
                                                        {t.type === 'charge' ? formatCurrency(t.amount) : <span className="text-ink-subtle">—</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-emerald-600">
                                                        {t.type === 'payment' ? formatCurrency(t.amount) : <span className="text-ink-subtle">—</span>}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-black bg-surface-muted/30 ${t.runningBalance > 0 ? 'text-rose-600' : 'text-ink'}`}>
                                                        {formatCurrency(t.runningBalance)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={() => handleDeleteTxn(t.id)}
                                                            className="p-1 hover:bg-rose-50 hover:text-rose-600 rounded text-ink-subtle transition-all"
                                                            title="Delete Transaction"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t border-hairline bg-surface-muted/50 flex justify-end">
                            <button
                                onClick={() => setLedgerAccount(null)}
                                className="px-5 py-2 bg-surface-muted hover:opacity-80 text-ink font-bold text-xs rounded-xl transition-all"
                            >
                                Close Statement
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE/EDIT CUSTOMER MODAL ── */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-extrabold text-ink flex items-center gap-2">
                                <Users size={18} className="text-brand-500" />
                                {modalOpen === 'create' ? 'Create Customer Account' : 'Edit Customer Details'}
                            </h3>
                            <button onClick={() => setModalOpen(null)} className="text-ink-subtle hover:text-ink-subtle">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Customer Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Ram Sharma"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Phone</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9812345678"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Credit Limit (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={creditLimit}
                                        onChange={e => setCreditLimit(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                            </div>
                            <div className="px-6 py-4 border-t border-hairline bg-surface-muted flex items-center justify-end gap-3">
                                <button type="button" onClick={() => setModalOpen(null)} className="px-4 py-2 text-ink-subtle hover:text-ink-subtle font-bold text-sm">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submitting && <Loader2 size={14} className="animate-spin" />}
                                    {modalOpen === 'create' ? 'Create Customer' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── RECORD TRANSACTION MODAL ── */}
            {txnModalOpen && ledgerAccount && (
                <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-extrabold text-ink flex items-center gap-2">
                                <HandCoins size={18} className="text-brand-500" />
                                Record Transaction for {ledgerAccount.customer_name}
                            </h3>
                            <button onClick={() => setTxnModalOpen(false)} className="text-ink-subtle hover:text-ink-subtle">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleRecordTxn}>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Type *</label>
                                    <Select
                                        value={txnType}
                                        onChange={e => setTxnType(e.target.value as ReceivableTransactionType)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    >
                                        <option value="charge">Charge (customer owes more)</option>
                                        <option value="payment">Payment Collection (customer pays down)</option>
                                    </Select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Amount (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={txnAmount}
                                        onChange={e => setTxnAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Description *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Dine-in bill #204, or Cash payment received"
                                        value={txnDesc}
                                        onChange={e => setTxnDesc(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                            </div>
                            <div className="px-6 py-4 border-t border-hairline bg-surface-muted flex items-center justify-end gap-3">
                                <button type="button" onClick={() => setTxnModalOpen(false)} className="px-4 py-2 text-ink-subtle hover:text-ink-subtle font-bold text-sm">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingTxn}
                                    className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submittingTxn && <Loader2 size={14} className="animate-spin" />}
                                    Record Transaction
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {ledgerAccount && (
                <PrintableReport
                    ref={printRef}
                    title={`Customer Statement — ${ledgerAccount.customer_name}`}
                    subtitle={`Total Charged: ${formatCurrency(totalCharged)} | Collected: ${formatCurrency(totalCollected)} | Outstanding: ${formatCurrency(outstandingBalance)}`}
                    columns={reportColumns}
                    rows={reportRows}
                />
            )}
        </>
    )
}
