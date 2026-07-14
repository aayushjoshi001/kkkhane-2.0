'use client'

import { useState, useTransition } from 'react'
import {
    TrendingUp, TrendingDown, Landmark, FileText, Package, Truck,
    X, ChevronRight, Loader2, CheckCircle, AlertCircle, ArrowRight,
    PenLine, Banknote, Building2, Receipt, Boxes, HandCoins, Info
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { createVoucherAction, openTodayDayBookSessionAction } from '@/app/(admin)/admin/vouchers/actions'
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
        color: 'emerald',
        gradient: 'from-emerald-500/20 to-emerald-600/5',
        iconBg: 'bg-emerald-500/15',
        iconColor: 'text-emerald-400',
        border: 'border-emerald-500/20',
        activeBorder: 'border-emerald-500',
        glow: 'shadow-emerald-500/20',
    },
    {
        type: 'cash_out' as EntryType,
        icon: TrendingDown,
        label: 'Cash Out',
        desc: 'Record cash payments, expenses, salaries, or any outgoing cash.',
        color: 'rose',
        gradient: 'from-rose-500/20 to-rose-600/5',
        iconBg: 'bg-rose-500/15',
        iconColor: 'text-rose-400',
        border: 'border-rose-500/20',
        activeBorder: 'border-rose-500',
        glow: 'shadow-rose-500/20',
    },
    {
        type: 'bank_transaction' as EntryType,
        icon: Landmark,
        label: 'Bank Transaction',
        desc: 'Record bank deposits or withdrawals directly to/from accounts.',
        color: 'blue',
        gradient: 'from-blue-500/20 to-blue-600/5',
        iconBg: 'bg-blue-500/15',
        iconColor: 'text-blue-400',
        border: 'border-blue-500/20',
        activeBorder: 'border-blue-500',
        glow: 'shadow-blue-500/20',
    },
    {
        type: 'voucher' as EntryType,
        icon: FileText,
        label: 'Voucher',
        desc: 'Create payment or receipt vouchers with party details and reference numbers.',
        color: 'orange',
        gradient: 'from-orange-500/20 to-orange-600/5',
        iconBg: 'bg-orange-500/15',
        iconColor: 'text-orange-400',
        border: 'border-orange-500/20',
        activeBorder: 'border-orange-500',
        glow: 'shadow-orange-500/20',
    },
    {
        type: 'inventory' as EntryType,
        icon: Package,
        label: 'Inventory Adjustment',
        desc: 'Manually add or remove stock from ingredients and supplies.',
        color: 'purple',
        gradient: 'from-purple-500/20 to-purple-600/5',
        iconBg: 'bg-purple-500/15',
        iconColor: 'text-purple-400',
        border: 'border-purple-500/20',
        activeBorder: 'border-purple-500',
        glow: 'shadow-purple-500/20',
    },
    {
        type: 'supplier_payment' as EntryType,
        icon: Truck,
        label: 'Supplier Payment',
        desc: 'Record a direct payment to a supplier against outstanding bills.',
        color: 'teal',
        gradient: 'from-teal-500/20 to-teal-600/5',
        iconBg: 'bg-teal-500/15',
        iconColor: 'text-teal-400',
        border: 'border-teal-500/20',
        activeBorder: 'border-teal-500',
        glow: 'shadow-teal-500/20',
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
        <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">{label}</label>
            <input
                {...props}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/30 focus:bg-white/8 transition-all"
            />
        </div>
    )
}

function SelectField({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">{label}</label>
            <select
                {...props}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-white/30 transition-all appearance-none"
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
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Ambient background */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-15%] left-[-10%] w-[500px] h-[500px] bg-brand-500 opacity-[0.06] blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-blue-500 opacity-[0.05] blur-[120px] rounded-full" />
            </div>

            <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-brand-500/15 border border-brand-500/20">
                            <PenLine size={20} className="text-brand-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white tracking-tight">Manual Entry</h1>
                            <p className="text-sm text-white/40 mt-0.5">All entry types in one place — no need to navigate between sections</p>
                        </div>
                    </div>

                    {/* Session warning */}
                    {!hasOpenSession && (
                        <div className="mt-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-3.5">
                            <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-amber-300">No Active Day Book Session</p>
                                <p className="text-xs text-amber-400/70 mt-0.5">Cash In, Cash Out, Bank, Voucher, and Supplier Payment entries require an open session.</p>
                            </div>
                            {canManage && (
                                <button
                                    onClick={handleOpenSession}
                                    disabled={isPending}
                                    className="shrink-0 text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
                                >
                                    {isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                                    Open Session
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex gap-6 items-start">
                    {/* Entry Type Grid */}
                    <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-white/30 mb-4">Select Entry Type</p>
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
                                            'group relative text-left rounded-2xl border p-4 transition-all duration-300 overflow-hidden',
                                            isActive
                                                ? `${card.activeBorder} bg-white/8 shadow-lg ${card.glow}`
                                                : `${card.border} bg-white/3 hover:bg-white/6 hover:border-white/20`,
                                        ].join(' ')}
                                    >
                                        {/* Gradient bg */}
                                        <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100' : ''}`} />

                                        <div className="relative z-10">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className={`p-2.5 rounded-xl ${card.iconBg}`}>
                                                    <Icon size={18} className={card.iconColor} />
                                                </div>
                                                <div className={`transition-all duration-300 ${isActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                                                    {isSuccess
                                                        ? <CheckCircle size={16} className="text-emerald-400" />
                                                        : <ChevronRight size={16} className={card.iconColor} />
                                                    }
                                                </div>
                                            </div>
                                            <p className="font-bold text-sm text-white">{card.label}</p>
                                            <p className="text-xs text-white/40 mt-1 leading-relaxed line-clamp-2">{card.desc}</p>
                                        </div>

                                        {isActive && (
                                            <div className={`absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-${card.color}-500 to-transparent`} />
                                        )}
                                    </button>
                                )
                            })}
                        </div>

                        {/* Tip */}
                        <div className="mt-5 flex items-center gap-2 text-white/20 text-xs">
                            <Info size={12} />
                            <span>Click any card to expand its form. Entries are posted immediately to the relevant ledgers.</span>
                        </div>
                    </div>

                    {/* Side Panel */}
                    <div className={[
                        'w-[360px] shrink-0 sticky top-6 transition-all duration-500',
                        activeType ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none',
                    ].join(' ')}>
                        {activeCard && (
                            <div className="bg-white/[0.04] border border-white/10 rounded-2xl overflow-hidden">
                                {/* Panel Header */}
                                <div className={`px-5 py-4 border-b border-white/8 bg-gradient-to-r ${activeCard.gradient}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-xl ${activeCard.iconBg}`}>
                                                <activeCard.icon size={16} className={activeCard.iconColor} />
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm text-white">{activeCard.label}</p>
                                                <p className="text-[11px] text-white/40 mt-0.5">Fill in the details below</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setActiveType(null)}
                                            className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Form Body */}
                                <div className="p-5 space-y-4">
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
                                                onChange={e => updateForm('supplier_payment', 'supplier_id', e.target.value)}
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
                                                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                                                : `bg-gradient-to-r from-brand-500 to-[#ff7a00] text-white hover:shadow-lg hover:shadow-brand-500/25 hover:scale-[1.02] active:scale-[0.98]`,
                                        ].join(' ')}
                                    >
                                        {isPending
                                            ? <><Loader2 size={15} className="animate-spin" /> Saving...</>
                                            : <><ArrowRight size={15} /> Save Entry</>
                                        }
                                    </button>

                                    {/* Success state */}
                                    {lastSuccess?.type === activeType && (
                                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2.5 text-xs text-emerald-400">
                                            <CheckCircle size={13} />
                                            Entry saved! Form cleared for next entry.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Placeholder when nothing selected */}
                        {!activeType && (
                            <div className="bg-white/[0.03] border border-white/8 border-dashed rounded-2xl p-8 text-center">
                                <div className="p-3 rounded-2xl bg-white/5 inline-flex mb-3">
                                    <PenLine size={22} className="text-white/20" />
                                </div>
                                <p className="text-sm font-semibold text-white/30">Select an entry type</p>
                                <p className="text-xs text-white/20 mt-1.5">Click any card on the left to open its form here</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
