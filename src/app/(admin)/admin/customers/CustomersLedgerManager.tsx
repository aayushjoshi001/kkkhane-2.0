'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, Users, Download, Printer, HandCoins, TrendingUp, TrendingDown, ShieldAlert, Receipt, CreditCard, CheckCircle2, ChevronDown, ChevronUp, Info, Percent, Award
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
    createCustomerCreditAccountAction, updateCustomerCreditAccountAction, deleteCustomerCreditAccountAction,
    createReceivableTransactionAction, deleteReceivableTransactionAction, saveCustomerOpeningBalanceAction, getTransactionDetailsAction
} from '../finance/receivables/actions'
import Modal from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/utils'
import { downloadCsv, downloadExcel } from '@/lib/exportCsv'
import { downloadPdf } from '@/lib/exportPdf'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { CustomerCreditAccount, ReceivableTransaction, ReceivableTransactionType, ReceivableTransactionWithCreator } from '@/types/database'
import { bookingInvoiceNumber } from '@/lib/utils'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

/** A charge minted at hotel checkout embeds its booking id in the description
 *  JSON — see `settle_booking_checkout_v2` / `settle_booking_group_checkout`.
 *  Manual ledger entries and older transactions have neither, so this is
 *  best-effort: null just means "no bill number to show", not an error. */
function getChargeBookingId(descString: string): string | null {
    if (!descString?.startsWith('{')) return null
    try {
        const parsed = JSON.parse(descString)
        return typeof parsed.booking_id === 'string' ? parsed.booking_id : null
    } catch {
        return null
    }
}

interface CustomersLedgerManagerProps {
    initialAccounts: CustomerCreditAccount[]
    initialTransactions: ReceivableTransactionWithCreator[]
}

export default function CustomersLedgerManager({ initialAccounts, initialTransactions }: CustomersLedgerManagerProps) {
    const { confirm } = useConfirmStore()
    const [accounts, setAccounts] = useState<CustomerCreditAccount[]>(initialAccounts)
    const [transactions, setTransactions] = useState<ReceivableTransactionWithCreator[]>(initialTransactions)
    const formatDate = useDateFormatter()
    const [searchQuery, setSearchQuery] = useState('')
    const [directoryFilter, setDirectoryFilter] = useState<'due_credit' | 'crm_loyalty'>('due_credit')

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
    const [txnPaymentMethod, setTxnPaymentMethod] = useState<'cash' | 'bank_qr'>('cash')
    const [submittingTxn, setSubmittingTxn] = useState(false)
    const [activeLinkedChargeId, setActiveLinkedChargeId] = useState<string | null>(null)

    // Detailed Bill / Order Breakdown Modal state
    const [selectedTxnDetails, setSelectedTxnDetails] = useState<ReceivableTransaction | null>(null)
    const [fetchingTxnDetails, setFetchingTxnDetails] = useState(false)
    const [txnDetailData, setTxnDetailData] = useState<any>(null)

    // Optional breakdown fields in Record Transaction form
    const [showBreakdownFields, setShowBreakdownFields] = useState(false)
    const [bdSubtotal, setBdSubtotal] = useState('')
    const [bdDiscount, setBdDiscount] = useState('')
    const [bdServiceCharge, setBdServiceCharge] = useState('')
    const [bdTax, setBdTax] = useState('')
    const [bdPaymentMethod, setBdPaymentMethod] = useState('credit')

    const openTxnDetailsModal = async (txn: ReceivableTransaction) => {
        setSelectedTxnDetails(txn)
        setFetchingTxnDetails(true)
        setTxnDetailData(null)
        try {
            const res = await getTransactionDetailsAction(txn.id)
            if (res.data) {
                setTxnDetailData(res.data)
            }
        } catch {
            toast.error('Failed to load transaction breakdown details')
        } finally {
            setFetchingTxnDetails(false)
        }
    }

    const getCleanDescription = (descString: string) => {
        if (!descString) return '—'
        if (descString.startsWith('{')) {
            try {
                const parsed = JSON.parse(descString)
                return parsed.text_desc || parsed.text || 'Ledger Transaction'
            } catch {
                return descString
            }
        }
        return descString
    }

    // Opening balance modal state
    const [obModalOpen, setObModalOpen] = useState(false)
    const [obAmount, setObAmount] = useState('')
    const [obReason, setObReason] = useState('')
    const [isObEdit, setIsObEdit] = useState(false)
    const [submittingOb, setSubmittingOb] = useState(false)

    const handleOpenAddCustomerOb = () => {
        setObAmount('')
        setObReason('')
        setIsObEdit(false)
        setObModalOpen(true)
    }

    const handleOpenEditCustomerOb = (currentAmt: number) => {
        setObAmount(String(currentAmt))
        setObReason('')
        setIsObEdit(true)
        setObModalOpen(true)
    }

    const handleSaveCustomerOb = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ledgerAccount) return
        const amt = parseFloat(obAmount)
        if (isNaN(amt) || amt < 0) { toast.error('Opening balance amount must be non-negative'); return }
        if (isObEdit && !obReason.trim()) {
            toast.error('Reason for editing opening balance is required')
            return
        }

        setSubmittingOb(true)
        try {
            const res = await saveCustomerOpeningBalanceAction({
                customer_credit_account_id: ledgerAccount.id,
                amount: amt,
                reason: obReason.trim(),
                is_edit: isObEdit,
            })
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const newOrUpdated = { ...(res.data as ReceivableTransaction), created_by_name: null }
                setTransactions(prev => {
                    const filtered = prev.filter(t => t.id !== newOrUpdated.id)
                    return [newOrUpdated, ...filtered]
                })
                setObModalOpen(false)
                toast.success(isObEdit ? 'Opening balance updated' : 'Opening balance added')
            }
        } catch (err) {
            toast.error('Failed to save opening balance')
        } finally {
            setSubmittingOb(false)
        }
    }

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
                payment_method: txnPaymentMethod,
                linked_charge_id: activeLinkedChargeId || undefined,
                breakdown: showBreakdownFields ? {
                    subtotal: bdSubtotal ? parseFloat(bdSubtotal) : undefined,
                    discount: bdDiscount ? parseFloat(bdDiscount) : undefined,
                    service_charge: bdServiceCharge ? parseFloat(bdServiceCharge) : undefined,
                    tax: bdTax ? parseFloat(bdTax) : undefined,
                    payment_method: bdPaymentMethod,
                } : undefined,
            })
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const newTxn = { ...(res.data as ReceivableTransaction), created_by_name: null }
                setTransactions(prev => [newTxn, ...prev])
                setTxnModalOpen(false)
                setTxnType('charge')
                setTxnAmount('')
                setTxnDesc('')
                setActiveLinkedChargeId(null)
                setShowBreakdownFields(false)
                setBdSubtotal('')
                setBdDiscount('')
                setBdServiceCharge('')
                setBdTax('')
                setBdPaymentMethod('credit')
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

    const dueCreditTotals = useMemo(() => {
        let totalDue = 0
        let totalCharged = 0
        let totalPaid = 0
        let activeCount = 0

        for (const a of accounts) {
            const bal = accountBalances.get(a.id) ?? { paid: 0, due: 0 }
            const outstanding = Math.max(bal.due - bal.paid, 0)
            const hasActivity = bal.due > 0 || bal.paid > 0 || outstanding > 0 || Number(a.credit_limit || 0) > 0
            if (hasActivity) {
                activeCount++
                totalDue += outstanding
                totalCharged += bal.due
                totalPaid += bal.paid
            }
        }
        return { totalDue, totalCharged, totalPaid, activeCount }
    }, [accounts, accountBalances])

    const filteredAccounts = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        const list = accounts.filter(a => {
            const bal = accountBalances.get(a.id) ?? { paid: 0, due: 0 }
            const outstanding = Math.max(bal.due - bal.paid, 0)
            const hasActivity = bal.due > 0 || bal.paid > 0 || outstanding > 0 || Number(a.credit_limit || 0) > 0

            if (directoryFilter === 'due_credit' && !hasActivity) return false

            if (!q) return true
            return (
                a.customer_name.toLowerCase().includes(q) ||
                (a.customer_phone && a.customer_phone.includes(q))
            )
        })

        if (directoryFilter !== 'due_credit') return list

        // Outstanding-due accounts float to the top (highest due first); fully-settled credit accounts sink to the bottom.
        return [...list].sort((a, b) => {
            const balA = accountBalances.get(a.id) ?? { paid: 0, due: 0 }
            const balB = accountBalances.get(b.id) ?? { paid: 0, due: 0 }
            const outA = Math.max(balA.due - balA.paid, 0)
            const outB = Math.max(balB.due - balB.paid, 0)
            if (outA !== outB) return outB - outA
            return balB.paid - balA.paid
        })
    }, [accounts, searchQuery, directoryFilter, accountBalances])

    // Ledger statement transactions with running balance (charge increases what's owed, payment reduces it)
    const customerLedgerEntries = useMemo(() => {
        if (!ledgerAccount) return []
        const filtered = transactions.filter(t => t.customer_credit_account_id === ledgerAccount.id)

        // Separate Opening Balance to pin at Row #1 (Very Top)
        const obTxns = filtered.filter(t => t.description.toLowerCase().startsWith('opening balance'))
        const otherTxns = filtered.filter(t => !t.description.toLowerCase().startsWith('opening balance'))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        const ordered = [...obTxns, ...otherTxns]

        let cumulativeBalance = 0
        const mapped = ordered.map(t => {
            cumulativeBalance += t.type === 'charge' ? t.amount : -t.amount
            return { ...t, runningBalance: cumulativeBalance }
        })
        return mapped
    }, [ledgerAccount, transactions])

    const totalCharged = useMemo(() => customerLedgerEntries.reduce((sum, t) => sum + (t.type === 'charge' ? t.amount : 0), 0), [customerLedgerEntries])
    const totalCollected = useMemo(() => customerLedgerEntries.reduce((sum, t) => sum + (t.type === 'payment' ? t.amount : 0), 0), [customerLedgerEntries])
    const outstandingBalance = useMemo(() => customerLedgerEntries[customerLedgerEntries.length - 1]?.runningBalance ?? 0, [customerLedgerEntries])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'bill_no', label: 'Bill No.' },
        { key: 'type', label: 'Type' },
        { key: 'description', label: 'Description' },
        { key: 'responsible', label: 'Responsible Person' },
        { key: 'due', label: 'Due', align: 'right' as const },
        { key: 'paid', label: 'Paid', align: 'right' as const },
        { key: 'running_balance', label: 'Running Balance', align: 'right' as const },
    ]
    const reportRows = customerLedgerEntries.map(t => {
        const bookingId = getChargeBookingId(t.description)
        return {
            date: formatDate(t.created_at),
            bill_no: bookingId ? bookingInvoiceNumber(bookingId) : '—',
            type: t.type === 'charge' ? 'Charge' : 'Payment Collected',
            description: getCleanDescription(t.description),
            responsible: t.created_by_name || '—',
            due: t.type === 'charge' ? formatCurrency(t.amount) : '',
            paid: t.type === 'payment' ? formatCurrency(t.amount) : '',
            running_balance: formatCurrency(t.runningBalance),
        }
    })
    const existingObTxn = useMemo(() => {
        return customerLedgerEntries.find(t => t.description.toLowerCase().startsWith('opening balance'))
    }, [customerLedgerEntries])

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

                {/* ── Two Separate Section Cards / Boxes ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Box 1: Due & Credit Activities (Selected By Default!) */}
                    <div
                        onClick={() => setDirectoryFilter('due_credit')}
                        className={`p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                            directoryFilter === 'due_credit'
                                ? 'bg-surface border-rose-500 shadow-md ring-2 ring-rose-500/20'
                                : 'bg-surface/60 border-hairline hover:bg-surface hover:border-hairline-strong'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${directoryFilter === 'due_credit' ? 'bg-rose-50 text-rose-600' : 'bg-surface-muted text-ink-subtle'}`}>
                                    <Receipt size={20} />
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-base text-ink">Due & Credit Activities</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">Active customer balances, credit charges & payments</p>
                                </div>
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-black ${directoryFilter === 'due_credit' ? 'bg-rose-100 text-rose-700' : 'bg-surface-muted text-ink-subtle'}`}>
                                {dueCreditTotals.activeCount} Accounts
                            </span>
                        </div>
                        <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between text-xs">
                            <span className="font-bold text-ink-subtle">Total Outstanding Due:</span>
                            <span className="font-black text-rose-600 text-sm">{formatCurrency(dueCreditTotals.totalDue)}</span>
                        </div>
                    </div>

                    {/* Box 2: CRM & Loyalty Directory */}
                    <div
                        onClick={() => setDirectoryFilter('crm_loyalty')}
                        className={`p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                            directoryFilter === 'crm_loyalty'
                                ? 'bg-surface border-brand-500 shadow-md ring-2 ring-brand-500/20'
                                : 'bg-surface/60 border-hairline hover:bg-surface hover:border-hairline-strong'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${directoryFilter === 'crm_loyalty' ? 'bg-brand-50 text-brand-600' : 'bg-surface-muted text-ink-subtle'}`}>
                                    <Award size={20} />
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-base text-ink">CRM & Loyalty Directory</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">All registered customer profiles & 5% loyalty points</p>
                                </div>
                            </div>
                            <span className={`px-2.5 py-1 rounded-full text-xs font-black ${directoryFilter === 'crm_loyalty' ? 'bg-brand-100 text-brand-700' : 'bg-surface-muted text-ink-subtle'}`}>
                                {accounts.length} Profiles
                            </span>
                        </div>
                        <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between text-xs">
                            <span className="font-bold text-ink-subtle">Total Registered Profiles:</span>
                            <span className="font-black text-ink text-sm">{accounts.length} Registered</span>
                        </div>
                    </div>
                </div>

                <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-hairline bg-surface-muted/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <p className="text-xs font-black text-ink uppercase tracking-wider whitespace-nowrap">
                                {directoryFilter === 'due_credit' ? 'Due & Credit Accounts' : 'CRM & Loyalty Customers'} ({filteredAccounts.length})
                            </p>
                        </div>
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
                <div className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-[96vw] 2xl:max-w-7xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4.5 border-b border-hairline bg-surface-muted/50 flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 pr-2">
                                <span className="text-[10px] font-black uppercase text-brand-600 tracking-wider block">Customer Account Statement</span>
                                <h2 className="text-xl sm:text-2xl font-extrabold text-ink mt-0.5 truncate">{ledgerAccount.customer_name}</h2>
                                <p className="text-xs sm:text-sm text-ink-subtle mt-0.5 truncate font-semibold">
                                    {[ledgerAccount.customer_phone && `Phone: ${ledgerAccount.customer_phone}`, `Credit Limit: ${formatCurrency(ledgerAccount.credit_limit)}`].filter(Boolean).join(' | ')}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {customerLedgerEntries.length > 0 && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            onClick={handleExportCsv}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all whitespace-nowrap"
                                        >
                                            <Download size={13} /> CSV
                                        </button>
                                        <button
                                            onClick={handleExportExcel}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all whitespace-nowrap"
                                        >
                                            <Download size={13} /> Excel
                                        </button>
                                        <button
                                            onClick={handleExportPdf}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all whitespace-nowrap"
                                        >
                                            <Download size={13} /> PDF
                                        </button>
                                        <button
                                            onClick={() => printRef.current?.print()}
                                            className="flex items-center gap-1 px-3 py-1.5 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all whitespace-nowrap"
                                        >
                                            <Printer size={13} /> Print
                                        </button>
                                    </div>
                                )}
                                {existingObTxn ? (
                                    <button
                                        onClick={() => handleOpenEditCustomerOb(existingObTxn.amount)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold border border-amber-200 rounded-xl text-xs transition-all whitespace-nowrap"
                                        title="Edit Opening Balance (requires reason)"
                                    >
                                        <Edit2 size={13} /> Edit Opening Balance ({formatCurrency(existingObTxn.amount)})
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleOpenAddCustomerOb}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold border border-emerald-200 rounded-xl text-xs transition-all whitespace-nowrap"
                                    >
                                        <Plus size={13} /> Add Opening Balance
                                    </button>
                                )}
                                <button
                                    onClick={() => setTxnModalOpen(true)}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-colors whitespace-nowrap"
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
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Charged</p>
                                <p className="text-xl font-black text-ink mt-1">{formatCurrency(totalCharged)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Collected</p>
                                <p className="text-xl font-black text-emerald-600 mt-1">{formatCurrency(totalCollected)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Outstanding Balance</p>
                                <p className="text-xl font-black text-rose-600 mt-1">{formatCurrency(outstandingBalance)}</p>
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
                                    <table className="w-full text-left text-xs sm:text-sm border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                                <th className="px-5 py-3.5 font-extrabold">Date</th>
                                                <th className="px-5 py-3.5 font-extrabold w-40">Bill No.</th>
                                                <th className="px-5 py-3.5 font-extrabold text-center w-36">Type</th>
                                                <th className="px-5 py-3.5 font-extrabold">Description</th>
                                                <th className="px-5 py-3.5 font-extrabold w-40">Responsible Person</th>
                                                <th className="px-5 py-3.5 font-extrabold text-right w-32 text-rose-500">Due</th>
                                                <th className="px-5 py-3.5 font-extrabold text-right w-32 text-emerald-600">Paid</th>
                                                <th className="px-5 py-3.5 font-extrabold text-right w-36 bg-surface-muted/50">Running Balance</th>
                                                <th className="px-5 py-3.5 font-extrabold text-center w-14"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {customerLedgerEntries.map(t => (
                                                <tr key={t.id} className="hover:bg-surface-muted/50 transition-colors">
                                                    <td className="px-4 py-3 text-ink-subtle font-semibold"><DateCell value={t.created_at} /></td>
                                                    <td className="px-4 py-3 font-semibold">
                                                        {(() => {
                                                            const bookingId = getChargeBookingId(t.description)
                                                            if (!bookingId) return <span className="text-ink-subtle">—</span>
                                                            return (
                                                                <Link
                                                                    href={`/admin/bookings?booking=${bookingId}`}
                                                                    className="text-brand-600 hover:text-brand-700 hover:underline"
                                                                    title="Open this stay's full bill"
                                                                >
                                                                    {bookingInvoiceNumber(bookingId)}
                                                                </Link>
                                                            )
                                                        })()}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${t.type === 'charge' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                            {t.type === 'charge' ? 'Charge' : 'Payment'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-ink max-w-xs sm:max-w-sm md:max-w-md break-words whitespace-normal">
                                                        {getCleanDescription(t.description)}
                                                    </td>
                                                    <td className="px-4 py-3 text-ink-subtle font-semibold">{t.created_by_name || '—'}</td>
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
                                {txnType === 'payment' && (
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Payment Method *</label>
                                        <Select
                                            value={txnPaymentMethod}
                                            onChange={e => setTxnPaymentMethod(e.target.value as 'cash' | 'bank_qr')}
                                            required
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        >
                                            <option value="cash">Cash (Add to Cash In)</option>
                                            <option value="bank_qr">Bank / QR Digital (Add to Bank In)</option>
                                        </Select>
                                    </div>
                                )}
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

                                {/* Optional Breakdown Fields Toggle */}
                                <div className="border-t border-hairline pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowBreakdownFields(prev => !prev)}
                                        className="text-xs font-extrabold text-brand-600 hover:text-brand-700 flex items-center gap-1.5"
                                    >
                                        {showBreakdownFields ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        {showBreakdownFields ? 'Hide Itemized Bill Breakdown' : '+ Add Itemized Bill Breakdown (Discount, Service Charge, Tax, Payment Mode)'}
                                    </button>

                                    {showBreakdownFields && (
                                        <div className="mt-3 p-3.5 bg-surface-muted/60 border border-hairline rounded-xl space-y-3 animate-fade-in">
                                            <div className="grid grid-cols-2 gap-2.5">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Subtotal (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={bdSubtotal}
                                                        onChange={e => setBdSubtotal(e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Discount Given (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={bdDiscount}
                                                        onChange={e => setBdDiscount(e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Service Charge (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={bdServiceCharge}
                                                        onChange={e => setBdServiceCharge(e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Tax / VAT (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="0.00"
                                                        value={bdTax}
                                                        onChange={e => setBdTax(e.target.value)}
                                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink"
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Payment Method Mode</label>
                                                <Select
                                                    value={bdPaymentMethod}
                                                    onChange={e => setBdPaymentMethod(e.target.value)}
                                                    className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink"
                                                >
                                                    <option value="credit">Credit (Unpaid)</option>
                                                    <option value="cash">Cash Payment</option>
                                                    <option value="qr">QR Code (Digital / Fonepay)</option>
                                                    <option value="card">Card Payment</option>
                                                    <option value="bank_transfer">Bank Transfer</option>
                                                </Select>
                                            </div>
                                        </div>
                                    )}
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

            {/* ── FAIR TRANSACTION / BILL BREAKDOWN MODAL ── */}
            {selectedTxnDetails && (
                <Modal
                    open
                    onClose={() => setSelectedTxnDetails(null)}
                    size="lg"
                    ariaLabel="Transaction & Bill History Details"
                    className="bg-surface overflow-hidden"
                >
                    <div className="p-6 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0 pr-3">
                            <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                                <Receipt size={20} className="text-brand-500" />
                            </div>
                            <div className="min-w-0">
                                <span className="text-[10px] font-black uppercase text-brand-600 tracking-wider block">Fair Transaction & Bill History</span>
                                <h3 className="text-base sm:text-lg font-extrabold text-ink leading-snug break-words">
                                    {getCleanDescription(selectedTxnDetails.description)}
                                </h3>
                            </div>
                        </div>
                        <button
                            onClick={() => setSelectedTxnDetails(null)}
                            className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink transition-colors shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
                        {fetchingTxnDetails ? (
                            <div className="py-12 text-center text-ink-subtle space-y-2">
                                <Loader2 size={28} className="animate-spin mx-auto text-brand-500" />
                                <p className="text-xs font-bold">Fetching bill details & order history...</p>
                            </div>
                        ) : (
                            (() => {
                                const meta = txnDetailData?.parsedMeta || {}
                                const order = txnDetailData?.orderData || null
                                const booking = txnDetailData?.bookingData || null
                                const items = (txnDetailData?.finalItems && txnDetailData.finalItems.length > 0)
                                    ? txnDetailData.finalItems
                                    : (txnDetailData?.orderItems || [])

                                const subtotal = Number(order?.subtotal_amount ?? meta.subtotal ?? selectedTxnDetails.amount)
                                const discount = Number(order?.discount_amount ?? meta.discount ?? 0)
                                const roomDiscount = Number(meta.room_discount ?? (meta.food_discount ? Math.max(0, discount - meta.food_discount) : discount))
                                const foodDiscount = Number(meta.food_discount ?? 0)
                                const advancePaid = Number(meta.advance_paid ?? 0)
                                const advanceNotes = meta.advance_notes || booking?.advance_note || ''
                                const serviceCharge = Number(order?.service_charge_amount ?? meta.service_charge ?? 0)
                                const tax = Number(order?.tax_amount ?? meta.tax ?? 0)
                                const grandTotal = Number(order?.total_amount ?? meta.grand_total ?? Math.max(0, subtotal - discount))
                                const paidAmount = meta.paid_amount ?? (selectedTxnDetails.type === 'payment' ? selectedTxnDetails.amount : 0)
                                const payMethod = order?.payment_method || meta.payment_method || (selectedTxnDetails.type === 'payment' ? 'cash' : 'credit')

                                const stayCost = Number(meta.stay_cost ?? 0)
                                const foodCost = Number(meta.food_cost ?? 0)
                                const billPaymentsCollected = Number(meta.payments_collected_for_bill ?? 0)
                                const billPaymentHistory = (meta.bill_payment_history as Array<any>) || []
                                const netBilled = Number(selectedTxnDetails.amount)
                                const remainingBillDue = Number(meta.remaining_bill_due ?? Math.max(0, netBilled - billPaymentsCollected))

                                return (
                                    <div className="space-y-5">
                                        {/* Basic Metadata Header Cards */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            <div className="p-3 bg-surface-muted/50 border border-hairline rounded-xl min-w-0 overflow-hidden flex flex-col justify-between">
                                                <span className="text-[9px] font-black uppercase text-ink-subtle block tracking-wider truncate">Transaction Type</span>
                                                <div className="mt-1">
                                                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${selectedTxnDetails.type === 'charge' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        {selectedTxnDetails.type === 'charge' ? 'Charge' : 'Payment'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-3 bg-surface-muted/50 border border-hairline rounded-xl min-w-0 overflow-hidden flex flex-col justify-between">
                                                <span className="text-[9px] font-black uppercase text-ink-subtle block tracking-wider truncate">Date & Time</span>
                                                <p className="text-xs font-bold text-ink mt-1 truncate">{new Date(selectedTxnDetails.created_at).toLocaleString()}</p>
                                            </div>
                                            <div className="p-3 bg-surface-muted/50 border border-hairline rounded-xl min-w-0 overflow-hidden flex flex-col justify-between">
                                                <span className="text-[9px] font-black uppercase text-ink-subtle block tracking-wider truncate">Transaction Amount</span>
                                                <p className="text-sm font-black text-rose-600 mt-1 truncate">{formatCurrency(selectedTxnDetails.amount)}</p>
                                            </div>
                                            <div className="p-3 bg-surface-muted/50 border border-hairline rounded-xl min-w-0 overflow-hidden flex flex-col justify-between">
                                                <span className="text-[9px] font-black uppercase text-ink-subtle block tracking-wider truncate">Payment Status</span>
                                                <p className="text-xs font-bold text-ink mt-1 truncate">
                                                    {remainingBillDue === 0 ? (
                                                        <span className="text-emerald-600 font-extrabold flex items-center gap-1"><CheckCircle2 size={12} /> Fully Settled</span>
                                                    ) : billPaymentsCollected > 0 ? (
                                                        <span className="text-amber-600 font-extrabold">Partially Paid</span>
                                                    ) : (
                                                        <span className="text-rose-600 font-extrabold">Unpaid Credit</span>
                                                    )}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Description Header */}
                                        <div className="p-4 bg-surface-muted/30 border border-hairline rounded-xl">
                                            <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider block mb-1">Description</span>
                                            <p className="text-sm font-extrabold text-ink leading-relaxed break-words">
                                                {getCleanDescription(selectedTxnDetails.description)}
                                            </p>
                                        </div>

                                        {/* Itemized Order & Stay Bill Breakdown Table */}
                                        <div>
                                            <h4 className="text-xs font-extrabold text-ink uppercase tracking-wider mb-2 flex items-center justify-between">
                                                <span>Itemized Bill Items</span>
                                                <span className="text-[10px] font-bold text-ink-subtle">{items.length} Line Item(s)</span>
                                            </h4>
                                            <div className="border border-hairline rounded-xl overflow-hidden">
                                                <table className="w-full text-left text-xs border-collapse">
                                                    <thead>
                                                        <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                                            <th className="px-4 py-2.5 font-bold">Item / Service Description</th>
                                                            <th className="px-4 py-2.5 font-bold text-center w-20">Qty</th>
                                                            <th className="px-4 py-2.5 font-bold text-right w-28">Rate</th>
                                                            <th className="px-4 py-2.5 font-bold text-right w-28">Amount</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-hairline">
                                                        {items.map((it: any, idx: number) => {
                                                            const qty = Number(it.quantity || 1)
                                                            const price = Number(it.unit_price || it.rate || 0)
                                                            const lineTotal = qty * price
                                                            return (
                                                                <tr key={idx} className="hover:bg-surface-muted/30">
                                                                    <td className="px-4 py-2.5 font-bold text-ink">{it.name || it.item_name || 'Bill Item'}</td>
                                                                    <td className="px-4 py-2.5 text-center font-bold text-ink-subtle">{qty}</td>
                                                                    <td className="px-4 py-2.5 text-right font-medium text-ink-subtle">{formatCurrency(price)}</td>
                                                                    <td className="px-4 py-2.5 text-right font-extrabold text-ink">{formatCurrency(lineTotal)}</td>
                                                                </tr>
                                                            )
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Bill Calculation Breakdown */}
                                        <div className="bg-surface-muted/30 border border-hairline rounded-xl p-4 space-y-3">
                                            <h4 className="text-xs font-extrabold text-ink uppercase tracking-wider border-b border-hairline pb-2">
                                                Bill Calculation Breakdown
                                            </h4>
                                            <div className="space-y-2 text-xs">
                                                {stayCost > 0 && (
                                                    <div className="flex items-center justify-between text-ink-subtle font-medium">
                                                        <span>Room Lodging Charge</span>
                                                        <span className="font-bold text-ink">{formatCurrency(stayCost)}</span>
                                                    </div>
                                                )}

                                                {foodCost > 0 && (
                                                    <div className="flex items-center justify-between text-ink-subtle font-medium">
                                                        <span>Food & Beverage Orders</span>
                                                        <span className="font-bold text-ink">{formatCurrency(foodCost)}</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between text-ink-subtle font-semibold border-t border-hairline/60 pt-1.5">
                                                    <span>Subtotal Amount (Whole Bill)</span>
                                                    <span className="font-bold text-ink">{formatCurrency(subtotal)}</span>
                                                </div>

                                                {/* Itemized Room Stay Discount */}
                                                {roomDiscount > 0 && (
                                                    <div className="flex flex-col gap-0.5 text-amber-800 font-bold bg-amber-50/80 p-2.5 rounded-xl border border-amber-200">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                                                                <Percent size={13} className="text-amber-600" />
                                                                Room Stay Discount (-)
                                                            </span>
                                                            <span className="text-xs font-black text-rose-600">- {formatCurrency(roomDiscount)}</span>
                                                        </div>
                                                        {(booking?.discount_reason || meta.discount_reason) && (
                                                            <p className="text-[10px] text-amber-700/80 font-semibold italic mt-0.5">
                                                                Reason: {booking?.discount_reason || meta.discount_reason}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Itemized Food & Beverage Discount */}
                                                {foodDiscount > 0 && (
                                                    <div className="flex flex-col gap-0.5 text-orange-800 font-bold bg-orange-50/80 p-2.5 rounded-xl border border-orange-200">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                                                                <Percent size={13} className="text-orange-600" />
                                                                Food & Beverage Discount (-)
                                                            </span>
                                                            <span className="text-xs font-black text-rose-600">- {formatCurrency(foodDiscount)}</span>
                                                        </div>
                                                        {(booking?.discount_reason || meta.discount_reason) && (
                                                            <p className="text-[10px] text-orange-700/80 font-semibold italic mt-0.5">
                                                                Reason: {booking?.discount_reason || meta.discount_reason}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                {roomDiscount === 0 && foodDiscount === 0 && discount === 0 && (
                                                    <div className="flex items-center justify-between text-ink-subtle text-[11px] font-semibold bg-surface-muted/30 px-2.5 py-1.5 rounded-lg border border-hairline">
                                                        <span>Discount Status:</span>
                                                        <span className="font-bold text-ink-muted">No Discount Applied (Rs. 0.00)</span>
                                                    </div>
                                                )}

                                                {advancePaid > 0 && (
                                                    <div className="flex flex-col gap-0.5 text-emerald-800 font-bold bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200">
                                                        <div className="flex items-center justify-between">
                                                            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                                                                <HandCoins size={13} className="text-emerald-600" />
                                                                Advance Paid (-)
                                                            </span>
                                                            <span className="text-xs font-black text-emerald-700">- {formatCurrency(advancePaid)}</span>
                                                        </div>
                                                        {advanceNotes && (
                                                            <p className="text-[10px] text-emerald-700/80 font-semibold italic mt-0.5">
                                                                Note: {advanceNotes}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                {serviceCharge > 0 && (
                                                    <div className="flex items-center justify-between text-ink-subtle font-semibold">
                                                        <span>Service Charge (+)</span>
                                                        <span>{formatCurrency(serviceCharge)}</span>
                                                    </div>
                                                )}

                                                {tax > 0 && (
                                                    <div className="flex items-center justify-between text-ink-subtle font-semibold">
                                                        <span>VAT / Tax (+)</span>
                                                        <span>{formatCurrency(tax)}</span>
                                                    </div>
                                                )}

                                                <div className="border-t border-hairline pt-2 flex items-center justify-between text-sm font-extrabold text-ink">
                                                    <span>Grand Total Bill</span>
                                                    <span className="text-base font-black text-brand-600">{formatCurrency(grandTotal)}</span>
                                                </div>

                                                <div className="flex items-center justify-between text-xs font-extrabold text-rose-600 border-t border-dashed border-hairline pt-2">
                                                    <span>Original Net Credit Billed</span>
                                                    <span className="text-sm font-black">{formatCurrency(netBilled)}</span>
                                                </div>

                                                {/* Render Previous Payments Collected against this Specific Bill */}
                                                {billPaymentsCollected > 0 && (
                                                    <div className="space-y-1.5 pt-2 border-t border-hairline">
                                                        <div className="flex items-center justify-between text-xs font-extrabold text-emerald-800 bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200">
                                                            <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider">
                                                                <CheckCircle2 size={13} className="text-emerald-600" />
                                                                Payments Received for this Bill (-)
                                                            </span>
                                                            <span className="text-xs font-black text-emerald-700">- {formatCurrency(billPaymentsCollected)}</span>
                                                        </div>

                                                        {billPaymentHistory.map((p, idx) => (
                                                            <div key={p.id || idx} className="flex items-center justify-between text-[11px] text-emerald-700/90 font-bold px-3 py-1 bg-emerald-50/40 rounded-lg border border-emerald-100">
                                                                <span>Payment #{idx + 1} ({new Date(p.created_at).toLocaleDateString()}) - {p.payment_method?.toUpperCase() || 'CASH'}</span>
                                                                <span className="font-black text-emerald-800">- {formatCurrency(p.amount)}</span>
                                                            </div>
                                                        ))}

                                                        <div className="flex items-center justify-between text-xs font-extrabold text-rose-700 bg-rose-50/50 p-2.5 rounded-xl border border-rose-200 mt-1">
                                                            <span>Remaining Outstanding Due for this Bill</span>
                                                            <span className="text-sm font-black text-rose-700">{formatCurrency(remainingBillDue)}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {selectedTxnDetails.type === 'charge' && (
                                                    <div className="pt-3 border-t border-hairline mt-2">
                                                        {remainingBillDue > 0 ? (
                                                            <div className="flex items-center justify-between gap-3 bg-emerald-50/70 p-3 rounded-xl border border-emerald-200">
                                                                <div>
                                                                    <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">Unpaid Balance Remaining</p>
                                                                    <p className="text-xs text-emerald-700 font-bold">Remaining Due: <span className="font-extrabold text-emerald-900">{formatCurrency(remainingBillDue)}</span></p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const cleanDesc = getCleanDescription(selectedTxnDetails.description)
                                                                        setActiveLinkedChargeId(selectedTxnDetails.id)
                                                                        setSelectedTxnDetails(null)
                                                                        setTxnType('payment')
                                                                        setTxnAmount(String(remainingBillDue))
                                                                        setTxnDesc(`Payment for ${cleanDesc}`)
                                                                        setTxnModalOpen(true)
                                                                    }}
                                                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-md hover:shadow-lg transition-all shrink-0 cursor-pointer"
                                                                >
                                                                    <HandCoins size={14} />
                                                                    Pay Now (Settle Rs. {formatCurrency(remainingBillDue)})
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center justify-center gap-2 bg-emerald-100/70 p-3 rounded-xl border border-emerald-300 text-emerald-900 font-black text-xs">
                                                                <CheckCircle2 size={16} className="text-emerald-700" />
                                                                This Credit Bill is Fully Paid & Settled ({formatCurrency(netBilled)})
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })()
                        )}
                    </div>
                </Modal>
            )}

            {/* ── CUSTOMER OPENING BALANCE MODAL ── */}
            {obModalOpen && ledgerAccount && (
                <Modal open onClose={() => setObModalOpen(false)} size="md" ariaLabel={isObEdit ? "Edit Opening Balance" : "Add Opening Balance"} className="bg-surface overflow-hidden">
                    <div className="p-5 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                        <div>
                            <h3 className="font-extrabold text-ink text-sm flex items-center gap-2">
                                {isObEdit ? <Edit2 size={16} className="text-amber-500" /> : <Plus size={16} className="text-emerald-500" />}
                                {isObEdit ? `Edit Opening Balance for ${ledgerAccount.customer_name}` : `Add Opening Balance for ${ledgerAccount.customer_name}`}
                            </h3>
                            <p className="text-[10px] text-ink-subtle mt-0.5">
                                {isObEdit ? 'A reason is required before editing an existing opening balance.' : 'Set the initial outstanding balance for this customer.'}
                            </p>
                        </div>
                        <button 
                            onClick={() => setObModalOpen(false)}
                            className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink-subtle transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    
                    <form onSubmit={handleSaveCustomerOb} className="p-5 space-y-4">
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Opening Balance Amount (Rs.) *</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={obAmount}
                                onChange={e => setObAmount(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                {isObEdit ? 'Reason for Editing *' : 'Note / Reference (Optional)'}
                            </label>
                            <textarea
                                placeholder={isObEdit ? 'State the reason for modifying the opening balance...' : 'e.g. Previous pending ledger balance'}
                                value={obReason}
                                onChange={e => setObReason(e.target.value)}
                                required={isObEdit}
                                rows={3}
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-semibold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-sm"
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
                                isObEdit ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/15' : 'bg-brand-500 hover:bg-brand-600 shadow-brand-500/15'
                            }`}
                        >
                            {submittingOb ? <Loader2 size={16} className="animate-spin" /> : isObEdit ? <Edit2 size={16} /> : <Plus size={16} />}
                            {isObEdit ? 'Save Changes with Reason' : 'Save Opening Balance'}
                        </button>
                    </form>
                </Modal>
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
