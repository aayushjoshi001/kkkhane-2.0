'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, DollarSign, Truck, Tag,
    Download, Printer, Banknote
} from 'lucide-react'
import { createSupplierAction, updateSupplierAction, deleteSupplierAction, createSupplierBillAction, approveChequeBillAction, rejectChequeBillAction, getSupplierSettlementsAction } from './actions'
import { createCategoryAction } from '../income-expenses/actions'
import { toast } from 'react-hot-toast'
import { formatCurrency, parseExpenseDescription, type SupplierBillDetails } from '@/lib/utils'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useDateFormatter, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import SupplierPaymentFields, { EMPTY_SUPPLIER_PAYMENT, validateSupplierPayment, isUnderpaidSplit, underpaidSplitConfirmMessage, buildChequeDetailsFromSupplierPayment, type SupplierPaymentValue } from '@/components/admin/SupplierPaymentFields'
import PayPartyModal, { type PayPartyResult } from '@/components/admin/PayPartyModal'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

function paymentTypeLabel(parsed: SupplierBillDetails, bankAccountName?: string): string {
    const bank = bankAccountName || parsed.bank_name || 'Transfer'
    switch (parsed.payment_type) {
        case 'bank': return `Bank (${bank})` // legacy bills recorded before Cash/QR/Cheque/Cash+QR existed
        case 'qr': return `QR (${bank})`
        case 'cheque': return `Cheque (${bank})`
        case 'cash_qr': return `Cash + QR (${bank})`
        default: return 'Cash'
    }
}

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
    ingredients?: Array<{ id: string; name: string; unit: string; cost_per_unit: number; category_id: string | null }>
}

export default function SuppliersLedgerManager({
    initialSuppliers,
    expenses,
    expenseCategories,
    bankAccounts,
    ingredients = []
}: SuppliersLedgerManagerProps) {
    const { confirm } = useConfirmStore()
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
    const [settlements, setSettlements] = useState<any[]>([])
    const [loadingSettlements, setLoadingSettlements] = useState(false)

    const loadSettlements = async (supplier: Supplier) => {
        const sNameLower = supplier.name.toLowerCase().trim()
        const supplierExpenseIds = expensesList
            .filter(e => e.vendor_name?.toLowerCase().trim() === sNameLower)
            .map(e => e.id)

        if (supplierExpenseIds.length === 0) {
            setSettlements([])
            return
        }

        setLoadingSettlements(true)
        try {
            const res = await getSupplierSettlementsAction(supplierExpenseIds)
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                setSettlements(res.data)
            }
        } catch (err) {
            toast.error('Failed to load payment history')
        } finally {
            setLoadingSettlements(false)
        }
    }

    useEffect(() => {
        if (ledgerSupplier) {
            loadSettlements(ledgerSupplier)
        } else {
            setSettlements([])
        }
    }, [ledgerSupplier])

    // Which row's Cash + QR breakdown is expanded — click the Payment Type
    // badge to reveal the small-font split, click again to collapse it.
    const [expandedSplitId, setExpandedSplitId] = useState<string | null>(null)

    // Record Bill Form fields
    const [billModalOpen, setBillModalOpen] = useState(false)
    const [selectedIngredientId, setSelectedIngredientId] = useState('')
    const [billDesc, setBillDesc] = useState('')
    const [billQty, setBillQty] = useState('')
    const [billRate, setBillRate] = useState('')
    const [billUnit, setBillUnit] = useState('kg')
    const [billCategory, setBillCategory] = useState('')
    const [billPaidAmount, setBillPaidAmount] = useState('')
    const [billPayment, setBillPayment] = useState<SupplierPaymentValue>(EMPTY_SUPPLIER_PAYMENT)
    const [submittingBill, setSubmittingBill] = useState(false)

    const handleIngredientSelect = (ingId: string) => {
        setSelectedIngredientId(ingId)
        if (!ingId) return

        const ing = ingredients.find(i => i.id === ingId)
        if (ing) {
            setBillDesc(ing.name)
            setBillRate(ing.cost_per_unit.toString())
            setBillUnit(ing.unit)
            if (ing.category_id) {
                setBillCategory(ing.category_id)
            }
        }
    }

    // Inline Category Creator inside Record Bill
    const [showNewCatForm, setShowNewCatForm] = useState(false)
    const [newCatName, setNewCatName] = useState('')
    const [newCatDesc, setNewCatDesc] = useState('')
    const [submittingCat, setSubmittingCat] = useState(false)

    // Pay modal — one action per supplier, settling however many outstanding
    // bills the amount covers (oldest first), via a real Payment Voucher.
    const [payModalOpen, setPayModalOpen] = useState(false)

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
        const ok = await confirm({ title: `Delete the supplier "${sName}"?`, message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return

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
        const paymentError = validateSupplierPayment(billPayment, paid)
        if (paymentError) {
            toast.error(paymentError)
            return
        }
        if (isUnderpaidSplit(billPayment, paid, totalAmt)) {
            const ok = await confirm({ title: 'Underpaid split', message: underpaidSplitConfirmMessage(paid, totalAmt), confirmText: 'Continue', isDestructive: false })
            if (!ok) return
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
                payment_source: billPayment.payment_source,
                bank_name: billPayment.payment_source !== 'cash' ? billPayment.bank_name.trim() : undefined,
                cash_portion: billPayment.payment_source === 'cash_qr' ? (parseFloat(billPayment.cash_portion) || 0) : undefined,
                qr_portion: billPayment.payment_source === 'cash_qr' ? (parseFloat(billPayment.qr_portion) || 0) : undefined,
                cheque_details: billPayment.payment_source === 'cheque' ? buildChequeDetailsFromSupplierPayment(billPayment) : undefined,
                ingredient_id: selectedIngredientId || undefined,
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
                setSelectedIngredientId('')
                setBillDesc('')
                setBillQty('')
                setBillRate('')
                setBillUnit('kg')
                setBillCategory('')
                setBillPaidAmount('')
                setBillPayment(EMPTY_SUPPLIER_PAYMENT)
                if ('pendingApproval' in res && res.pendingApproval) {
                    toast.success('Bill logged. Cheque payment held pending manager approval.', { duration: 6000 })
                } else {
                    toast.success('Bill logged successfully!')
                    if ('warning' in res && res.warning) toast.error(res.warning)
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to record bill')
        } finally {
            setSubmittingBill(false)
        }
    }

    // Called after PayPartyModal successfully records a voucher that settled
    // some (or all) of this supplier's outstanding bills — patches the
    // touched bills' paid_amount locally instead of a full page refetch.
    const handlePaySettled = async (result: PayPartyResult) => {
        if (!result.settledBills?.length) return
        const updatedExpenses = expensesList.map(e => {
            const settled = result.settledBills!.find(b => b.id === e.id)
            if (!settled) return e
            const parsed = parseExpenseDescription(e.description)
            return { ...e, description: JSON.stringify({ ...parsed, paid_amount: settled.paid_amount }) }
        })
        setExpensesList(updatedExpenses)

        if (ledgerSupplier) {
            const sNameLower = ledgerSupplier.name.toLowerCase().trim()
            const supplierExpenseIds = updatedExpenses
                .filter(e => e.vendor_name?.toLowerCase().trim() === sNameLower)
                .map(e => e.id)

            if (supplierExpenseIds.length > 0) {
                setLoadingSettlements(true)
                try {
                    const res = await getSupplierSettlementsAction(supplierExpenseIds)
                    if (res.data) setSettlements(res.data)
                } catch (e) {
                    console.error(e)
                } finally {
                    setLoadingSettlements(false)
                }
            }
        }
    }

    // Bills currently holding a cheque payment awaiting manager approval —
    // derived straight from the already-loaded list, no separate fetch needed.
    const pendingChequeBills = useMemo(
        () => expensesList.filter(e => parseExpenseDescription(e.description).cheque_status === 'pending_approval'),
        [expensesList],
    )
    const [processingChequeId, setProcessingChequeId] = useState<string | null>(null)

    const handleApproveCheque = async (expenseId: string) => {
        setProcessingChequeId(expenseId)
        try {
            const res = await approveChequeBillAction(expenseId)
            if (res.error) {
                toast.error(res.error)
                return
            }
            toast.success('Cheque approved and posted to the Day Book!')
            if (res.warning) toast.error(res.warning)
            const bill = expensesList.find(e => e.id === expenseId)
            if (bill) {
                const parsed = parseExpenseDescription(bill.description)
                const approvedAmount = parsed.pending_cheque?.amount ?? 0
                setExpensesList(prev => prev.map(e => e.id === expenseId
                    ? { ...e, description: JSON.stringify({ ...parsed, paid_amount: (parsed.paid_amount ?? 0) + approvedAmount, cheque_status: 'approved', pending_cheque: undefined }) }
                    : e))
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to approve cheque')
        } finally {
            setProcessingChequeId(null)
        }
    }

    const handleRejectCheque = async (expenseId: string) => {
        setProcessingChequeId(expenseId)
        try {
            const res = await rejectChequeBillAction(expenseId)
            if (res.error) {
                toast.error(res.error)
                return
            }
            toast.success('Cheque rejected — bill remains due for that amount.')
            setExpensesList(prev => prev.map(e => {
                if (e.id !== expenseId) return e
                const parsed = parseExpenseDescription(e.description)
                return { ...e, description: JSON.stringify({ ...parsed, cheque_status: 'rejected', pending_cheque: undefined }) }
            }))
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to reject cheque')
        } finally {
            setProcessingChequeId(null)
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

        // 1. Get all bills for this supplier
        const bills = expensesList.filter(e => e.vendor_name?.toLowerCase().trim() === sNameLower)

        // 2. Map settlements to bills to find out how much of the current paid_amount is from subsequent settlements
        const settlementsMap: Record<string, number> = {}
        settlements.forEach(s => {
            settlementsMap[s.expense_id] = (settlementsMap[s.expense_id] || 0) + Number(s.amount)
        })

        // 3. Create statement rows
        const statementRows: Array<{
            id: string
            created_at: string
            description: string
            totalAmt: number
            paidAmt: number
            owed: number
            parsed: SupplierBillDetails
            bank_accounts?: {
                name: string
            }
            isPaymentRow?: boolean
        }> = []

        // Add bill rows
        bills.forEach(b => {
            const parsed = parseExpenseDescription(b.description)
            const totalAmt = Number(b.amount)
            const currentPaid = Number(parsed.paid_amount ?? totalAmt)
            const settlementsPaid = settlementsMap[b.id] || 0
            const initialPaid = Math.max(0, currentPaid - settlementsPaid)
            const owed = totalAmt - initialPaid

            statementRows.push({
                id: b.id,
                created_at: b.created_at,
                description: b.description,
                totalAmt: totalAmt,
                paidAmt: initialPaid,
                owed: owed,
                parsed: {
                    ...parsed,
                    paid_amount: initialPaid,
                    payment_type: initialPaid === 0 ? 'UNPAID' : parsed.payment_type || 'cash',
                },
                bank_accounts: b.bank_accounts ? { name: b.bank_accounts.name } : undefined
            })
        })

        // Group settlements by day_book_entry_id so we present a single payment row for each voucher
        const groupedSettlements: Record<string, {
            dayBookEntryId: string
            date: string
            description: string
            totalAmount: number
            paymentMode: string
            bankName: string
        }> = {}

        settlements.forEach(s => {
            const dbEntry = s.day_book_entries
            if (!dbEntry) return

            let parsedDbDesc = { particulars: '', voucher_number: '', payment_mode: '', bank_name: '' }
            try {
                parsedDbDesc = JSON.parse(dbEntry.description)
            } catch (e) {
                parsedDbDesc.particulars = dbEntry.description
            }

            const entryId = dbEntry.id
            if (!groupedSettlements[entryId]) {
                const voucherNo = parsedDbDesc.voucher_number || 'Payment'
                groupedSettlements[entryId] = {
                    dayBookEntryId: entryId,
                    date: s.created_at,
                    description: `Payment Voucher (${voucherNo}) - ${parsedDbDesc.particulars || 'Supplier Payment'}`,
                    totalAmount: 0,
                    paymentMode: parsedDbDesc.payment_mode || (dbEntry.type?.includes('cash') ? 'cash' : 'bank'),
                    bankName: parsedDbDesc.bank_name || dbEntry.bank_name || ''
                }
            }
            groupedSettlements[entryId].totalAmount += Number(s.amount)
        })

        // Add payment rows
        Object.values(groupedSettlements).forEach(gs => {
            statementRows.push({
                id: gs.dayBookEntryId,
                created_at: gs.date,
                description: gs.description,
                totalAmt: 0,
                paidAmt: gs.totalAmount,
                owed: 0,
                parsed: {
                    text_desc: gs.description,
                    quantity: null,
                    rate: null,
                    unit: '',
                    paid_amount: gs.totalAmount,
                    payment_type: gs.paymentMode,
                    bank_name: gs.bankName || ''
                },
                isPaymentRow: true
            })
        })

        // 4. Sort chronologically by date ascending to calculate running balance correctly
        statementRows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

        let cumulativeBalance = 0
        const mapped = statementRows.map(row => {
            const netChange = row.totalAmt - row.paidAmt
            cumulativeBalance += netChange

            return {
                ...row,
                runningBalance: cumulativeBalance
            }
        })

        // 5. Return descending (newest first) for UI rendering
        return mapped.reverse()
    }, [ledgerSupplier, expensesList, settlements])

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
        { key: 'date', label: 'Date', dateStacked: true },
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
            : `${e.owed > 0 ? 'Partial - ' : ''}${paymentTypeLabel(e.parsed, e.bank_accounts?.name)}` +
              (e.parsed.payment_type === 'cash_qr' ? ` (Cash: ${formatCurrency(e.parsed.cash_portion ?? 0)}, QR: ${formatCurrency(e.parsed.qr_portion ?? 0)})` : ''),
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
                                <h1 className="text-2xl font-extrabold text-ink tracking-tight">Suppliers Ledger</h1>
                                <p className="text-sm text-ink-subtle mt-0.5">
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

                {/* Pending Cheque Approvals — hidden entirely when empty */}
                {pendingChequeBills.length > 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-purple-200 bg-purple-100/50">
                            <p className="text-xs font-black text-purple-800 uppercase tracking-wider">
                                Pending Cheque Approvals ({pendingChequeBills.length})
                            </p>
                            <p className="text-[11px] text-purple-700 mt-0.5">
                                These bills&apos; cheque payments aren&apos;t reflected in any balance until approved.
                            </p>
                        </div>
                        <div className="divide-y divide-purple-100">
                            {pendingChequeBills.map(bill => {
                                const parsed = parseExpenseDescription(bill.description)
                                const pending = parsed.pending_cheque
                                const isProcessing = processingChequeId === bill.id
                                return (
                                    <div key={bill.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-ink truncate">{bill.vendor_name} — {parsed.text_desc}</p>
                                            <p className="text-[11px] text-ink-subtle mt-0.5">
                                                Rs. {formatCurrency(pending?.amount ?? 0)} · Cheque #{pending?.cheque_details.cheque_number} · {pending?.cheque_details.bank_cheque} · Dated {pending?.cheque_details.cheque_date} · Given by {pending?.cheque_details.written_name}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                onClick={() => handleRejectCheque(bill.id)}
                                                disabled={isProcessing}
                                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-hairline text-ink-subtle hover:bg-surface-muted transition disabled:opacity-50"
                                            >
                                                Reject
                                            </button>
                                            <button
                                                onClick={() => handleApproveCheque(bill.id)}
                                                disabled={isProcessing}
                                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : null}
                                                Approve
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Directory table is always full width for spacious listing */}
                <div className="bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden">
                    {/* List Controls */}
                    <div className="p-4 border-b border-hairline bg-surface-muted/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-black text-ink uppercase tracking-wider">Suppliers Directory ({filteredSuppliers.length})</p>
                        
                        {/* Search Bar */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search suppliers..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {/* Table View */}
                    <div className="overflow-x-auto">
                        {filteredSuppliers.length === 0 ? (
                            <div className="text-center py-16 px-4">
                                <FileText size={40} className="text-ink-subtle mx-auto mb-3" />
                                <p className="text-xs font-bold text-ink-subtle">No suppliers found</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-surface-muted border-b border-hairline">
                                        <th className="px-6 py-4 font-bold text-ink-subtle">Supplier Details</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle w-40 text-center">PAN / VAT</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle">Address</th>
                                        <th className="px-6 py-4 font-bold text-ink-subtle w-44 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                    {filteredSuppliers.map((s, idx) => {
                                        let parsed = { pan: '', vat: '' }
                                        try {
                                            parsed = JSON.parse(s.contact_person || '{}')
                                        } catch {
                                            // ignore
                                        }

                                        return (
                                            <tr key={s.id} className={`transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/20'} hover:bg-surface-muted/50`}>
                                                {/* Details (Name & Phone) */}
                                                <td className="px-6 py-4">
                                                    <p className="font-extrabold text-sm text-ink">{s.name}</p>
                                                    <p className="text-[10px] text-ink-subtle font-semibold flex items-center gap-1 mt-1">
                                                        <Phone size={10} /> {s.phone || 'N/A'}
                                                    </p>
                                                </td>

                                                {/* PAN/VAT Badges */}
                                                <td className="px-6 py-4 text-center whitespace-nowrap space-y-1">
                                                    {parsed.pan && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-surface-muted text-ink-subtle border border-hairline">
                                                            PAN: {parsed.pan}
                                                        </span>
                                                    )}
                                                    {parsed.vat && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">
                                                            VAT: {parsed.vat}
                                                        </span>
                                                    )}
                                                    {!parsed.pan && !parsed.vat && (
                                                        <span className="text-[10px] text-ink-subtle italic">None</span>
                                                    )}
                                                </td>

                                                {/* Address */}
                                                <td className="px-6 py-4 font-semibold text-ink-subtle">
                                                    {s.address || <span className="text-ink-subtle italic">None</span>}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-6 py-4 text-center space-x-2 whitespace-nowrap">
                                                    <button
                                                        onClick={() => setLedgerSupplier(s)}
                                                        className="px-3 py-1.5 rounded-lg font-black text-[10px] uppercase border bg-surface hover:bg-surface-muted border-hairline text-ink-subtle hover:text-ink transition-all shadow-sm"
                                                    >
                                                        Ledger Statement
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(s)}
                                                        className="p-1.5 hover:bg-surface-muted hover:text-ink border border-transparent rounded-lg text-ink-subtle transition-all inline-flex align-middle"
                                                        title="Edit Supplier"
                                                    >
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s.id, s.name)}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent rounded-lg text-ink-subtle transition-all inline-flex align-middle"
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
                <div className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Statement Header */}
                        <div className="px-6 py-4 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <div>
                                <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Supplier Account Statement</span>
                                <h2 className="text-xl font-extrabold text-ink mt-0.5">{ledgerSupplier.name}</h2>
                                <p className="text-xs text-ink-subtle mt-1">
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
                                            className="flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-muted text-ink font-bold rounded-xl text-xs border border-hairline transition-all"
                                        >
                                            <Download size={14} /> Export
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
                                    onClick={() => {
                                        setShowNewCatForm(false)
                                        setSelectedIngredientId('')
                                        setBillModalOpen(true)
                                    }}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-colors"
                                >
                                    <Plus size={14} /> Record Bill / Purchase
                                </button>
                                {totalOwed > 0 && (
                                    <button
                                        onClick={() => setPayModalOpen(true)}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs shadow-sm transition-colors"
                                    >
                                        <Banknote size={14} /> Pay
                                    </button>
                                )}
                                <button
                                    onClick={() => setLedgerSupplier(null)}
                                    className="p-1.5 text-ink-subtle hover:text-ink-subtle hover:bg-surface-muted rounded-lg transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Statement Totals Row */}
                        <div className="grid grid-cols-3 border-b border-hairline divide-x divide-hairline bg-surface">
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Purchases</p>
                                <p className="text-lg font-black text-ink mt-1">{formatCurrency(totalPurchased)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Paid Amount</p>
                                <p className="text-lg font-black text-emerald-600 mt-1">{formatCurrency(totalPaid)}</p>
                            </div>
                            <div className="p-4 text-center">
                                <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Outstanding (Owed)</p>
                                <p className="text-lg font-black text-rose-600 mt-1">{formatCurrency(totalOwed)}</p>
                            </div>
                        </div>

                        {/* Ledger Statement Transactions Table (9 columns) */}
                        <div className="flex-1 overflow-auto p-6 bg-surface-muted/30">
                            {loadingSettlements ? (
                                <div className="text-center py-20 bg-surface border border-dashed border-hairline rounded-2xl text-ink-subtle">
                                    <Loader2 size={32} className="mx-auto mb-2 animate-spin text-brand-500" />
                                    <p className="text-sm font-bold">Loading ledger statement history...</p>
                                </div>
                            ) : supplierLedgerEntries.length === 0 ? (
                                <div className="text-center py-20 bg-surface border border-dashed border-hairline rounded-2xl text-ink-subtle">
                                    <DollarSign size={32} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-sm font-bold">No registered transactions match this supplier name.</p>
                                    <p className="text-xs text-ink-subtle mt-1 max-w-sm mx-auto leading-relaxed">
                                        Click &quot;Record Bill / Purchase&quot; above to log items, rates, paid values, and calculate the running balance.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-surface border border-hairline rounded-xl overflow-hidden shadow-sm">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline text-ink-subtle">
                                                <th className="px-4 py-3 font-bold">Date</th>
                                                <th className="px-4 py-3 font-bold">Description</th>
                                                <th className="px-4 py-3 font-bold text-center w-20">Qty</th>
                                                <th className="px-4 py-3 font-bold text-right w-24">Rate</th>
                                                <th className="px-4 py-3 font-bold text-center w-16">Unit</th>
                                                <th className="px-4 py-3 font-bold text-right w-28">Amount</th>
                                                <th className="px-4 py-3 font-bold text-right w-28">Paid Amount</th>
                                                <th className="px-4 py-3 font-bold text-center w-28">Payment Type</th>
                                                <th className="px-4 py-3 font-bold text-right w-32 bg-surface-muted/50">Running Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {supplierLedgerEntries.map(e => (
                                                <tr key={e.id} className="hover:bg-surface-muted/50 transition-colors">
                                                    {/* Date */}
                                                    <td className="px-4 py-3 text-ink-subtle font-semibold">
                                                        <DateCell value={e.created_at} />
                                                    </td>
                                                    {/* Description */}
                                                    <td className="px-4 py-3 font-bold text-ink">
                                                        {e.parsed.text_desc || e.description}
                                                    </td>
                                                    {/* Product Quantity */}
                                                    <td className="px-4 py-3 text-center font-bold text-ink">
                                                        {e.parsed.quantity !== null ? e.parsed.quantity : '-'}
                                                    </td>
                                                    {/* Rate */}
                                                    <td className="px-4 py-3 text-right font-semibold text-ink-subtle">
                                                        {e.parsed.rate !== null ? formatCurrency(e.parsed.rate) : '-'}
                                                    </td>
                                                    {/* Unit */}
                                                    <td className="px-4 py-3 text-center text-ink-subtle uppercase font-black text-[10px]">
                                                        {e.parsed.unit || '-'}
                                                    </td>
                                                    {/* Amount */}
                                                    <td className="px-4 py-3 text-right font-black text-ink">
                                                        {formatCurrency(e.totalAmt)}
                                                    </td>
                                                    {/* Paid Amount */}
                                                    <td className="px-4 py-3 text-right font-black text-emerald-600">
                                                        {formatCurrency(e.paidAmt)}
                                                    </td>
                                                    {/* Payment Type */}
                                                    <td className="px-4 py-3 text-center whitespace-nowrap">
                                                        {e.parsed.payment_type === 'cash_qr' && e.paidAmt > 0 ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => setExpandedSplitId(prev => prev === e.id ? null : e.id)}
                                                                className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase cursor-pointer transition-colors ${
                                                                    e.owed > 0 ? 'bg-orange-50 text-orange-700 hover:bg-orange-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                                                                }`}
                                                                title="Click to see the Cash / QR split"
                                                            >
                                                                {`${e.owed > 0 ? 'PARTIAL · ' : ''}${paymentTypeLabel(e.parsed, e.bank_accounts?.name).toUpperCase()}`}
                                                            </button>
                                                        ) : (
                                                            <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                e.paidAmt === 0
                                                                    ? 'bg-rose-50 text-rose-700'
                                                                    : e.owed > 0
                                                                        ? 'bg-orange-50 text-orange-700'
                                                                        : e.parsed.payment_type !== 'cash'
                                                                            ? 'bg-indigo-50 text-indigo-700'
                                                                            : 'bg-amber-50 text-amber-700'
                                                            }`}>
                                                                {e.paidAmt === 0
                                                                    ? 'UNPAID'
                                                                    : `${e.owed > 0 ? 'PARTIAL · ' : ''}${paymentTypeLabel(e.parsed, e.bank_accounts?.name).toUpperCase()}`}
                                                            </span>
                                                        )}
                                                        {expandedSplitId === e.id && e.parsed.payment_type === 'cash_qr' && e.paidAmt > 0 && (
                                                            <div className="mt-1 text-[9px] font-bold text-ink-subtle leading-tight">
                                                                Cash: {formatCurrency(e.parsed.cash_portion ?? 0)}
                                                                <br />
                                                                QR: {formatCurrency(e.parsed.qr_portion ?? 0)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    {/* Running Balance */}
                                                    <td className={`px-4 py-3 text-right font-black bg-surface-muted/30 ${e.runningBalance > 0 ? 'text-rose-600' : 'text-ink'}`}>
                                                        {formatCurrency(e.runningBalance)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Statement Footer */}
                        <div className="px-6 py-4 border-t border-hairline bg-surface-muted/50 flex justify-end">
                            <button
                                onClick={() => setLedgerSupplier(null)}
                                className="px-5 py-2 bg-surface-muted hover:opacity-80 text-ink font-bold text-xs rounded-xl transition-all"
                            >
                                Close Statement
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE/EDIT SUPPLIER MODAL ── */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-extrabold text-ink flex items-center gap-2">
                                <FileText size={18} className="text-brand-500" />
                                {modalOpen === 'create' ? 'Create Supplier profile' : 'Edit Supplier details'}
                            </h3>
                            <button onClick={() => setModalOpen(null)} className="text-ink-subtle hover:text-ink-subtle">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                {/* Name */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Supplier Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kathmandu Vegetable Supplier"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* Phone */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Phone Number *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9812345678"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* PAN / VAT details */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">PAN Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="9 digits"
                                            value={pan}
                                            onChange={e => setPan(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">VAT Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="VAT ID"
                                            value={vat}
                                            onChange={e => setVat(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Address</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kalimati, Kathmandu"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-hairline bg-surface-muted flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(null)}
                                    className="px-4 py-2 text-ink-subtle hover:text-ink-subtle font-bold text-sm"
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
                <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-extrabold text-ink flex items-center gap-2">
                                <Tag size={18} className="text-brand-500" />
                                Record Bill for {ledgerSupplier.name}
                            </h3>
                            <button onClick={() => setBillModalOpen(false)} className="text-ink-subtle hover:text-ink-subtle">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleRecordBill}>
                            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                                {/* Link to Stock Item */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Link to Stock Item (Optional)</label>
                                    <Select
                                        value={selectedIngredientId}
                                        onChange={e => handleIngredientSelect(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    >
                                        <option value="">Do not link to stock</option>
                                        {ingredients.map(ing => (
                                            <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
                                        ))}
                                    </Select>
                                    <p className="text-[10px] text-ink-subtle mt-1">If selected, recording this purchase will automatically add stock quantity to the ingredient.</p>
                                </div>

                                {/* Category select & Add Category */}
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Expense Category *</label>
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
                                        <div className="p-4 bg-surface-muted border border-hairline rounded-xl space-y-3 mb-3 animate-in slide-in-from-top-1 duration-150">
                                            <div>
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">New Category Name</label>
                                                <input
                                                    type="text"
                                                    placeholder="e.g. Vegetables, Ingredients"
                                                    value={newCatName}
                                                    onChange={e => setNewCatName(e.target.value)}
                                                    className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase tracking-wider mb-1">Description (Optional)</label>
                                                <input
                                                    type="text"
                                                    placeholder="Brief description of purchases"
                                                    value={newCatDesc}
                                                    onChange={e => setNewCatDesc(e.target.value)}
                                                    className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
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
                                        <Select
                                            value={billCategory}
                                            onChange={e => setBillCategory(e.target.value)}
                                            required={!showNewCatForm}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        >
                                            <option value="">Select Category</option>
                                            {expenseCategoriesList.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </Select>
                                    )}
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Description / Item Details *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Potato and Tomato purchase"
                                        value={billDesc}
                                        onChange={e => setBillDesc(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* Qty & Rate & Unit */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Quantity *</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="any"
                                            placeholder="0.00"
                                            value={billQty}
                                            onChange={e => setBillQty(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Rate (Rs.) *</label>
                                        <input
                                            type="number"
                                            min="0.01"
                                            step="any"
                                            placeholder="0.00"
                                            value={billRate}
                                            onChange={e => setBillRate(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Unit *</label>
                                        <Select
                                            value={billUnit}
                                            onChange={e => setBillUnit(e.target.value)}
                                            required
                                            className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        >
                                            <option value="kg">kg</option>
                                            <option value="pcs">pcs</option>
                                            <option value="ltr">ltr</option>
                                            <option value="bottle">bottle</option>
                                            <option value="box">box</option>
                                            <option value="packet">packet</option>
                                            <option value="plate">plate</option>
                                            <option value="other">other</option>
                                        </Select>
                                    </div>
                                </div>

                                {/* Calculated Total Bill Amount */}
                                <div className="bg-surface-muted p-3 rounded-xl border border-hairline flex justify-between items-center text-xs">
                                    <span className="font-bold text-ink-subtle">Calculated Amount:</span>
                                    <span className="font-extrabold text-sm text-ink">
                                        {(() => {
                                            const q = parseFloat(billQty)
                                            const r = parseFloat(billRate)
                                            return isNaN(q) || isNaN(r) ? 'Rs. 0.00' : formatCurrency(q * r)
                                        })()}
                                    </span>
                                </div>

                                {/* Paid Amount */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Paid Amount (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="0.00 (Enter 0 if unpaid)"
                                        value={billPaidAmount}
                                        onChange={e => setBillPaidAmount(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                    <span className="text-[10px] text-ink-subtle mt-1 block">Owed outstanding: {(() => {
                                        const q = parseFloat(billQty)
                                        const r = parseFloat(billRate)
                                        const p = parseFloat(billPaidAmount || '0')
                                        if (isNaN(q) || isNaN(r)) return 'Rs. 0.00'
                                        const owed = (q * r) - (isNaN(p) ? 0 : p)
                                        return formatCurrency(owed < 0 ? 0 : owed)
                                    })()}</span>
                                </div>

                                {/* Payment Source (for Paid Amount) */}
                                <SupplierPaymentFields
                                    value={billPayment}
                                    onChange={setBillPayment}
                                    bankAccounts={bankAccounts}
                                    paidAmount={parseFloat(billPaidAmount || '0') || 0}
                                />
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-hairline bg-surface-muted flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setBillModalOpen(false)}
                                    className="px-4 py-2 text-ink-subtle hover:text-ink-subtle font-bold text-sm"
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

            {ledgerSupplier && (
                <PayPartyModal
                    isOpen={payModalOpen}
                    onClose={() => setPayModalOpen(false)}
                    category="suppliers"
                    partyId={ledgerSupplier.id}
                    partyName={ledgerSupplier.name}
                    currentDue={totalOwed}
                    bankAccounts={bankAccounts}
                    onSettled={handlePaySettled}
                />
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
