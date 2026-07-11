'use client'

import { useState, useMemo, useRef } from 'react'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, DollarSign, Truck, Tag,
    Download, Printer, Banknote
} from 'lucide-react'
import { createSupplierAction, updateSupplierAction, deleteSupplierAction, createSupplierBillAction, paySupplierBillAction } from './actions'
import { createCategoryAction } from '../income-expenses/actions'
import { toast } from 'react-hot-toast'
import { formatCurrency, parseExpenseDescription } from '@/lib/utils'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'

interface Supplier {
    id: string
    name: string
    phone: string | null
    address: string | null
    contact_person: string | null // Holds JSON { pan: string, vat: string }
    created_at: string
}

interface Expense {
    id: string
    amount: number
    description: string
    vendor_name: string | null
    created_at: string
    expense_categories: { name: string } | null
    bank_accounts: { name: string } | null
}

interface SuppliersLedgerManagerProps {
    initialSuppliers: Supplier[]
    expenses: Expense[]
    expenseCategories: Array<{ id: string; name: string }>
    bankAccounts: Array<{ id: string; name: string; bank_name: string | null; account_number: string | null }>
}

export default function SuppliersLedgerManager({
    initialSuppliers,
    expenses,
    expenseCategories,
    bankAccounts
}: SuppliersLedgerManagerProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
    const [expensesList, setExpensesList] = useState<Expense[]>(expenses)
    const [expenseCategoriesList, setExpenseCategoriesList] = useState(expenseCategories)
    const formatDate = useDateFormatter()
    const [searchQuery, setSearchQuery] = useState('')

    // Form modals
    const [modalOpen, setModalOpen] = useState<'create' | 'edit' | null>(null)
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

    // Form fields
    const [name, setName] = useState('')
    const [phone, setPhone] = useState('')
    const [pan, setPan] = useState('')
    const [vat, setVat] = useState('')
    const [address, setAddress] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // View Ledger Statement state
    const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null)

    // Record Bill Form fields
    const [billModalOpen, setBillModalOpen] = useState(false)
    const [billDesc, setBillDesc] = useState('')
    const [billQty, setBillQty] = useState('')
    const [billRate, setBillRate] = useState('')
    const [billUnit, setBillUnit] = useState('kg')
    const [billCategory, setBillCategory] = useState('')
    const [billPaidAmount, setBillPaidAmount] = useState('')
    const [billPaymentSource, setBillPaymentSource] = useState<'cash' | 'bank'>('cash')
    const [billBankName, setBillBankName] = useState('')
    const [submittingBill, setSubmittingBill] = useState(false)

    // Inline Category Creator inside Record Bill
    const [showNewCatForm, setShowNewCatForm] = useState(false)
    const [newCatName, setNewCatName] = useState('')
    const [newCatDesc, setNewCatDesc] = useState('')
    const [submittingCat, setSubmittingCat] = useState(false)

    // Pay Outstanding Bill state — settles part or all of a bill's owed
    // balance on a later date without moving the original purchase date.
    const [payTarget, setPayTarget] = useState<{ id: string; owed: number; text_desc: string } | null>(null)
    const [payAmount, setPayAmount] = useState('')
    const [payPaymentSource, setPayPaymentSource] = useState<'cash' | 'bank'>('cash')
    const [payBankName, setPayBankName] = useState('')
    const [submittingPay, setSubmittingPay] = useState(false)

    // Open add modal
    const openAddModal = () => {
        setName('')
        setPhone('')
        setPan('')
        setVat('')
        setAddress('')
        setModalOpen('create')
    }

    // Open edit modal
    const openEditModal = (supplier: Supplier) => {
        let parsed = { pan: '', vat: '' }
        try {
            parsed = JSON.parse(supplier.contact_person || '{}')
        } catch {
            // fallback
        }
        setSelectedSupplier(supplier)
        setName(supplier.name)
        setPhone(supplier.phone || '')
        setPan(parsed.pan || '')
        setVat(parsed.vat || '')
        setAddress(supplier.address || '')
        setModalOpen('edit')
    }

    // Handle submit
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { toast.error('Supplier name is required'); return }
        if (!phone.trim()) { toast.error('Phone number is required'); return }

        setSubmitting(true)
        try {
            if (modalOpen === 'create') {
                const res = await createSupplierAction({
                    name: name.trim(),
                    phone: phone.trim(),
                    pan: pan.trim(),
                    vat: vat.trim(),
                    address: address.trim()
                })
                if (res.error) {
                    toast.error(res.error)
                } else if (res.data) {
                    setSuppliers(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
                    setModalOpen(null)
                    toast.success('Supplier created successfully!')
                }
            } else if (modalOpen === 'edit' && selectedSupplier) {
                const res = await updateSupplierAction(selectedSupplier.id, {
                    name: name.trim(),
                    phone: phone.trim(),
                    pan: pan.trim(),
                    vat: vat.trim(),
                    address: address.trim()
                })
                if (res.error) {
                    toast.error(res.error)
                } else if (res.data) {
                    setSuppliers(prev => prev.map(s => s.id === selectedSupplier.id ? res.data : s))
                    setModalOpen(null)
                    toast.success('Supplier updated successfully!')
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred')
        } finally {
            setSubmitting(false)
        }
    }

    // Handle delete supplier
    const handleDelete = async (id: string, sName: string) => {
        if (!confirm(`Are you sure you want to delete the supplier "${sName}"?`)) return

        try {
            const res = await deleteSupplierAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                setSuppliers(prev => prev.filter(s => s.id !== id))
                if (ledgerSupplier?.id === id) setLedgerSupplier(null)
                toast.success('Supplier deleted')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete')
        }
    }

    // Inline Category Submit
    const handleAddCategory = async (e: React.MouseEvent) => {
        e.preventDefault()
        const nameVal = newCatName.trim()
        if (!nameVal) return

        setSubmittingCat(true)
        try {
            const res = await createCategoryAction(nameVal, 'expense', newCatDesc.trim())
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                setExpenseCategoriesList(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
                setBillCategory(res.data.id)
                setNewCatName('')
                setNewCatDesc('')
                setShowNewCatForm(false)
                toast.success('Category created and selected!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create category')
        } finally {
            setSubmittingCat(false)
        }
    }

    // Handle Record Bill Submit
    const handleRecordBill = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ledgerSupplier) return
        const qty = parseFloat(billQty)
        const rate = parseFloat(billRate)
        const paid = parseFloat(billPaidAmount || '0')

        if (!billCategory) { toast.error('Category is required'); return }
        if (!billDesc.trim()) { toast.error('Description is required'); return }
        if (isNaN(qty) || qty <= 0) { toast.error('Quantity must be positive'); return }
        if (isNaN(rate) || rate <= 0) { toast.error('Rate must be positive'); return }
        if (isNaN(paid) || paid < 0) { toast.error('Paid amount cannot be negative'); return }

        const totalAmt = qty * rate
        if (paid > totalAmt) {
            toast.error('Paid amount cannot exceed total bill amount')
            return
        }
        if (billPaymentSource === 'bank' && !billBankName.trim()) {
            toast.error('Bank Name is required for Bank payments')
            return
        }

        setSubmittingBill(true)
        try {
            const res = await createSupplierBillAction({
                supplier_name: ledgerSupplier.name,
                category_id: billCategory,
                text_desc: billDesc.trim(),
                quantity: qty,
                rate,
                unit: billUnit,
                amount: totalAmt,
                paid_amount: paid,
                payment_source: billPaymentSource,
                bank_name: billPaymentSource === 'bank' ? billBankName.trim() : undefined
            })

            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const categoryObj = expenseCategoriesList.find(c => c.id === billCategory)
                const newEntry: Expense = {
                    ...res.data,
                    expense_categories: categoryObj ? { name: categoryObj.name } : null
                }
                setExpensesList(prev => [newEntry, ...prev])
                setBillModalOpen(false)
                setBillDesc('')
                setBillQty('')
                setBillRate('')
                setBillUnit('kg')
                setBillCategory('')
                setBillPaidAmount('')
                setBillPaymentSource('cash')
                setBillBankName('')
                toast.success('Bill logged successfully!')
                if ('warning' in res && res.warning) toast.error(res.warning)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to record bill')
        } finally {
            setSubmittingBill(false)
        }
    }

    // Handle Pay Outstanding Bill Submit — settles part or all of the owed
    // balance today, leaving the bill's own date (day of purchase) untouched.
    const handlePaySubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!payTarget) return
        const amount = parseFloat(payAmount)

        if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid payment amount'); return }
        if (amount > payTarget.owed) { toast.error(`Payment cannot exceed the outstanding balance (${formatCurrency(payTarget.owed)})`); return }
        if (payPaymentSource === 'bank' && !payBankName.trim()) { toast.error('Bank Name is required for Bank payments'); return }

        setSubmittingPay(true)
        try {
            const res = await paySupplierBillAction({
                expense_id: payTarget.id,
                amount,
                payment_source: payPaymentSource,
                bank_name: payPaymentSource === 'bank' ? payBankName.trim() : undefined
            })

            if (res.error) {
                toast.error(res.error)
            } else {
                setExpensesList(prev => prev.map(e => {
                    if (e.id !== payTarget.id) return e
                    const parsed = parseExpenseDescription(e.description)
                    const updated = { ...parsed, paid_amount: (parsed.paid_amount ?? 0) + amount, payment_type: payPaymentSource, bank_name: payPaymentSource === 'bank' ? payBankName.trim() : '' }
                    return { ...e, description: JSON.stringify(updated) }
                }))
                setPayTarget(null)
                setPayAmount('')
                setPayPaymentSource('cash')
                setPayBankName('')
                toast.success('Payment recorded successfully!')
                if ('warning' in res && res.warning) toast.error(res.warning)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to record payment')
        } finally {
            setSubmittingPay(false)
        }
    }

    // Search query filtering
    const filteredSuppliers = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (!q) return suppliers

        return suppliers.filter(s => {
            let panVat = { pan: '', vat: '' }
            try {
                panVat = JSON.parse(s.contact_person || '{}')
            } catch {
                // ignore
            }
            return (
                s.name.toLowerCase().includes(q) ||
                (s.phone && s.phone.includes(q)) ||
                (s.address && s.address.toLowerCase().includes(q)) ||
                panVat.pan.includes(q) ||
                panVat.vat.includes(q)
            )
        })
    }, [suppliers, searchQuery])

    // Find and calculate ledger statement transactions with running balance
    const supplierLedgerEntries = useMemo(() => {
        if (!ledgerSupplier) return []
        const sNameLower = ledgerSupplier.name.toLowerCase().trim()

        // Filter and sort ascending (oldest first) to accumulate running balance correctly
        const filtered = expensesList
            .filter(e => e.vendor_name?.toLowerCase().trim() === sNameLower)
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        let cumulativeBalance = 0
        const mapped = filtered.map(e => {
            const parsed = parseExpenseDescription(e.description)

            const totalAmt = Number(e.amount)
            const paidAmt = Number(parsed.paid_amount ?? totalAmt)
            const owed = totalAmt - paidAmt
            cumulativeBalance += owed

            return {
                ...e,
                parsed,
                totalAmt,
                paidAmt,
                owed,
                runningBalance: cumulativeBalance
            }
        })

        // Return descending (newest first) for visual rendering
        return mapped.reverse()
    }, [ledgerSupplier, expensesList])

    const totalPurchased = useMemo(() => {
        return supplierLedgerEntries.reduce((sum, e) => sum + e.totalAmt, 0)
    }, [supplierLedgerEntries])

    const totalPaid = useMemo(() => {
        return supplierLedgerEntries.reduce((sum, e) => sum + e.paidAmt, 0)
    }, [supplierLedgerEntries])

    const totalOwed = useMemo(() => {
        // Outstanding amount is the final running balance (first item in reversed array)
        return supplierLedgerEntries[0]?.runningBalance ?? 0
    }, [supplierLedgerEntries])

    const printRef = useRef<PrintableReportHandle>(null)
    const reportColumns = [
        { key: 'date', label: 'Date' },
        { key: 'description', label: 'Description' },
        { key: 'quantity', label: 'Qty', align: 'center' as const },
        { key: 'rate', label: 'Rate', align: 'right' as const },
        { key: 'unit', label: 'Unit', align: 'center' as const },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'paid_amount', label: 'Paid Amount', align: 'right' as const },
        { key: 'payment_type', label: 'Payment Type' },
        { key: 'running_balance', label: 'Running Balance', align: 'right' as const },
    ]
    const reportRows = supplierLedgerEntries.map(e => ({
        date: formatDate(e.created_at),
        description: e.parsed.text_desc || e.description,
        quantity: e.parsed.quantity !== null ? e.parsed.quantity : '',
        rate: e.parsed.rate !== null ? formatCurrency(e.parsed.rate) : '',
        unit: e.parsed.unit || '',
        amount: formatCurrency(e.totalAmt),
        paid_amount: formatCurrency(e.paidAmt),
        payment_type: e.paidAmt === 0
            ? 'UNPAID'
            : `${e.owed > 0 ? 'Partial - ' : ''}${e.parsed.payment_type === 'bank' ? `Bank (${e.bank_accounts?.name || e.parsed.bank_name || 'Transfer'})` : 'Cash'}`,
        running_balance: formatCurrency(e.runningBalance),
    }))
    const handleExportCsv = () => downloadCsv(`supplier-statement-${ledgerSupplier?.name || 'supplier'}`, reportColumns, reportRows)

    return (
        <>
            <div className="space-y-6 pb-16 animate-fade-up">
                {/* Clean Light Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                                <Truck size={20} className="text-brand-500" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Suppliers Ledger</h1>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    Manage supplier profiles, tax details (PAN/VAT), and track expense purchase ledgers.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={openAddModal}
                            className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/20"
                        >
                            <Plus size={16} /> Add Supplier
                        </button>
                    </div>
                </div>

                {/* Directory table is always full width for spacious listing */}
                <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                    {/* List Controls */}
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Suppliers Directory ({filteredSuppliers.length})</p>
                        
                        {/* Search Bar */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search suppliers..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {/* Table View */}
                    <div className="overflow-x-auto">
                        {filteredSuppliers.length === 0 ? (
                            <div className="text-center py-16 px-4">
                                <FileText size={40} className="text-gray-300 mx-auto mb-3" />
                                <p className="text-xs font-bold text-gray-400">No suppliers found</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="px-6 py-4 font-bold text-gray-500">Supplier Details</th>
                                        <th className="px-6 py-4 font-bold text-gray-500 w-40 text-center">PAN / VAT</th>
                                        <th className="px-6 py-4 font-bold text-gray-500">Address</th>
                                        <th className="px-6 py-4 font-bold text-gray-500 w-44 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredSuppliers.map((s, idx) => {
                                        let parsed = { pan: '', vat: '' }
                                        try {
                                            parsed = JSON.parse(s.contact_person || '{}')
                                        } catch {
                                            // ignore
                                        }

                                        return (
                                            <tr key={s.id} className={`transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'} hover:bg-gray-50/50`}>
                                                {/* Details (Name & Phone) */}
                                                <td className="px-6 py-4">
                                                    <p className="font-extrabold text-sm text-gray-900">{s.name}</p>
                                                    <p className="text-[10px] text-gray-500 font-semibold flex items-center gap-1 mt-1">
                                                        <Phone size={10} /> {s.phone || 'N/A'}
                                                    </p>
                                                </td>

                                                {/* PAN/VAT Badges */}
                                                <td className="px-6 py-4 text-center whitespace-nowrap space-y-1">
                                                    {parsed.pan && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                                                            PAN: {parsed.pan}
                                                        </span>
                                                    )}
                                                    {parsed.vat && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">
                                                            VAT: {parsed.vat}
                                                        </span>
                                                    )}
                                                    {!parsed.pan && !parsed.vat && (
                                                        <span className="text-[10px] text-gray-400 italic">None</span>
                                                    )}
                                                </td>

                                                {/* Address */}
                                                <td className="px-6 py-4 font-semibold text-gray-500">
                                                    {s.address || <span className="text-gray-400 italic">None</span>}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-6 py-4 text-center space-x-2 whitespace-nowrap">
                                                    <button
                                                        onClick={() => setLedgerSupplier(s)}
                                                        className="px-3 py-1.5 rounded-lg font-black text-[10px] uppercase border bg-white hover:bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-800 transition-all shadow-sm"
                                                    >
                                                        Ledger Statement
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(s)}
                                                        className="p-1.5 hover:bg-gray-50 hover:text-gray-800 border border-transparent rounded-lg text-gray-400 transition-all inline-flex align-middle"
                                                        title="Edit Supplier"
                                                    >
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s.id, s.name)}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent rounded-lg text-gray-400 transition-all inline-flex align-middle"
                                                        title="Delete Supplier"
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

            {/* ── SUPPLIER LEDGER STATEMENT MODAL (Fullscreen-like overlay) ── */}
            {ledgerSupplier && (
                <div className="fixed inset-0 z-40 bg-gray-900/45 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Statement Header */}
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                            <div>
                                <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Supplier Account Statement</span>
                                <h2 className="text-xl font-extrabold text-gray-900 mt-0.5">{ledgerSupplier.name}</h2>
                                <p className="text-xs text-gray-500 mt-1">
                                    {(() => {
                                        try {
                                            const p = JSON.parse(ledgerSupplier.contact_person || '{}')
                                            return [p.pan && `PAN: ${p.pan}`, p.vat && `VAT: ${p.vat}`, ledgerSupplier.address].filter(Boolean).join(' | ') || 'No extra profile details'
                                        } catch {
                                            return 'No extra profile details'
                                        }
                                    })()}
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                {supplierLedgerEntries.length > 0 && (
                                    <>
                                        <button
                                            onClick={handleExportCsv}
                                            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs border border-gray-200 transition-all"
                                        >
                                            <Download size={14} /> Export
                                        </button>
                                        <button
                                            onClick={() => printRef.current?.print()}
                                            className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs border border-gray-200 transition-all"
                                        >
                                            <Printer size={14} /> Print
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => {
                                        setShowNewCatForm(false)
                                        setBillModalOpen(true)
                                    }}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-colors"
                                >
                                    <Plus size={14} /> Record Bill / Purchase
                                </button>
                                <button
                                    onClick={() => setLedgerSupplier(null)}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Statement Totals Row */}
                        <div className="grid grid-cols-3 border-b border-gray-100 divide-x divide-gray-100 bg-white">
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Purchases</p>
                                <p className="text-lg font-black text-gray-900 mt-1">{formatCurrency(totalPurchased)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Paid Amount</p>
                                <p className="text-lg font-black text-emerald-600 mt-1">{formatCurrency(totalPaid)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Outstanding (Owed)</p>
                                <p className="text-lg font-black text-rose-600 mt-1">{formatCurrency(totalOwed)}</p>
                            </div>
                        </div>

                        {/* Ledger Statement Transactions Table (9 columns) */}
                        <div className="flex-1 overflow-auto p-6 bg-gray-50/30">
                            {supplierLedgerEntries.length === 0 ? (
                                <div className="text-center py-20 bg-white border border-dashed border-gray-200 rounded-2xl text-gray-400">
                                    <DollarSign size={32} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-sm font-bold">No registered transactions match this supplier name.</p>
                                    <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed">
                                        Click &quot;Record Bill / Purchase&quot; above to log items, rates, paid values, and calculate the running balance.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
                                                <th className="px-4 py-3 font-bold">Date</th>
                                                <th className="px-4 py-3 font-bold">Description</th>
                                                <th className="px-4 py-3 font-bold text-center w-20">Qty</th>
                                                <th className="px-4 py-3 font-bold text-right w-24">Rate</th>
                                                <th className="px-4 py-3 font-bold text-center w-16">Unit</th>
                                                <th className="px-4 py-3 font-bold text-right w-28">Amount</th>
                                                <th className="px-4 py-3 font-bold text-right w-28">Paid Amount</th>
                                                <th className="px-4 py-3 font-bold text-center w-28">Payment Type</th>
                                                <th className="px-4 py-3 font-bold text-right w-32 bg-gray-50/50">Running Balance</th>
                                                <th className="px-4 py-3 font-bold text-center w-20">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {supplierLedgerEntries.map(e => (
                                                <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                                                    {/* Date */}
                                                    <td className="px-4 py-3 text-gray-500 font-semibold">
                                                        {formatDate(e.created_at)}
                                                    </td>
                                                    {/* Description */}
                                                    <td className="px-4 py-3 font-bold text-gray-800">
                                                        {e.parsed.text_desc || e.description}
                                                    </td>
                                                    {/* Product Quantity */}
                                                    <td className="px-4 py-3 text-center font-bold text-gray-700">
                                                        {e.parsed.quantity !== null ? e.parsed.quantity : '-'}
                                                    </td>
                                                    {/* Rate */}
                                                    <td className="px-4 py-3 text-right font-semibold text-gray-600">
                                                        {e.parsed.rate !== null ? formatCurrency(e.parsed.rate) : '-'}
                                                    </td>
                                                    {/* Unit */}
                                                    <td className="px-4 py-3 text-center text-gray-500 uppercase font-black text-[10px]">
                                                        {e.parsed.unit || '-'}
                                                    </td>
                                                    {/* Amount */}
                                                    <td className="px-4 py-3 text-right font-black text-gray-900">
                                                        {formatCurrency(e.totalAmt)}
                                                    </td>
                                                    {/* Paid Amount */}
                                                    <td className="px-4 py-3 text-right font-black text-emerald-600">
                                                        {formatCurrency(e.paidAmt)}
                                                    </td>
                                                    {/* Payment Type */}
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                                            e.paidAmt === 0
                                                                ? 'bg-rose-50 text-rose-700'
                                                                : e.owed > 0
                                                                    ? 'bg-orange-50 text-orange-700'
                                                                    : e.parsed.payment_type === 'bank'
                                                                        ? 'bg-indigo-50 text-indigo-700'
                                                                        : 'bg-amber-50 text-amber-700'
                                                        }`}>
                                                            {e.paidAmt === 0
                                                                ? 'UNPAID'
                                                                : `${e.owed > 0 ? 'PARTIAL · ' : ''}${e.parsed.payment_type === 'bank' ? `BANK (${e.bank_accounts?.name || e.parsed.bank_name || 'Transfer'})` : 'CASH'}`}
                                                        </span>
                                                    </td>
                                                    {/* Running Balance */}
                                                    <td className={`px-4 py-3 text-right font-black bg-gray-50/30 ${e.runningBalance > 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                                                        {formatCurrency(e.runningBalance)}
                                                    </td>
                                                    {/* Actions */}
                                                    <td className="px-4 py-3 text-center">
                                                        {e.owed > 0 && (
                                                            <button
                                                                onClick={() => setPayTarget({ id: e.id, owed: e.owed, text_desc: e.parsed.text_desc || e.description })}
                                                                className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-extrabold uppercase border border-emerald-200 transition-all mx-auto"
                                                            >
                                                                <Banknote size={11} /> Pay
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Statement Footer */}
                        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                            <button
                                onClick={() => setLedgerSupplier(null)}
                                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-xl transition-all"
                            >
                                Close Statement
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE/EDIT SUPPLIER MODAL ── */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 bg-gray-900/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                <FileText size={18} className="text-brand-500" />
                                {modalOpen === 'create' ? 'Create Supplier profile' : 'Edit Supplier details'}
                            </h3>
                            <button onClick={() => setModalOpen(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                {/* Name */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Supplier Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kathmandu Vegetable Supplier"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* Phone */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Phone Number *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9812345678"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* PAN / VAT details */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">PAN Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="9 digits"
                                            value={pan}
                                            onChange={e => setPan(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">VAT Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="VAT ID"
                                            value={vat}
                                            onChange={e => setVat(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Address</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kalimati, Kathmandu"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(null)}
                                    className="px-4 py-2 text-gray-400 hover:text-gray-600 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submitting && <Loader2 size={14} className="animate-spin" />}
                                    {modalOpen === 'create' ? 'Create Supplier' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── RECORD BILL / PURCHASE MODAL ── */}
            {billModalOpen && ledgerSupplier && (
                <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                <Tag size={18} className="text-brand-500" />
                                Record Bill for {ledgerSupplier.name}
                            </h3>
                            <button onClick={() => setBillModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleRecordBill}>
                            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                                {/* Category select & Add Category */}
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Expense Category *</label>
                                        <button
                                            type="button"
                                            onClick={() => setShowNewCatForm(!showNewCatForm)}
                                            className="text-[10px] font-extrabold text-brand-600 hover:text-brand-700 flex items-center gap-1 focus:outline-none"
                                        >
                                            {showNewCatForm ? <X size={10} /> : <Plus size={10} />}
                                            {showNewCatForm ? 'Cancel' : 'New Category'}
                                        </button>
                                    </div>

                                    {showNewCatForm ? (
                                        <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-3 mb-3 animate-in slide-in-from-top-1 duration-150">
                                            <div>
                                                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">New Category Name</label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Vegetables, Ingredients"
                                                    value={newCatName}
                                                    onChange={e => setNewCatName(e.target.value)}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Description (Optional)</label>
                                                <input
                                                    type="text"
                                                    placeholder="Brief description of purchases"
                                                    value={newCatDesc}
                                                    onChange={e => setNewCatDesc(e.target.value)}
                                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                disabled={submittingCat || !newCatName.trim()}
                                                onClick={handleAddCategory}
                                                className="w-full py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-xs rounded-lg flex items-center justify-center gap-1 transition-colors shadow-sm"
                                            >
                                                {submittingCat && <Loader2 size={10} className="animate-spin" />}
                                                Create & Select Category
                                            </button>
                                        </div>
                                    ) : (
                                        <select
                                            value={billCategory}
                                            onChange={e => setBillCategory(e.target.value)}
                                            required={!showNewCatForm}
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        >
                                            <option value="">Select Category</option>
                                            {expenseCategoriesList.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Description / Item Details *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Potato and Tomato purchase"
                                        value={billDesc}
                                        onChange={e => setBillDesc(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* Qty & Rate & Unit */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Quantity *</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="any"
                                            placeholder="0.00"
                                            value={billQty}
                                            onChange={e => setBillQty(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Rate (Rs.) *</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="any"
                                            placeholder="0.00"
                                            value={billRate}
                                            onChange={e => setBillRate(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Unit *</label>
                                        <select
                                            value={billUnit}
                                            onChange={e => setBillUnit(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        >
                                            <option value="kg">kg</option>
                                            <option value="pcs">pcs</option>
                                            <option value="ltr">ltr</option>
                                            <option value="box">box</option>
                                            <option value="packet">packet</option>
                                            <option value="plate">plate</option>
                                            <option value="other">other</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Calculated Total Bill Amount */}
                                <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex justify-between items-center text-xs">
                                    <span className="font-bold text-gray-500">Calculated Amount:</span>
                                    <span className="font-extrabold text-sm text-gray-900">
                                        {(() => {
                                            const q = parseFloat(billQty)
                                            const r = parseFloat(billRate)
                                            return isNaN(q) || isNaN(r) ? 'Rs. 0.00' : formatCurrency(q * r)
                                        })()}
                                    </span>
                                </div>

                                {/* Paid Amount */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Paid Amount (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00 (Enter 0 if unpaid)"
                                        value={billPaidAmount}
                                        onChange={e => setBillPaidAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                    <span className="text-[10px] text-gray-400 mt-1 block">Owed outstanding: {(() => {
                                        const q = parseFloat(billQty)
                                        const r = parseFloat(billRate)
                                        const p = parseFloat(billPaidAmount || '0')
                                        if (isNaN(q) || isNaN(r)) return 'Rs. 0.00'
                                        const owed = (q * r) - (isNaN(p) ? 0 : p)
                                        return formatCurrency(owed < 0 ? 0 : owed)
                                    })()}</span>
                                </div>

                                {/* Payment Source */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Payment Source (For Paid Amount)</label>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setBillPaymentSource('cash')}
                                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${billPaymentSource === 'cash' ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Cash Book
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setBillPaymentSource('bank')}
                                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${billPaymentSource === 'bank' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Bank Book
                                        </button>
                                    </div>
                                </div>

                                {/* Bank name if source is bank */}
                                {billPaymentSource === 'bank' && (
                                    <div className="animate-in slide-in-from-top-1 duration-150">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank Name</label>
                                        <select
                                            value={billBankName}
                                            onChange={e => setBillBankName(e.target.value)}
                                            required
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
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
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setBillModalOpen(false)}
                                    className="px-4 py-2 text-gray-400 hover:text-gray-600 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingBill}
                                    className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submittingBill && <Loader2 size={14} className="animate-spin" />}
                                    Record Purchase
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── PAY OUTSTANDING BILL MODAL ── */}
            {payTarget && (
                <div className="fixed inset-0 z-50 bg-gray-900/50 flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                <Banknote size={18} className="text-emerald-600" />
                                Pay Bill: {payTarget.text_desc}
                            </h3>
                            <button onClick={() => setPayTarget(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handlePaySubmit}>
                            <div className="p-6 space-y-4">
                                <div className="flex items-center justify-between px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl">
                                    <span className="text-xs font-bold text-rose-600 uppercase tracking-wider">Outstanding Balance</span>
                                    <span className="text-lg font-black text-rose-600">{formatCurrency(payTarget.owed)}</span>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Amount Paying Now (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max={payTarget.owed}
                                        step="0.01"
                                        placeholder="0.00"
                                        value={payAmount}
                                        onChange={e => setPayAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Payment Source</label>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setPayPaymentSource('cash')}
                                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${payPaymentSource === 'cash' ? 'bg-amber-50 border-amber-200 text-amber-700 shadow-sm' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Cash Book
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPayPaymentSource('bank')}
                                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${payPaymentSource === 'bank' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'}`}
                                        >
                                            Bank Book
                                        </button>
                                    </div>
                                </div>

                                {payPaymentSource === 'bank' && (
                                    <div className="animate-in slide-in-from-top-1 duration-150">
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Bank Name</label>
                                        <select
                                            value={payBankName}
                                            onChange={e => setPayBankName(e.target.value)}
                                            required
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
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

                                <p className="text-[11px] text-gray-400 leading-relaxed">
                                    This records today&apos;s payment in the Cash/Bank Book. The original bill keeps its purchase date — only this settlement is dated today.
                                </p>
                            </div>

                            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setPayTarget(null)}
                                    className="px-4 py-2 text-gray-400 hover:text-gray-600 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingPay}
                                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submittingPay && <Loader2 size={14} className="animate-spin" />}
                                    Record Payment
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {ledgerSupplier && (
                <PrintableReport
                    ref={printRef}
                    title={`Supplier Statement — ${ledgerSupplier.name}`}
                    subtitle={`Total Purchases: ${formatCurrency(totalPurchased)} | Paid: ${formatCurrency(totalPaid)} | Outstanding: ${formatCurrency(totalOwed)}`}
                    columns={reportColumns}
                    rows={reportRows}
                />
            )}
        </>
    )
}
