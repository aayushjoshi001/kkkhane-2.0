'use client'

import { useState, useTransition } from 'react'
import {
    TrendingUp, TrendingDown, Landmark, FileText, Package, Truck,
    X, ChevronRight, Loader2, CheckCircle, AlertCircle, ArrowRight,
    PenLine, Banknote, Building2, Receipt, Boxes, HandCoins, Info
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { createVoucherAction, openTodayDayBookSessionAction, getSupplierOutstandingBalanceAction, getStaffCurrentDueAction } from '@/app/(admin)/admin/vouchers/actions'
import { addStockMovementAction } from '@/app/(admin)/admin/ingredients/actions'
import type { BankAccount, ExpenseCategory, Supplier } from '@/types/database'

// ─── Types ───────────────────────────────────────────────────────────────────

interface StaffMember { id: string; full_name: string }
interface IngredientItem { id: string; name: string; unit: string; stock_quantity: number }

interface ManualEntryClientProps {
    bankAccounts: BankAccount[]
    suppliers: Supplier[]
    staffList: StaffMember[]
    expenseCategories: ExpenseCategory[]
    ingredients: IngredientItem[]
    hasOpenSession: boolean
    sessionId: string | null
    userRole: string
}

type EntryType = 'cash_in' | 'cash_out' | 'bank_transaction' | 'voucher' | 'inventory' | 'supplier_payment'

// ─── Entry Cards Config ───────────────────────────────────────────────────────

const ENTRY_CARDS = [
    {
        type: 'cash_in' as EntryType,
        icon: TrendingUp,
        label: 'Cash In',
        desc: 'Record cash received, sales proceeds, advances, or any incoming cash.',
        iconBg: 'bg-emerald-50',
        iconColor: 'text-emerald-600',
        border: 'border-gray-100',
        activeBorder: 'border-emerald-500',
        activeBg: 'bg-emerald-50/60',
    },
    {
        type: 'cash_out' as EntryType,
        icon: TrendingDown,
        label: 'Cash Out',
        desc: 'Record cash payments, expenses, salaries, or any outgoing cash.',
        iconBg: 'bg-rose-50',
        iconColor: 'text-rose-600',
        border: 'border-gray-100',
        activeBorder: 'border-rose-500',
        activeBg: 'bg-rose-50/60',
    },
    {
        type: 'bank_transaction' as EntryType,
        icon: Landmark,
        label: 'Bank Transaction',
        desc: 'Record bank deposits or withdrawals directly to/from accounts.',
        iconBg: 'bg-blue-50',
        iconColor: 'text-blue-600',
        border: 'border-gray-100',
        activeBorder: 'border-blue-500',
        activeBg: 'bg-blue-50/60',
    },
    {
        type: 'voucher' as EntryType,
        icon: FileText,
        label: 'Voucher',
        desc: 'Create payment or receipt vouchers with party details and reference numbers.',
        iconBg: 'bg-orange-50',
        iconColor: 'text-[#ff5a00]',
        border: 'border-gray-100',
        activeBorder: 'border-[#ff5a00]',
        activeBg: 'bg-orange-50/60',
    },
    {
        type: 'inventory' as EntryType,
        icon: Package,
        label: 'Inventory Adjustment',
        desc: 'Manually add or remove stock from ingredients and supplies.',
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        border: 'border-gray-100',
        activeBorder: 'border-purple-500',
        activeBg: 'bg-purple-50/60',
    },
    {
        type: 'supplier_payment' as EntryType,
        icon: Truck,
        label: 'Supplier Payment',
        desc: 'Record a direct payment to a supplier against outstanding bills.',
        iconBg: 'bg-teal-50',
        iconColor: 'text-teal-600',
        border: 'border-gray-100',
        activeBorder: 'border-teal-500',
        activeBg: 'bg-teal-50/60',
    },
]

// ─── Form State Types ─────────────────────────────────────────────────────────

const emptyForms = {
    cash_in: { amount: '', description: '', category: 'other' },
    cash_out: { amount: '', description: '', category: 'other', expense_category_id: '', bank_name: '' },
    bank_transaction: { amount: '', description: '', bank_name: '', transaction_type: 'deposit' },
    voucher: { voucher_type: 'receipt', party_name: '', amount: '', particulars: '', payment_mode: 'cash', bank_name: '' },
    inventory: { ingredient_id: '', movement_type: 'purchase', quantity: '', notes: '' },
    supplier_payment: { supplier_id: '', amount: '', payment_source: 'cash', bank_name: '', notes: '' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InputField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
            <input
                {...props}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] transition-all"
            />
        </div>
    )
}

function SelectField({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
            <select
                {...props}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] transition-all cursor-pointer"
            >
                {children}
            </select>
        </div>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManualEntryClient({
    bankAccounts,
    suppliers,
    staffList,
    expenseCategories,
    ingredients,
    hasOpenSession,
    sessionId,
    userRole,
}: ManualEntryClientProps) {
    const [activeType, setActiveType] = useState<EntryType | null>(null)
    const [forms, setForms] = useState(emptyForms)
    const [isPending, startTransition] = useTransition()
    const [lastSuccess, setLastSuccess] = useState<{ type: EntryType; label: string } | null>(null)

    const activeCard = ENTRY_CARDS.find(c => c.type === activeType)

    const canManage = ['manager', 'super_admin'].includes(userRole)

    function updateForm<T extends EntryType>(type: T, field: string, value: string) {
        setForms(prev => ({ ...prev, [type]: { ...prev[type], [field]: value } }))
    }

    const handleSupplierPaymentSelect = (sId: string) => {
        updateForm('supplier_payment', 'supplier_id', sId)
        if (!sId) {
            updateForm('supplier_payment', 'amount', '')
            updateForm('supplier_payment', 'notes', '')
            return
        }
        const supplierObj = suppliers.find(s => s.id === sId)
        const sName = supplierObj ? supplierObj.name : ''
        getSupplierOutstandingBalanceAction(sId).then(res => {
            if (res.data !== undefined) {
                setForms(prev => ({
                    ...prev,
                    supplier_payment: {
                        ...prev.supplier_payment,
                        amount: String(res.data),
                        notes: `Payment to ${sName} for outstanding bills`
                    }
                }))
                toast.success(`Auto-filled due: Rs. ${res.data}`, { id: 'due-autofill-toast' })
            }
        })
    }

    const handleCashOutDescriptionBlur = (desc: string) => {
        const query = desc.toLowerCase().trim()
        if (!query) return

        const keywords: Record<string, string[]> = {
            'food': ['chicken', 'vegetable', 'rice', 'oil', 'fish', 'meat', 'paneer', 'mutton', 'flour', 'sugar', 'salt', 'spice', 'potato', 'onion', 'milk', 'cheese', 'butter', 'egg', 'grocery', 'sauce', 'cream', 'spices', 'bread', 'yeast', 'bakery', 'tea', 'coffee'],
            'gas': ['gas', 'cylinder', 'lpg', 'fuel', 'petrol', 'diesel', 'kerosene'],
            'supplies': ['soap', 'shampoo', 'towel', 'tissue', 'cleaner', 'detergent', 'toilet', 'napkin', 'broom', 'mop', 'harpic', 'sanitizer', 'disinfectant'],
            'utilities': ['electricity', 'water', 'internet', 'wifi', 'phone', 'bill', 'electricity bill', 'water bill'],
            'salaries': ['salary', 'wage', 'payroll', 'salary payment', 'bonus', 'staff', 'salary staff'],
            'marketing': ['facebook', 'ads', 'marketing', 'poster', 'banner', 'flyer', 'ad'],
        }

        for (const [catName, words] of Object.entries(keywords)) {
            if (words.some(w => query.includes(w))) {
                const matchedCat = expenseCategories.find(c => 
                    c.name.toLowerCase().includes(catName.toLowerCase()) || 
                    catName.toLowerCase().includes(c.name.toLowerCase())
                )
                if (matchedCat) {
                    setForms(prev => ({
                        ...prev,
                        cash_out: {
                            ...prev.cash_out,
                            expense_category_id: matchedCat.id
                        }
                    }))
                    toast.success(`Auto-selected Expense Category: ${matchedCat.name}`, {
                        id: 'cash-out-auto-category-toast'
                    })
                    break
                }
            }
        }
    }

    function selectCard(type: EntryType) {
        setActiveType(prev => prev === type ? null : type)
        setLastSuccess(null)
    }

    // ── Submit router ─────────────────────────────────────────
    async function handleSubmit() {
        if (!activeType) return

        // Validate session for entries that need it
        const needsSession: EntryType[] = ['cash_in', 'cash_out', 'bank_transaction', 'voucher', 'supplier_payment']
        if (needsSession.includes(activeType) && !hasOpenSession) {
            toast.error('No active Day Book session. Please open the Cash Book first.')
            return
        }

        startTransition(async () => {
            try {
                let result: { error?: string; data?: unknown; success?: boolean } | undefined

                if (activeType === 'cash_in' || activeType === 'cash_out') {
                    const f = forms[activeType]
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.description.trim()) { toast.error('Description is required'); return }
                    if (!sessionId) { toast.error('No active session'); return }

                    const res = await fetch('/api/day-book/entries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: sessionId,
                            type: activeType,
                            amount,
                            description: f.description.trim(),
                            category: (f as typeof forms.cash_in).category,
                            expense_category_id: activeType === 'cash_out' && (f as typeof forms.cash_out).category === 'expense'
                                ? (f as typeof forms.cash_out).expense_category_id || undefined
                                : undefined,
                        }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)
                    result = { data }

                } else if (activeType === 'bank_transaction') {
                    const f = forms.bank_transaction
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.bank_name) { toast.error('Select a bank account'); return }
                    if (!f.description.trim()) { toast.error('Description is required'); return }
                    if (!sessionId) { toast.error('No active session'); return }

                    const entryType = f.transaction_type === 'deposit' ? 'bank_in' : 'bank_out'
                    const res = await fetch('/api/day-book/entries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: sessionId,
                            type: entryType,
                            amount,
                            description: f.description.trim(),
                            category: f.transaction_type === 'deposit' ? 'deposit' : 'withdrawal',
                            bank_name: f.bank_name,
                        }),
                    })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error)
                    result = { data }

                } else if (activeType === 'voucher') {
                    const f = forms.voucher
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.party_name.trim()) { toast.error('Party name is required'); return }
                    if (!f.particulars.trim()) { toast.error('Particulars are required'); return }

                    result = await createVoucherAction({
                        voucher_type: f.voucher_type as 'receipt' | 'payment',
                        party_name: f.party_name.trim(),
                        amount,
                        payment_mode: f.payment_mode as 'cash' | 'qr' | 'bank',
                        bank_name: f.bank_name || undefined,
                        particulars: f.particulars.trim(),
                    })

                } else if (activeType === 'inventory') {
                    const f = forms.inventory
                    const qty = parseFloat(f.quantity)
                    if (!f.ingredient_id) { toast.error('Select an ingredient'); return }
                    if (isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity'); return }

                    result = await addStockMovementAction({
                        ingredient_id: f.ingredient_id,
                        movement_type: f.movement_type,
                        quantity: qty,
                        notes: f.notes || undefined,
                    })

                } else if (activeType === 'supplier_payment') {
                    const f = forms.supplier_payment
                    const amount = parseFloat(f.amount)
                    if (!f.supplier_id) { toast.error('Select a supplier'); return }
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!sessionId) { toast.error('No active session'); return }

                    // Post as a voucher payment to supplier
                    const selectedSupplier = suppliers.find(s => s.id === f.supplier_id)
                    result = await createVoucherAction({
                        voucher_type: 'payment',
                        party_name: selectedSupplier?.name || f.supplier_id,
                        amount,
                        payment_mode: f.payment_source as 'cash' | 'qr' | 'bank',
                        bank_name: f.bank_name || undefined,
                        particulars: f.notes?.trim() || `Payment to ${selectedSupplier?.name || 'supplier'}`,
                        category: 'suppliers',
                        supplier_id: f.supplier_id,
                    })
                }

                if (result?.error) {
                    toast.error(result.error)
                    return
                }

                const label = ENTRY_CARDS.find(c => c.type === activeType)?.label || activeType
                toast.success(`${label} entry saved successfully!`)
                setLastSuccess({ type: activeType, label })
                setForms(prev => ({ ...prev, [activeType]: emptyForms[activeType] }))

            } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Something went wrong')
            }
        })
    }

    // ── Open session helper ───────────────────────────────────
    async function handleOpenSession() {
        startTransition(async () => {
            const result = await openTodayDayBookSessionAction()
            if (result.error) { toast.error(result.error); return }
            toast.success('Day Book session opened!')
            window.location.reload()
        })
    }

    return (
        <div className="space-y-6 pb-16">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                        <PenLine size={20} className="text-[#ff5a00]" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Manual Entry</h1>
                        <p className="text-sm text-gray-500 mt-0.5">All entry types in one place — no need to navigate between sections</p>
                    </div>
                </div>

                {/* Session warning */}
                {!hasOpenSession && (
                    <div className="mt-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5">
                        <AlertCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-amber-800">No Active Day Book Session</p>
                            <p className="text-xs text-amber-600 mt-0.5">Cash In, Cash Out, Bank, Voucher, and Supplier Payment entries require an open session.</p>
                        </div>
                        {canManage && (
                            <button
                                onClick={handleOpenSession}
                                disabled={isPending}
                                className="shrink-0 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                            >
                                {isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                                Open Session
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-col lg:flex-row gap-6 items-start">
                {/* Entry Type Grid */}
                <div className="flex-1 min-w-0 w-full">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Select Entry Type</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {ENTRY_CARDS.map((card) => {
                            const Icon = card.icon
                            const isActive = activeType === card.type
                            const isSuccess = lastSuccess?.type === card.type

                            return (
                                <button
                                    key={card.type}
                                    onClick={() => selectCard(card.type)}
                                    className={[
                                        'group relative text-left rounded-2xl border p-4 transition-all duration-300 bg-white shadow-[0_4px_20px_rgb(0,0,0,0.01)]',
                                        isActive
                                            ? `${card.activeBorder} ${card.activeBg} shadow-md`
                                            : `${card.border} hover:border-gray-200 hover:shadow-md`,
                                    ].join(' ')}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className={`p-2.5 rounded-xl ${card.iconBg}`}>
                                            <Icon size={18} className={card.iconColor} />
                                        </div>
                                        <div className={`transition-all duration-300 ${isActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                                            {isSuccess
                                                ? <CheckCircle size={16} className="text-emerald-500" />
                                                : <ChevronRight size={16} className={card.iconColor} />
                                            }
                                        </div>
                                    </div>
                                    <p className="font-bold text-sm text-gray-900">{card.label}</p>
                                    <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{card.desc}</p>
                                </button>
                            )
                        })}
                    </div>

                    {/* Tip */}
                    <div className="mt-5 flex items-center gap-2 text-gray-400 text-xs">
                        <Info size={12} />
                        <span>Click any card to expand its form. Entries are posted immediately to the relevant ledgers.</span>
                    </div>
                </div>

                {/* Side Panel */}
                <div className={[
                    'w-full lg:w-[360px] shrink-0 lg:sticky lg:top-6 transition-all duration-500',
                    activeType ? 'opacity-100 translate-x-0' : 'lg:opacity-0 lg:translate-x-8 lg:pointer-events-none lg:h-0 lg:overflow-hidden',
                ].join(' ')}>
                    {activeCard && (
                        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                            {/* Panel Header */}
                            <div className={`px-5 py-4 border-b border-gray-100 ${activeCard.iconBg}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-white">
                                            <activeCard.icon size={16} className={activeCard.iconColor} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-gray-900">{activeCard.label}</p>
                                            <p className="text-[11px] text-gray-500 mt-0.5">Fill in the details below</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setActiveType(null)}
                                        className="p-1.5 rounded-lg hover:bg-white/60 text-gray-400 hover:text-gray-700 transition-colors"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Form Body */}
                            <div className="p-5 space-y-3">
                                    {/* ── CASH IN ── */}
                                    {activeType === 'cash_in' && (
                                        <>
                                            <InputField
                                                label="Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.cash_in.amount}
                                                onChange={e => updateForm('cash_in', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Category"
                                                value={forms.cash_in.category}
                                                onChange={e => updateForm('cash_in', 'category', e.target.value)}
                                            >
                                                <option value="order_payment">Order Payment</option>
                                                <option value="booking_payment">Booking Payment</option>
                                                <option value="room_deposit">Room Deposit</option>
                                                <option value="advance">Advance</option>
                                                <option value="other">Other</option>
                                            </SelectField>
                                            <InputField
                                                label="Description"
                                                type="text"
                                                placeholder="What is this cash for?"
                                                value={forms.cash_in.description}
                                                onChange={e => updateForm('cash_in', 'description', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── CASH OUT ── */}
                                    {activeType === 'cash_out' && (
                                        <>
                                            <InputField
                                                label="Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.cash_out.amount}
                                                onChange={e => updateForm('cash_out', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Category"
                                                value={forms.cash_out.category}
                                                onChange={e => updateForm('cash_out', 'category', e.target.value)}
                                            >
                                                <option value="expense">Expense</option>
                                                <option value="salary">Salary / Wage</option>
                                                <option value="advance">Advance</option>
                                                <option value="refund">Refund</option>
                                                <option value="bank_deposit">Bank Deposit</option>
                                                <option value="other">Other</option>
                                            </SelectField>
                                            {forms.cash_out.category === 'expense' && expenseCategories.length > 0 && (
                                                <SelectField
                                                    label="Expense Category"
                                                    value={forms.cash_out.expense_category_id}
                                                    onChange={e => updateForm('cash_out', 'expense_category_id', e.target.value)}
                                                >
                                                    <option value="">Select category...</option>
                                                    {expenseCategories.map(ec => (
                                                        <option key={ec.id} value={ec.id}>{ec.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.cash_out.category === 'bank_deposit' && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.cash_out.bank_name}
                                                    onChange={e => updateForm('cash_out', 'bank_name', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            <InputField
                                                label="Description"
                                                type="text"
                                                placeholder="What is this payment for?"
                                                value={forms.cash_out.description}
                                                onChange={e => updateForm('cash_out', 'description', e.target.value)}
                                                onBlur={e => handleCashOutDescriptionBlur(e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── BANK TRANSACTION ── */}
                                    {activeType === 'bank_transaction' && (
                                        <>
                                            <SelectField
                                                label="Transaction Type"
                                                value={forms.bank_transaction.transaction_type}
                                                onChange={e => updateForm('bank_transaction', 'transaction_type', e.target.value)}
                                            >
                                                <option value="deposit">Deposit (Money In)</option>
                                                <option value="withdrawal">Withdrawal (Money Out)</option>
                                            </SelectField>
                                            <SelectField
                                                label="Bank Account"
                                                value={forms.bank_transaction.bank_name}
                                                onChange={e => updateForm('bank_transaction', 'bank_name', e.target.value)}
                                            >
                                                <option value="">Select bank account...</option>
                                                {bankAccounts.map(ba => (
                                                    <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                ))}
                                            </SelectField>
                                            <InputField
                                                label="Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.bank_transaction.amount}
                                                onChange={e => updateForm('bank_transaction', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <InputField
                                                label="Description"
                                                type="text"
                                                placeholder="Reason for this transaction"
                                                value={forms.bank_transaction.description}
                                                onChange={e => updateForm('bank_transaction', 'description', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── VOUCHER ── */}
                                    {activeType === 'voucher' && (
                                        <>
                                            <SelectField
                                                label="Voucher Type"
                                                value={forms.voucher.voucher_type}
                                                onChange={e => updateForm('voucher', 'voucher_type', e.target.value)}
                                            >
                                                <option value="receipt">Receipt Voucher (Money In)</option>
                                                <option value="payment">Payment Voucher (Money Out)</option>
                                            </SelectField>
                                            <InputField
                                                label="Party Name"
                                                type="text"
                                                placeholder="Customer or vendor name"
                                                value={forms.voucher.party_name}
                                                onChange={e => updateForm('voucher', 'party_name', e.target.value)}
                                            />
                                            <InputField
                                                label="Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.voucher.amount}
                                                onChange={e => updateForm('voucher', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Payment Mode"
                                                value={forms.voucher.payment_mode}
                                                onChange={e => updateForm('voucher', 'payment_mode', e.target.value)}
                                            >
                                                <option value="cash">Cash</option>
                                                <option value="qr">QR / Mobile Banking</option>
                                                <option value="bank">Bank Transfer</option>
                                            </SelectField>
                                            {(forms.voucher.payment_mode === 'qr' || forms.voucher.payment_mode === 'bank') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.voucher.bank_name}
                                                    onChange={e => updateForm('voucher', 'bank_name', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            <InputField
                                                label="Particulars"
                                                type="text"
                                                placeholder="Details / reason for voucher"
                                                value={forms.voucher.particulars}
                                                onChange={e => updateForm('voucher', 'particulars', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── INVENTORY ── */}
                                    {activeType === 'inventory' && (
                                        <>
                                            <SelectField
                                                label="Ingredient / Item"
                                                value={forms.inventory.ingredient_id}
                                                onChange={e => updateForm('inventory', 'ingredient_id', e.target.value)}
                                            >
                                                <option value="">Select ingredient...</option>
                                                {ingredients.map(ing => (
                                                    <option key={ing.id} value={ing.id}>
                                                        {ing.name} ({ing.unit}) — Stock: {ing.stock_quantity}
                                                    </option>
                                                ))}
                                            </SelectField>
                                            <SelectField
                                                label="Adjustment Type"
                                                value={forms.inventory.movement_type}
                                                onChange={e => updateForm('inventory', 'movement_type', e.target.value)}
                                            >
                                                <option value="purchase">Add Stock (Purchase)</option>
                                                <option value="adjustment">Adjustment (Add)</option>
                                                <option value="waste">Waste / Spoilage (Remove)</option>
                                                <option value="usage">Usage (Remove)</option>
                                            </SelectField>
                                            <InputField
                                                label="Quantity"
                                                type="number"
                                                placeholder="0"
                                                value={forms.inventory.quantity}
                                                onChange={e => updateForm('inventory', 'quantity', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <InputField
                                                label="Notes (optional)"
                                                type="text"
                                                placeholder="Reason for adjustment"
                                                value={forms.inventory.notes}
                                                onChange={e => updateForm('inventory', 'notes', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── SUPPLIER PAYMENT ── */}
                                    {activeType === 'supplier_payment' && (
                                        <>
                                            <SelectField
                                                label="Supplier"
                                                value={forms.supplier_payment.supplier_id}
                                                onChange={e => handleSupplierPaymentSelect(e.target.value)}
                                            >
                                                <option value="">Select supplier...</option>
                                                {suppliers.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </SelectField>
                                            <InputField
                                                label="Payment Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.supplier_payment.amount}
                                                onChange={e => updateForm('supplier_payment', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Payment Source"
                                                value={forms.supplier_payment.payment_source}
                                                onChange={e => updateForm('supplier_payment', 'payment_source', e.target.value)}
                                            >
                                                <option value="cash">Cash</option>
                                                <option value="qr">QR / Mobile Banking</option>
                                                <option value="bank">Bank Transfer</option>
                                            </SelectField>
                                            {(forms.supplier_payment.payment_source === 'qr' || forms.supplier_payment.payment_source === 'bank') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.supplier_payment.bank_name}
                                                    onChange={e => updateForm('supplier_payment', 'bank_name', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            <InputField
                                                label="Notes (optional)"
                                                type="text"
                                                placeholder="Bill reference or payment note"
                                                value={forms.supplier_payment.notes}
                                                onChange={e => updateForm('supplier_payment', 'notes', e.target.value)}
                                            />
                                        </>
                                    )}

                                {/* Submit */}
                                <button
                                    onClick={handleSubmit}
                                    disabled={isPending}
                                    className={[
                                        'w-full flex items-center justify-center gap-2.5 rounded-xl py-3 font-bold text-sm transition-all duration-200',
                                        isPending
                                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                            : 'bg-[#ff5a00] hover:bg-[#ff4500] text-white shadow-md shadow-[#ff5a00]/20 hover:scale-[1.01] active:scale-[0.98]',
                                    ].join(' ')}
                                >
                                    {isPending ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                                    {isPending ? 'Saving...' : 'Save Entry'}
                                </button>

                                {/* Success state */}
                                {lastSuccess?.type === activeType && (
                                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-emerald-700">
                                        <CheckCircle size={13} />
                                        Entry saved! Form cleared for next entry.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Placeholder when nothing selected */}
                    {!activeType && (
                        <div className="hidden lg:block bg-white border border-dashed border-gray-200 rounded-2xl p-8 text-center">
                            <div className="p-3 rounded-2xl bg-gray-50 inline-flex mb-3">
                                <PenLine size={22} className="text-gray-300" />
                            </div>
                            <p className="text-sm font-semibold text-gray-400">Select an entry type</p>
                            <p className="text-xs text-gray-400 mt-1.5">Click any card on the left to open its form here</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
