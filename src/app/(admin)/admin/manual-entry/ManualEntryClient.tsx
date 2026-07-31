'use client'

import { useState, useTransition, useMemo } from 'react'
import {
    TrendingUp, TrendingDown, Landmark, FileText, Package, Truck,
    X, ChevronRight, Loader2, CheckCircle, AlertCircle, ArrowRight,
    PenLine, Banknote, Building2, Receipt, Boxes, HandCoins, Info
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { createVoucherAction, openTodayDayBookSessionAction, getSupplierOutstandingBalanceAction, getStaffCurrentDueAction, getCustomerOutstandingBalanceAction } from '@/app/(admin)/admin/vouchers/actions'
import { addStockMovementAction, createIngredientAction } from '@/app/(admin)/admin/ingredients/actions'
import { createSupplierBillAction, createSupplierAction } from '@/app/(admin)/admin/suppliers/actions'
import { createReceivableTransactionAction } from '@/app/(admin)/admin/finance/receivables/actions'
import type { BankAccount, ExpenseCategory, Supplier } from '@/types/database'
import { orderCategoriesForDisplay, findMainCategory, buildDescriptionWithName, chequeTypeForBankAccount } from '@/lib/utils'
import Select from '@/components/ui/Select'
import { NepaliDateInput } from '@/components/ui/NepaliDateInput'
import SupplierPaymentFields, {
    EMPTY_SUPPLIER_PAYMENT, validateSupplierPayment, isUnderpaidSplit, underpaidSplitConfirmMessage,
    UNSPECIFIED_SUPPLIER_NAME, OTHERS_SUPPLIER_ID, buildChequeDetailsFromSupplierPayment, type SupplierPaymentValue
} from '@/components/admin/SupplierPaymentFields'
import { useConfirmStore } from '@/lib/stores/confirm'

// ─── Types ───────────────────────────────────────────────────────────────────

interface StaffMember { id: string; full_name: string }
interface IngredientItem { id: string; name: string; unit: string; stock_quantity: number; category_id?: string | null }

interface ManualEntryClientProps {
    bankAccounts: BankAccount[]
    suppliers: Supplier[]
    staffList: StaffMember[]
    expenseCategories: ExpenseCategory[]
    ingredients: IngredientItem[]
    customerAccounts?: any[]
    hasOpenSession: boolean
    sessionId: string | null
    userRole: string
    restaurantId: string
}

type EntryType = 'cash_in' | 'cash_out' | 'bank_transaction' | 'voucher' | 'inventory' | 'supplier_payment' | 'staff_payment' | 'expense_payment' | 'customer_payment'

// ─── Entry Cards Config ───────────────────────────────────────────────────────

const ENTRY_CARDS = [
    {
        type: 'cash_in' as EntryType,
        icon: TrendingUp,
        label: 'Cash In',
        desc: 'Record cash received, sales proceeds, advances, or any incoming cash.',
        iconBg: 'bg-emerald-50',
        iconColor: 'text-emerald-600',
        border: 'border-hairline',
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
        border: 'border-hairline',
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
        border: 'border-hairline',
        activeBorder: 'border-blue-500',
        activeBg: 'bg-blue-50/60',
    },
    {
        type: 'voucher' as EntryType,
        icon: FileText,
        label: 'Voucher',
        desc: 'Create payment or receipt vouchers with party details and reference numbers.',
        iconBg: 'bg-orange-50',
        iconColor: 'text-brand-500',
        border: 'border-hairline',
        activeBorder: 'border-brand-500',
        activeBg: 'bg-orange-50/60',
    },
    {
        type: 'inventory' as EntryType,
        icon: Package,
        label: 'Inventory Adjustment',
        desc: 'Manually add or remove stock from ingredients and supplies.',
        iconBg: 'bg-purple-50',
        iconColor: 'text-purple-600',
        border: 'border-hairline',
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
        border: 'border-hairline',
        activeBorder: 'border-teal-500',
        activeBg: 'bg-teal-50/60',
    },
    {
        type: 'staff_payment' as EntryType,
        icon: HandCoins,
        label: 'Staff Salary Payment',
        desc: 'Pay a staff member salary, advance, or bonus against their ledger.',
        iconBg: 'bg-amber-50',
        iconColor: 'text-amber-600',
        border: 'border-hairline',
        activeBorder: 'border-amber-500',
        activeBg: 'bg-amber-50/60',
    },
    {
        type: 'expense_payment' as EntryType,
        icon: Receipt,
        label: 'Expense Payment',
        desc: 'Record a categorized business expense — cash, QR, or bank.',
        iconBg: 'bg-rose-50',
        iconColor: 'text-rose-600',
        border: 'border-hairline',
        activeBorder: 'border-rose-500',
        activeBg: 'bg-rose-50/60',
    },
    {
        type: 'customer_payment' as EntryType,
        icon: HandCoins,
        label: 'Customer Credit Repayment',
        desc: 'Record a payment received from a credit customer and reduce their due.',
        iconBg: 'bg-teal-50',
        iconColor: 'text-teal-600',
        border: 'border-hairline',
        activeBorder: 'border-teal-500',
        activeBg: 'bg-teal-50/60',
    },
]

// ─── Form State Types ─────────────────────────────────────────────────────────

const emptyForms = {
    cash_in: { amount: '', description: '', category: 'other' },
    cash_out: { amount: '', description: '', category: 'other', expense_category_id: '', bank_name: '', staff_id: '', supplier_id: '' },
    bank_transaction: { amount: '', description: '', bank_name: '', transaction_type: 'deposit', category: 'other', expense_category_id: '', staff_id: '', supplier_id: '' },
    voucher: { voucher_type: 'receipt', party_name: '', amount: '', particulars: '', payment_mode: 'cash', bank_name: '' },
    inventory: { ingredient_id: '', movement_type: 'purchase', quantity: '', rate: '', unit: 'kg', category_id: '', supplier_id: '', bill_number: '', paid_amount: '', notes: '' },
    supplier_payment: { supplier_id: '', amount: '', payment_source: 'cash', bank_name: '', notes: '' },
    staff_payment: { staff_id: '', entry_type: 'salary_payout', amount: '', payment_mode: 'cash', bank_name: '', notes: '' },
    expense_payment: { amount: '', expense_category_id: '', supplier_id: '', payment_mode: 'cash', bank_name: '', description: '' },
    customer_payment: { customer_id: '', amount: '', payment_mode: 'cash', bank_name: '', description: '' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InputField({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <div className="space-y-1.5">
            <label className="block text-small font-bold text-ink">{label}</label>
            <input
                {...props}
                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm px-3 py-2 border bg-surface text-ink placeholder:text-ink-subtle placeholder:font-normal transition-all"
            />
        </div>
    )
}

function SelectField({ label, children, rightElement, ...props }: {
    label: string
    value: string
    onChange: (e: { target: { value: string } }) => void
    disabled?: boolean
    required?: boolean
    searchable?: boolean
    rightElement?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <label className="block text-small font-bold text-ink">{label}</label>
                {rightElement}
            </div>
            <Select
                {...props}
                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm px-3 py-2 border bg-surface text-ink transition-all cursor-pointer"
            >
                {children}
            </Select>
        </div>
    )
}

// ─── Cheque fields ────────────────────────────────────────────────────────────
// Shared by every payment-method picker that offers a Cheque option — same
// field set/labels as PayPartyModal.tsx (the proven reference implementation),
// so a cheque entered anywhere lands in the same shape createVoucherAction
// already expects.

interface ChequeDetailsValue {
    written_name: string
    bank_cheque: string
    cheque_number: string
    cheque_date: string
    cheque_type: 'ac_payee' | 'normal'
}

const EMPTY_CHEQUE_DETAILS: ChequeDetailsValue = {
    written_name: '', bank_cheque: '', cheque_number: '', cheque_date: '', cheque_type: 'ac_payee',
}

function ChequeDetailsFields({ value, onChange }: { value: ChequeDetailsValue; onChange: (v: ChequeDetailsValue) => void }) {
    return (
        <div className="space-y-4 border-t border-hairline pt-4 animate-in slide-in-from-top-2 duration-200">
            <p className="text-xs font-black text-purple-700 uppercase tracking-wider">Cheque Specifications</p>
            <InputField
                label="Written Name (Given By)"
                type="text"
                value={value.written_name}
                onChange={e => onChange({ ...value, written_name: e.target.value })}
            />
            <InputField
                label="Issuer Bank"
                type="text"
                placeholder="Which bank the cheque is drawn on"
                value={value.bank_cheque}
                onChange={e => onChange({ ...value, bank_cheque: e.target.value })}
            />
            <InputField
                label="Cheque Number"
                type="text"
                value={value.cheque_number}
                onChange={e => onChange({ ...value, cheque_number: e.target.value })}
            />
            <div className="space-y-1.5">
                <label className="block text-small font-bold text-ink">Cheque Date</label>
                <NepaliDateInput
                    aria-label="Cheque date"
                    value={value.cheque_date}
                    onChange={cheque_date => onChange({ ...value, cheque_date })}
                />
            </div>
            <SelectField
                label="Cheque Type"
                value={value.cheque_type}
                onChange={e => onChange({ ...value, cheque_type: e.target.value as 'ac_payee' | 'normal' })}
            >
                <option value="ac_payee">A/C Payee (Company)</option>
                <option value="normal">Normal Person Cheque</option>
            </SelectField>
        </div>
    )
}

// Mirrors PayPartyModal's inline cheque validation exactly.
function validateChequeDetails(v: ChequeDetailsValue): string | null {
    if (!v.written_name.trim()) return 'Cheque written name is required'
    if (!v.bank_cheque.trim()) return 'Issuer bank is required'
    if (!v.cheque_number.trim()) return 'Cheque number is required'
    if (!v.cheque_date.trim()) return 'Cheque date is required'
    return null
}

function buildChequeDetailsPayload(v: ChequeDetailsValue) {
    return {
        written_name: v.written_name.trim(),
        bank_cheque: v.bank_cheque.trim(),
        cheque_number: v.cheque_number.trim(),
        cheque_date: v.cheque_date.trim(),
        cheque_type: v.cheque_type,
    }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManualEntryClient({
    bankAccounts,
    suppliers: initialSuppliers,
    staffList,
    expenseCategories,
    ingredients: initialIngredients,
    customerAccounts: initialCustomerAccounts = [],
    hasOpenSession,
    sessionId,
    userRole,
    restaurantId,
}: ManualEntryClientProps) {
    const { confirm } = useConfirmStore()
    const [activeType, setActiveType] = useState<EntryType | null>(null)
    const [suppliers, setSuppliersList] = useState<Supplier[]>(initialSuppliers)
    // Local so a brand-new stock item typed into the Inventory Adjustment
    // combobox shows up immediately in later searches, no reload needed.
    const [ingredientsList, setIngredientsList] = useState<IngredientItem[]>(initialIngredients)
    const [customerAccounts, setCustomerAccounts] = useState<any[]>(initialCustomerAccounts)
    const [showSupplierModal, setShowSupplierModal] = useState(false)
    const [newSupplierForm, setNewSupplierForm] = useState({ name: '', phone: '', pan: '', vat: '', address: '', category_id: '' })
    const [isSavingSupplier, setIsSavingSupplier] = useState(false)
    // Ingredient/item combobox: free-text search over existing stock items,
    // with the option to type a name that doesn't exist yet — it's created as
    // a new stock item on save instead of requiring a separate trip to Stock.
    const [ingredientQuery, setIngredientQuery] = useState('')
    const [showIngredientSuggestions, setShowIngredientSuggestions] = useState(false)
    const [forms, setForms] = useState(emptyForms)
    const [isPending, startTransition] = useTransition()
    const [lastSuccess, setLastSuccess] = useState<{ type: EntryType; label: string } | null>(null)
    const expenseCategoryOptions = useMemo(() => orderCategoriesForDisplay(expenseCategories), [expenseCategories])
    // A purchase-type stock movement optionally bills a supplier — same
    // payment-method picker (cash/qr/cheque/split) as the Suppliers Ledger's
    // own "Record Bill" flow.
    const [inventoryPayment, setInventoryPayment] = useState<SupplierPaymentValue>(EMPTY_SUPPLIER_PAYMENT)
    // Shared cheque-detail fields for every card that offers a Cheque payment
    // method (Voucher, Supplier/Staff/Expense Payment) — only one card is ever
    // open at a time, same reasoning as inventoryPayment above.
    const [chequeDetails, setChequeDetails] = useState<ChequeDetailsValue>(EMPTY_CHEQUE_DETAILS)

    const handleQuickAddSupplier = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newSupplierForm.name.trim()) { toast.error('Supplier name is required'); return }
        if (!newSupplierForm.phone.trim()) { toast.error('Phone number is required'); return }
        setIsSavingSupplier(true)
        try {
            const res = await createSupplierAction(newSupplierForm)
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const sObj = res.data as Supplier
                setSuppliersList(prev => [...prev, sObj].sort((a, b) => a.name.localeCompare(b.name)))
                toast.success('Supplier added successfully!')
                
                // Auto-select the newly added supplier in whatever form is currently open
                if (activeType === 'cash_out') updateForm('cash_out', 'supplier_id', sObj.id)
                else if (activeType === 'bank_transaction') updateForm('bank_transaction', 'supplier_id', sObj.id)
                else if (activeType === 'inventory') handleInventorySupplierSelect(sObj.id, sObj)
                else if (activeType === 'supplier_payment') updateForm('supplier_payment', 'supplier_id', sObj.id)
                else if (activeType === 'expense_payment') updateForm('expense_payment', 'supplier_id', sObj.id)

                setShowSupplierModal(false)
                setNewSupplierForm({ name: '', phone: '', pan: '', vat: '', address: '', category_id: '' })
            }
        } catch (err) {
            toast.error('Failed to create supplier')
        } finally {
            setIsSavingSupplier(false)
        }
    }

    const stockCategoryOptions = useMemo(
        () => orderCategoriesForDisplay(expenseCategories.filter(c => c.is_stock_category)),
        [expenseCategories],
    )
    // Both Cash Out and Bank Out (bank_transaction/withdrawal) can be tagged as
    // an expense — track whichever one is currently active.
    const activeExpenseCategoryId = activeType === 'cash_out'
        ? forms.cash_out.expense_category_id
        : activeType === 'bank_transaction'
            ? forms.bank_transaction.expense_category_id
            : ''
    // Auto-identifies the main category once a subcategory is picked.
    const selectedMainExpenseCategory = useMemo(
        () => findMainCategory(expenseCategories, activeExpenseCategoryId),
        [expenseCategories, activeExpenseCategoryId],
    )
    // is_stock_category covers the food/beverage/supply groups (Grocery,
    // Beverages, Supplies) — used as the "food related" signal for offering
    // a Supplier picker on an expense entry.
    const isActiveExpenseFoodRelated = expenseCategories.find(c => c.id === activeExpenseCategoryId)?.is_stock_category ?? false
    // Same "food related" signal as above, but for the standalone Expense
    // Payment card's own category field (not shared with Cash Out/Bank Out).
    const isActiveExpensePaymentFoodRelated = expenseCategories.find(c => c.id === forms.expense_payment.expense_category_id)?.is_stock_category ?? false

    const activeCard = ENTRY_CARDS.find(c => c.type === activeType)

    const canManage = ['manager', 'super_admin'].includes(userRole)
    // Inventory adjustments hit addStockMovementAction, which now also allows
    // 'cashier' server-side (so stock can be logged at the till) — hide the
    // card for anyone else instead of letting the submit fail.
    const canAdjustStock = ['manager', 'super_admin', 'cashier'].includes(userRole)
    const visibleCards = canAdjustStock ? ENTRY_CARDS : ENTRY_CARDS.filter(c => c.type !== 'inventory')

    function updateForm<T extends EntryType>(type: T, field: string, value: string) {
        setForms(prev => ({ ...prev, [type]: { ...prev[type], [field]: value } }))
    }

    // Bank Account field for Voucher/Supplier/Staff/Expense Payment (the
    // cards that offer Cheque as a payment method) — picking an account
    // whose ownership was set when it was added (Company → A/C Payee,
    // Personal → Normal) default-selects the matching Cheque Type in the
    // shared chequeDetails state, still changeable by hand afterward.
    function handleBankAccountSelect<T extends EntryType>(type: T, baName: string) {
        updateForm(type, 'bank_name', baName)
        const matched = bankAccounts.find(b => b.name === baName)
        const suggested = chequeTypeForBankAccount(matched?.bank_name)
        if (suggested) setChequeDetails(prev => ({ ...prev, cheque_type: suggested }))
    }

    // Case-insensitive: typing the exact existing name (rather than clicking
    // its suggestion) still resolves to that item instead of creating a
    // duplicate.
    const ingredientExactMatch = useMemo(
        () => ingredientsList.find(i => i.name.toLowerCase() === ingredientQuery.trim().toLowerCase()) || null,
        [ingredientsList, ingredientQuery],
    )
    const ingredientSuggestions = useMemo(() => {
        const q = ingredientQuery.trim().toLowerCase()
        const base = q ? ingredientsList.filter(i => i.name.toLowerCase().includes(q)) : ingredientsList
        return base.slice(0, 30)
    }, [ingredientsList, ingredientQuery])
    const isTypingNewIngredient = !forms.inventory.ingredient_id && ingredientQuery.trim().length > 0 && !ingredientExactMatch

    function handleIngredientQueryChange(value: string) {
        setIngredientQuery(value)
        setShowIngredientSuggestions(true)
        // The selected id is only trusted while the text still matches what
        // was picked — editing it back out of a selected name means "search
        // again", not "keep the old item".
        if (forms.inventory.ingredient_id) {
            const current = ingredientsList.find(i => i.id === forms.inventory.ingredient_id)
            if (!current || current.name !== value) updateForm('inventory', 'ingredient_id', '')
        }
    }

    function selectIngredientSuggestion(ing: IngredientItem) {
        updateForm('inventory', 'ingredient_id', ing.id)
        updateForm('inventory', 'unit', ing.unit)
        // An existing item's own established category always wins — it can
        // be bought from suppliers in different categories without the item
        // itself changing what it is, so this overrides whatever a supplier
        // pick may have defaulted in earlier. Left alone when the item has no
        // category of its own, so a supplier-provided default isn't wiped.
        if (ing.category_id) updateForm('inventory', 'category_id', ing.category_id)
        setIngredientQuery(ing.name)
        setShowIngredientSuggestions(false)
    }

    // Picking a supplier defaults the purchase Category to that supplier's
    // own category (set on the Suppliers page or Quick Add below), but only
    // as a fallback for a brand-new/uncategorized item — it never overwrites
    // a category the item already has (picked above, or from editing) or one
    // chosen by hand. `known` lets the just-created-supplier callback pass
    // the row directly rather than relying on `suppliers` state, which
    // hasn't re-rendered with it yet.
    function handleInventorySupplierSelect(sId: string, known?: Supplier) {
        updateForm('inventory', 'supplier_id', sId)
        const matched = known ?? suppliers.find(s => s.id === sId)
        if (!forms.inventory.category_id && matched?.category_id) updateForm('inventory', 'category_id', matched.category_id)
    }

    // Shared by Cash Out and Bank Out's "Expense" + Supplier picker — shows
    // what's already owed so paying it down doesn't need a second, separate
    // expense record (the bill was recorded once, at purchase time).
    const [expenseSupplierBalance, setExpenseSupplierBalance] = useState<number | null>(null)

    function handleExpenseSupplierSelect(type: 'cash_out' | 'bank_transaction', sId: string) {
        updateForm(type, 'supplier_id', sId)
        setExpenseSupplierBalance(null)
        if (!sId) return
        getSupplierOutstandingBalanceAction(sId).then(res => {
            if (res.data !== undefined) setExpenseSupplierBalance(res.data)
        })
    }

    // Shown as a persistent banner at the top of the Supplier/Staff Payment
    // forms once a party is picked — the toast auto-fill below is transient
    // and easy to miss, this stays visible the whole time the form is open.
    const [supplierPaymentBalance, setSupplierPaymentBalance] = useState<number | null>(null)
    const [staffPaymentBalance, setStaffPaymentBalance] = useState<number | null>(null)

    const handleSupplierPaymentSelect = (sId: string) => {
        updateForm('supplier_payment', 'supplier_id', sId)
        setSupplierPaymentBalance(null)
        if (!sId) {
            updateForm('supplier_payment', 'amount', '')
            updateForm('supplier_payment', 'notes', '')
            return
        }
        const supplierObj = suppliers.find(s => s.id === sId)
        const sName = supplierObj ? supplierObj.name : ''
        getSupplierOutstandingBalanceAction(sId).then(res => {
            if (res.data !== undefined) {
                setSupplierPaymentBalance(res.data)
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

    const [customerPaymentBalance, setCustomerPaymentBalance] = useState<number | null>(null)
    const handleCustomerPaymentSelect = (cId: string) => {
        updateForm('customer_payment', 'customer_id', cId)
        setCustomerPaymentBalance(null)
        if (!cId) {
            updateForm('customer_payment', 'amount', '')
            updateForm('customer_payment', 'description', '')
            return
        }
        const customerObj = customerAccounts.find(c => c.id === cId)
        const cName = customerObj ? customerObj.customer_name : ''
        getCustomerOutstandingBalanceAction(cId).then(res => {
            if (res.data !== undefined) {
                setCustomerPaymentBalance(res.data)
                setForms(prev => ({
                    ...prev,
                    customer_payment: {
                        ...prev.customer_payment,
                        amount: String(res.data),
                        description: `Credit repayment from ${cName}`
                    }
                }))
                toast.success(`Auto-filled due: Rs. ${res.data}`, { id: 'due-autofill-toast' })
            }
        })
    }

    // Mirrors handleSupplierPaymentSelect — but only auto-fills the amount for
    // a salary_payout, since advance/bonus have no "amount owed" to look up.
    const handleStaffPaymentSelect = (sId: string, entryType?: string) => {
        updateForm('staff_payment', 'staff_id', sId)
        setStaffPaymentBalance(null)
        if (!sId) {
            updateForm('staff_payment', 'amount', '')
            updateForm('staff_payment', 'notes', '')
            return
        }
        const staffObj = staffList.find(s => s.id === sId)
        const staffName = staffObj ? staffObj.full_name : ''
        const type = entryType ?? forms.staff_payment.entry_type
        if (type !== 'salary_payout') return
        getStaffCurrentDueAction(sId).then(res => {
            if (res.data !== undefined) {
                setStaffPaymentBalance(res.data)
                setForms(prev => ({
                    ...prev,
                    staff_payment: {
                        ...prev.staff_payment,
                        amount: String(res.data),
                        notes: `Salary payment to ${staffName}`
                    }
                }))
                toast.success(`Auto-filled due: Rs. ${res.data}`, { id: 'due-autofill-toast' })
            }
        })
    }

    // Switching entry type re-triggers the due lookup (or clears it) for
    // whichever staff member is already selected.
    const handleStaffEntryTypeChange = (entryType: string) => {
        updateForm('staff_payment', 'entry_type', entryType)
        if (forms.staff_payment.staff_id) {
            handleStaffPaymentSelect(forms.staff_payment.staff_id, entryType)
        }
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
        setInventoryPayment(EMPTY_SUPPLIER_PAYMENT)
        setChequeDetails(EMPTY_CHEQUE_DETAILS)
    }

    // ── Submit router ─────────────────────────────────────────
    async function handleSubmit() {
        if (!activeType) return

        // Validate session for entries that need it
        const needsSession: EntryType[] = ['cash_in', 'cash_out', 'bank_transaction', 'voucher', 'supplier_payment', 'staff_payment', 'expense_payment']
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

                    const cashOutForm = activeType === 'cash_out' ? (f as typeof forms.cash_out) : null
                    // Paying a known supplier settles their outstanding bill(s) directly
                    // in the Suppliers Ledger — the bill itself was already recorded once,
                    // at purchase time, so this must never create a second expense row.
                    const isSupplierExpense = !!(cashOutForm?.category === 'expense' && cashOutForm.supplier_id)

                    if (isSupplierExpense && cashOutForm) {
                        const supplierObj = suppliers.find(s => s.id === cashOutForm.supplier_id)
                        result = await createVoucherAction({
                            voucher_type: 'payment',
                            party_name: supplierObj?.name || '',
                            amount,
                            payment_mode: 'cash',
                            particulars: f.description.trim() || `Payment to ${supplierObj?.name || 'supplier'}`,
                            category: 'suppliers',
                            supplier_id: cashOutForm.supplier_id,
                        })
                    } else {
                        if (cashOutForm?.category === 'expense' && !cashOutForm.expense_category_id) {
                            toast.error('Select an expense category')
                            return
                        }
                        const staffName = cashOutForm?.category === 'salary'
                            ? staffList.find(s => s.id === cashOutForm.staff_id)?.full_name
                            : undefined
                        const finalDescription = buildDescriptionWithName(f.description.trim(), 'Staff', staffName)

                        const res = await fetch('/api/day-book/entries', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                session_id: sessionId,
                                type: activeType,
                                amount,
                                description: finalDescription,
                                category: (f as typeof forms.cash_in).category,
                                expense_category_id: cashOutForm?.category === 'expense'
                                    ? cashOutForm.expense_category_id || undefined
                                    : undefined,
                            }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        result = { data }

                        // Auto-pair bank deposit
                        if (activeType === 'cash_out' && cashOutForm?.category === 'bank_deposit') {
                            if (cashOutForm.bank_name) {
                                try {
                                    await fetch('/api/day-book/entries', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            session_id: sessionId,
                                            type: 'bank_in',
                                            amount,
                                            description: `Deposit: ${f.description.trim()}`,
                                            category: 'deposit',
                                            bank_name: cashOutForm.bank_name.trim(),
                                        }),
                                    })
                                } catch (e) {
                                    console.error('Failed to auto-pair bank deposit', e)
                                }
                            }
                        }
                    }

                } else if (activeType === 'bank_transaction') {
                    const f = forms.bank_transaction
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.bank_name) { toast.error('Select a bank account'); return }
                    if (!f.description.trim()) { toast.error('Description is required'); return }
                    if (!sessionId) { toast.error('No active session'); return }
                    const isWithdrawal = f.transaction_type === 'withdrawal'
                    const isSupplierExpense = isWithdrawal && f.category === 'expense' && !!f.supplier_id
                    if (isWithdrawal && f.category === 'expense' && !isSupplierExpense && !f.expense_category_id) {
                        toast.error('Select an expense category')
                        return
                    }

                    if (isSupplierExpense) {
                        const supplierObj = suppliers.find(s => s.id === f.supplier_id)
                        result = await createVoucherAction({
                            voucher_type: 'payment',
                            party_name: supplierObj?.name || '',
                            amount,
                            payment_mode: 'bank',
                            bank_name: f.bank_name,
                            particulars: f.description.trim() || `Payment to ${supplierObj?.name || 'supplier'}`,
                            category: 'suppliers',
                            supplier_id: f.supplier_id,
                        })
                    } else {
                        const staffName = isWithdrawal && f.category === 'salary'
                            ? staffList.find(s => s.id === f.staff_id)?.full_name
                            : undefined
                        const finalDescription = buildDescriptionWithName(f.description.trim(), 'Staff', staffName)

                        const entryType = f.transaction_type === 'deposit' ? 'bank_in' : 'bank_out'
                        const res = await fetch('/api/day-book/entries', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                session_id: sessionId,
                                type: entryType,
                                amount,
                                description: finalDescription,
                                category: f.transaction_type === 'deposit' ? 'deposit' : f.category,
                                expense_category_id: isWithdrawal && f.category === 'expense' ? f.expense_category_id : undefined,
                                bank_name: f.bank_name,
                            }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        result = { data }

                        // Auto-pair cash withdrawal (Bank Out -> Cash In)
                        if (isWithdrawal && f.category === 'withdrawal') {
                            try {
                                await fetch('/api/day-book/entries', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        session_id: sessionId,
                                        type: 'cash_in',
                                        amount,
                                        description: `Cash Withdrawal: ${f.description.trim()}`,
                                        category: 'withdrawal',
                                        bank_name: f.bank_name.trim(),
                                    }),
                                })
                            } catch (e) {
                                console.error('Failed to auto-pair cash withdrawal', e)
                            }
                        }

                        // Auto-pair cash deposit (Bank In -> Cash Out)
                        if (!isWithdrawal && f.category === 'cash_deposit') {
                            try {
                                await fetch('/api/day-book/entries', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        session_id: sessionId,
                                        type: 'cash_out',
                                        amount,
                                        description: `Cash Deposit: ${f.description.trim()}`,
                                        category: 'other',
                                        bank_name: f.bank_name.trim(),
                                    }),
                                })
                            } catch (e) {
                                console.error('Failed to auto-pair cash deposit', e)
                            }
                        }
                    }

                } else if (activeType === 'voucher') {
                    const f = forms.voucher
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.party_name.trim()) { toast.error('Party name is required'); return }
                    if (!f.particulars.trim()) { toast.error('Particulars are required'); return }
                    if ((f.payment_mode === 'qr' || f.payment_mode === 'cheque') && !f.bank_name) { toast.error('Select a bank account'); return }
                    if (f.payment_mode === 'cheque') {
                        const chequeError = validateChequeDetails(chequeDetails)
                        if (chequeError) { toast.error(chequeError); return }
                    }

                    result = await createVoucherAction({
                        voucher_type: f.voucher_type as 'receipt' | 'payment',
                        party_name: f.party_name.trim(),
                        amount,
                        payment_mode: f.payment_mode as 'cash' | 'qr' | 'cheque' | 'bank',
                        bank_name: f.bank_name || undefined,
                        particulars: f.particulars.trim(),
                        cheque_details: f.payment_mode === 'cheque' ? buildChequeDetailsPayload(chequeDetails) : undefined,
                    })

                } else if (activeType === 'inventory') {
                    const f = forms.inventory
                    const qty = parseFloat(f.quantity)
                    const typedName = ingredientQuery.trim()

                    // Typing a name that matches an existing item exactly
                    // (without clicking its suggestion) still resolves to
                    // that item instead of creating a duplicate.
                    let ingredientId = f.ingredient_id
                    if (!ingredientId && typedName) {
                        const exact = ingredientsList.find(i => i.name.toLowerCase() === typedName.toLowerCase())
                        if (exact) ingredientId = exact.id
                    }
                    const isNewItem = !ingredientId

                    if (!ingredientId && !typedName) { toast.error('Select or type an ingredient/item name'); return }
                    if (isNaN(qty) || qty <= 0) { toast.error('Enter a valid quantity'); return }
                    if (isNewItem && f.movement_type !== 'purchase') {
                        toast.error('"' + typedName + '" isn\'t in your inventory yet — switch to "Add Stock (Purchase)" to create it, or pick an existing item.')
                        return
                    }

                    let selectedIngredient = ingredientsList.find(i => i.id === ingredientId)
                    const rate = parseFloat(f.rate) || 0
                    const willBill = f.movement_type === 'purchase' && rate > 0
                    const total = qty * rate
                    const paidAmount = parseFloat(f.paid_amount) || 0

                    // Same validation sequence as the Ingredients page's own Stock
                    // Movement modal — checked before anything is written, so a bad
                    // split or missing category can't leave stock updated but the
                    // bill unrecorded.
                    if (willBill) {
                        if (!f.category_id) { toast.error('Select a category to record this purchase'); return }
                        if (paidAmount > total) { toast.error('Paid amount cannot exceed the total amount'); return }
                        const paymentError = validateSupplierPayment(inventoryPayment, paidAmount)
                        if (paymentError) { toast.error(paymentError); return }
                        if (isUnderpaidSplit(inventoryPayment, paidAmount, total)) {
                            const ok = await confirm({ title: 'Underpaid split', message: underpaidSplitConfirmMessage(paidAmount, total), confirmText: 'Continue', isDestructive: false })
                            if (!ok) return
                        }
                    }

                    const supplierForNew = suppliers.find(s => s.id === f.supplier_id)

                    if (isNewItem) {
                        // Brand-new item — created with its starting stock set
                        // directly, the same way the Stock page's own "Create New
                        // Stock Item" does; no separate movement entry for this
                        // first quantity.
                        const createRes = await createIngredientAction({
                            restaurant_id: restaurantId,
                            name: typedName,
                            unit: f.unit,
                            stock_quantity: qty,
                            reorder_level: 10,
                            cost_per_unit: rate,
                            supplier: supplierForNew?.name || null,
                            category_id: f.category_id || null,
                        })
                        if (createRes.error) { toast.error(createRes.error); return }
                        const newIng = createRes.data as IngredientItem
                        setIngredientsList(prev => [...prev, newIng].sort((a, b) => a.name.localeCompare(b.name)))
                        selectedIngredient = newIng
                        ingredientId = newIng.id
                        result = { data: newIng }
                    } else {
                        result = await addStockMovementAction({
                            ingredient_id: ingredientId,
                            movement_type: f.movement_type,
                            quantity: qty,
                            notes: f.notes || undefined,
                        })
                    }

                    // A purchase also records a supplier bill — same pattern as the
                    // Suppliers Ledger's own "Record Bill" — so paying less than the
                    // total leaves the rest as a due balance on that supplier, and
                    // paying 0 records it as full credit rather than skipping the
                    // financial record entirely.
                    if (!result?.error && willBill) {
                        const selectedSupplier = suppliers.find(s => s.id === f.supplier_id)
                        const supplierName = f.supplier_id === OTHERS_SUPPLIER_ID || !f.supplier_id
                            ? UNSPECIFIED_SUPPLIER_NAME
                            : selectedSupplier?.name || UNSPECIFIED_SUPPLIER_NAME

                        const billRes = await createSupplierBillAction({
                            supplier_name: supplierName,
                            category_id: f.category_id,
                            text_desc: `${isNewItem ? 'Initial stock' : 'Restock'}: ${selectedIngredient?.name || typedName || 'ingredient'}`,
                            quantity: qty,
                            rate,
                            unit: selectedIngredient?.unit || f.unit || 'pcs',
                            amount: total,
                            paid_amount: paidAmount,
                            payment_source: inventoryPayment.payment_source,
                            bank_name: inventoryPayment.payment_source !== 'cash' ? inventoryPayment.bank_name.trim() : undefined,
                            cash_portion: inventoryPayment.payment_source === 'cash_qr' ? (parseFloat(inventoryPayment.cash_portion) || 0) : undefined,
                            qr_portion: inventoryPayment.payment_source === 'cash_qr' ? (parseFloat(inventoryPayment.qr_portion) || 0) : undefined,
                            cheque_details: inventoryPayment.payment_source === 'cheque' ? buildChequeDetailsFromSupplierPayment(inventoryPayment) : undefined,
                            bill_number: f.bill_number.trim() || undefined,
                        })
                        if (billRes.error) {
                            toast.error(`Stock updated, but the supplier bill wasn't recorded: ${billRes.error}`)
                        } else if (billRes.pendingApproval) {
                            toast.success('Stock updated. Cheque payment held pending manager approval.', { duration: 6000 })
                        } else if (billRes.warning) {
                            toast.error(billRes.warning)
                        }
                    }

                } else if (activeType === 'supplier_payment') {
                    const f = forms.supplier_payment
                    const amount = parseFloat(f.amount)
                    if (!f.supplier_id) { toast.error('Select a supplier'); return }
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if ((f.payment_source === 'qr' || f.payment_source === 'bank' || f.payment_source === 'cheque') && !f.bank_name) { toast.error('Select a bank account'); return }
                    if (f.payment_source === 'cheque') {
                        const chequeError = validateChequeDetails(chequeDetails)
                        if (chequeError) { toast.error(chequeError); return }
                    }
                    if (!sessionId) { toast.error('No active session'); return }

                    // Post as a voucher payment to supplier
                    const selectedSupplier = suppliers.find(s => s.id === f.supplier_id)
                    result = await createVoucherAction({
                        voucher_type: 'payment',
                        party_name: selectedSupplier?.name || f.supplier_id,
                        amount,
                        payment_mode: f.payment_source as 'cash' | 'qr' | 'cheque' | 'bank',
                        bank_name: f.bank_name || undefined,
                        particulars: f.notes?.trim() || `Payment to ${selectedSupplier?.name || 'supplier'}`,
                        category: 'suppliers',
                        supplier_id: f.supplier_id,
                        cheque_details: f.payment_source === 'cheque' ? buildChequeDetailsPayload(chequeDetails) : undefined,
                    })
                } else if (activeType === 'staff_payment') {
                    const f = forms.staff_payment
                    const amount = parseFloat(f.amount)
                    if (!f.staff_id) { toast.error('Select a staff member'); return }
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if ((f.payment_mode === 'qr' || f.payment_mode === 'bank' || f.payment_mode === 'cheque') && !f.bank_name) { toast.error('Select a bank account'); return }
                    if (f.payment_mode === 'cheque') {
                        const chequeError = validateChequeDetails(chequeDetails)
                        if (chequeError) { toast.error(chequeError); return }
                    }
                    if (!sessionId) { toast.error('No active session'); return }

                    const selectedStaff = staffList.find(s => s.id === f.staff_id)
                    const entryLabel = f.entry_type === 'advance_payment' ? 'Advance' : f.entry_type === 'bonus' ? 'Bonus' : 'Salary'
                    result = await createVoucherAction({
                        voucher_type: 'payment',
                        party_name: selectedStaff?.full_name || f.staff_id,
                        amount,
                        payment_mode: f.payment_mode as 'cash' | 'qr' | 'cheque' | 'bank',
                        bank_name: f.bank_name || undefined,
                        particulars: f.notes?.trim() || `${entryLabel} payment to ${selectedStaff?.full_name || 'staff member'}`,
                        category: 'staff',
                        staff_user_id: f.staff_id,
                        staff_entry_type: f.entry_type as 'salary_payout' | 'advance_payment' | 'bonus',
                        cheque_details: f.payment_mode === 'cheque' ? buildChequeDetailsPayload(chequeDetails) : undefined,
                    })
                } else if (activeType === 'expense_payment') {
                    const f = forms.expense_payment
                    const amount = parseFloat(f.amount)
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if (!f.expense_category_id) { toast.error('Select an expense category'); return }
                    if (!f.description.trim()) { toast.error('Description is required'); return }
                    if ((f.payment_mode === 'qr' || f.payment_mode === 'bank' || f.payment_mode === 'cheque') && !f.bank_name) { toast.error('Select a bank account'); return }
                    // Cheque only has a supported posting path via the Suppliers
                    // Ledger voucher branch below (createVoucherAction) — the plain
                    // Day Book route used for a no-supplier expense has no cheque/
                    // approval concept, so routing a cheque through it would silently
                    // skip the expense record and any approval gating entirely.
                    if (f.payment_mode === 'cheque') {
                        const chequeError = validateChequeDetails(chequeDetails)
                        if (chequeError) { toast.error(chequeError); return }
                    }
                    if (!sessionId) { toast.error('No active session'); return }

                    // Paying a known supplier settles their outstanding bill(s)
                    // directly in the Suppliers Ledger instead of double-recording
                    // a fresh expense — the bill was already recorded once, at
                    // purchase time. Mirrors the isSupplierExpense branch used by
                    // Cash Out / Bank Transaction's own Expense category.
                    if (f.supplier_id) {
                        const selectedSupplier = suppliers.find(s => s.id === f.supplier_id)
                        result = await createVoucherAction({
                            voucher_type: 'payment',
                            party_name: selectedSupplier?.name || '',
                            amount,
                            payment_mode: f.payment_mode as 'cash' | 'qr' | 'cheque' | 'bank',
                            bank_name: f.bank_name || undefined,
                            particulars: f.description.trim() || `Payment to ${selectedSupplier?.name || 'supplier'}`,
                            category: 'suppliers',
                            supplier_id: f.supplier_id,
                            cheque_details: f.payment_mode === 'cheque' ? buildChequeDetailsPayload(chequeDetails) : undefined,
                        })
                    } else if (f.payment_mode === 'cheque') {
                        result = await createVoucherAction({
                            voucher_type: 'payment',
                            party_name: f.description.trim().split(' ')[0] || 'General Expense',
                            amount,
                            payment_mode: 'cheque',
                            bank_name: f.bank_name || undefined,
                            particulars: f.description.trim(),
                            category: 'expenses',
                            expense_category_id: f.expense_category_id,
                            cheque_details: buildChequeDetailsPayload(chequeDetails),
                        })
                    } else {
                        const res = await fetch('/api/day-book/entries', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                session_id: sessionId,
                                type: f.payment_mode === 'cash' ? 'cash_out' : 'bank_out',
                                amount,
                                description: f.description.trim(),
                                category: 'expense',
                                expense_category_id: f.expense_category_id,
                                bank_name: f.payment_mode !== 'cash' ? f.bank_name : undefined,
                            }),
                        })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error)
                        result = { data }
                    }
                } else if (activeType === 'customer_payment') {
                    const f = forms.customer_payment
                    const amount = parseFloat(f.amount)
                    if (!f.customer_id) { toast.error('Select a customer'); return }
                    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid amount'); return }
                    if ((f.payment_mode === 'qr' || f.payment_mode === 'bank') && !f.bank_name) { toast.error('Select a bank account'); return }
                    if (!sessionId) { toast.error('No active session'); return }

                    const selectedCustomer = customerAccounts.find(c => c.id === f.customer_id)
                    const desc = f.description.trim() || `Credit repayment from ${selectedCustomer?.customer_name || 'customer'}`

                    result = await createReceivableTransactionAction({
                        customer_credit_account_id: f.customer_id,
                        type: 'payment',
                        amount,
                        description: desc,
                    })

                    if (result.error) {
                        toast.error(result.error)
                        return
                    }

                    try {
                        const entryType = f.payment_mode === 'cash' ? 'cash_in' : 'bank_in'
                        await fetch('/api/day-book/entries', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                session_id: sessionId,
                                type: entryType,
                                amount,
                                description: `Credit Payment: ${desc}`,
                                category: 'order_payment',
                                bank_name: f.payment_mode !== 'cash' ? f.bank_name.trim() : undefined,
                            }),
                        })
                    } catch (e) {
                        console.error('Failed to post customer payment day book entry', e)
                        toast.error('Customer payment logged, but failed to post to day book. Please log cash_in/bank_in manually.')
                    }
                }

                if (result?.error) {
                    toast.error(result.error)
                    return
                }

                const label = ENTRY_CARDS.find(c => c.type === activeType)?.label || activeType

                // A cheque voucher comes back with status packed into the Day
                // Book entry's JSON description rather than a plain field —
                // surface that distinctly so it's clear nothing settled yet.
                let pendingApproval = false
                const data = result?.data as { description?: string } | undefined
                if (data?.description) {
                    try { pendingApproval = JSON.parse(data.description)?.status === 'pending_approval' } catch { /* not voucher-shaped */ }
                }

                if (pendingApproval) {
                    toast.success(`${label} recorded as a cheque — held pending manager approval. It won't affect any balance until approved.`, { duration: 6000 })
                } else {
                    toast.success(`${label} entry saved successfully!`)
                }
                setLastSuccess({ type: activeType, label })
                setForms(prev => ({ ...prev, [activeType]: emptyForms[activeType] }))
                if (activeType === 'inventory') {
                    setInventoryPayment(EMPTY_SUPPLIER_PAYMENT)
                    setIngredientQuery('')
                    setShowIngredientSuggestions(false)
                }
                setChequeDetails(EMPTY_CHEQUE_DETAILS)

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
                        <PenLine size={20} className="text-brand-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Manual Entry</h1>
                        <p className="text-sm text-ink-subtle mt-0.5">All entry types in one place — no need to navigate between sections</p>
                    </div>
                </div>

                {/* Session warning */}
                {!hasOpenSession && (
                    <div className="mt-5 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5">
                        <AlertCircle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-amber-800">No Active Day Book Session</p>
                            <p className="text-xs text-amber-600 mt-0.5">Cash In, Cash Out, Bank, Voucher, Supplier Payment, Staff Salary Payment, and Expense Payment entries require an open session.</p>
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
                    <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle mb-4">Select Entry Type</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {visibleCards.map((card) => {
                            const Icon = card.icon
                            const isActive = activeType === card.type
                            const isSuccess = lastSuccess?.type === card.type

                            return (
                                <button
                                    key={card.type}
                                    onClick={() => selectCard(card.type)}
                                    className={[
                                        'group relative text-left rounded-2xl border p-4 transition-all duration-300 bg-surface shadow-[0_4px_20px_rgb(0,0,0,0.01)]',
                                        isActive
                                            ? `${card.activeBorder} ${card.activeBg} shadow-md`
                                            : `${card.border} hover:border-hairline hover:shadow-md`,
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
                                    <p className="font-bold text-sm text-ink">{card.label}</p>
                                    <p className="text-xs text-ink-subtle mt-1 leading-relaxed line-clamp-2">{card.desc}</p>
                                </button>
                            )
                        })}
                    </div>

                    {/* Tip */}
                    <div className="mt-5 flex items-center gap-2 text-ink-subtle text-xs">
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
                        <div className="bg-surface border border-hairline rounded-2xl overflow-hidden shadow-sm">
                            {/* Panel Header */}
                            <div className={`px-5 py-4 border-b border-hairline ${activeCard.iconBg}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-xl bg-surface">
                                            <activeCard.icon size={16} className={activeCard.iconColor} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-sm text-ink">{activeCard.label}</p>
                                            <p className="text-[11px] text-ink-subtle mt-0.5">Fill in the details below</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setActiveType(null)}
                                        className="p-1.5 rounded-lg hover:bg-surface/60 text-ink-subtle hover:text-ink transition-colors"
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
                                                <option value="bank_deposit">Deposit to Own Bank</option>
                                                <option value="other">Other</option>
                                            </SelectField>

                                            {forms.cash_out.category === 'salary' && staffList.length > 0 && (
                                                <SelectField
                                                    label="Staff Member"
                                                    value={forms.cash_out.staff_id}
                                                    onChange={e => updateForm('cash_out', 'staff_id', e.target.value)}
                                                    searchable
                                                >
                                                    <option value="">Select staff member...</option>
                                                    {staffList.map(s => (
                                                        <option key={s.id} value={s.id}>{s.full_name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.cash_out.category === 'expense' && expenseCategories.length > 0 && (
                                                <SelectField
                                                    label="Expense Category"
                                                    value={forms.cash_out.expense_category_id}
                                                    onChange={e => updateForm('cash_out', 'expense_category_id', e.target.value)}
                                                    searchable
                                                >
                                                    <option value="">Select category...</option>
                                                    {expenseCategoryOptions.map(({ category, label }) => (
                                                        <option key={category.id} value={category.id}>{label}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {selectedMainExpenseCategory && (
                                                <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider -mt-1">
                                                    Main Category: <span className="text-ink-subtle normal-case">{selectedMainExpenseCategory.name}</span>
                                                </p>
                                            )}
                                            {forms.cash_out.category === 'expense' && isActiveExpenseFoodRelated && suppliers.length > 0 && (
                                                <SelectField
                                                    label="Supplier"
                                                    value={forms.cash_out.supplier_id}
                                                    onChange={e => updateForm('cash_out', 'supplier_id', e.target.value)}
                                                    rightElement={
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSupplierModal(true)}
                                                            className="text-[10px] font-black text-brand-600 hover:text-brand-700 hover:underline uppercase tracking-wider transition-all"
                                                        >
                                                            + Quick Add
                                                        </button>
                                                    }
                                                    searchable
                                                >
                                                    <option value="">Select supplier...</option>
                                                    {suppliers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
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
                                            {forms.bank_transaction.transaction_type === 'deposit' && (
                                                <SelectField
                                                    label="Category"
                                                    value={forms.bank_transaction.category}
                                                    onChange={e => updateForm('bank_transaction', 'category', e.target.value)}
                                                >
                                                    <option value="cash_deposit">Deposit Cash to Own Bank</option>
                                                    <option value="other">Other</option>
                                                </SelectField>
                                            )}
                                            {forms.bank_transaction.transaction_type === 'withdrawal' && (
                                                <SelectField
                                                    label="Category"
                                                    value={forms.bank_transaction.category}
                                                    onChange={e => updateForm('bank_transaction', 'category', e.target.value)}
                                                >
                                                    <option value="expense">Expense</option>
                                                    <option value="salary">Salary / Wage</option>
                                                    <option value="advance">Advance</option>
                                                    <option value="refund">Refund</option>
                                                    <option value="withdrawal">Bank to Hotel Cash</option>
                                                    <option value="other">Other</option>
                                                </SelectField>
                                            )}
                                            {forms.bank_transaction.transaction_type === 'withdrawal' && forms.bank_transaction.category === 'salary' && staffList.length > 0 && (
                                                <SelectField
                                                    label="Staff Member"
                                                    value={forms.bank_transaction.staff_id}
                                                    onChange={e => updateForm('bank_transaction', 'staff_id', e.target.value)}
                                                    searchable
                                                >
                                                    <option value="">Select staff member...</option>
                                                    {staffList.map(s => (
                                                        <option key={s.id} value={s.id}>{s.full_name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.bank_transaction.transaction_type === 'withdrawal' && forms.bank_transaction.category === 'expense' && expenseCategories.length > 0 && (
                                                <SelectField
                                                    label="Expense Category"
                                                    value={forms.bank_transaction.expense_category_id}
                                                    onChange={e => updateForm('bank_transaction', 'expense_category_id', e.target.value)}
                                                    searchable
                                                >
                                                    <option value="">Select category...</option>
                                                    {expenseCategoryOptions.map(({ category, label }) => (
                                                        <option key={category.id} value={category.id}>{label}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {selectedMainExpenseCategory && (
                                                <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider -mt-1">
                                                    Main Category: <span className="text-ink-subtle normal-case">{selectedMainExpenseCategory.name}</span>
                                                </p>
                                            )}
                                            {forms.bank_transaction.transaction_type === 'withdrawal' && forms.bank_transaction.category === 'expense' && isActiveExpenseFoodRelated && suppliers.length > 0 && (
                                                <SelectField
                                                    label="Supplier"
                                                    value={forms.bank_transaction.supplier_id}
                                                    onChange={e => updateForm('bank_transaction', 'supplier_id', e.target.value)}
                                                    rightElement={
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSupplierModal(true)}
                                                            className="text-[10px] font-black text-brand-600 hover:text-brand-700 hover:underline uppercase tracking-wider transition-all"
                                                        >
                                                            + Quick Add
                                                        </button>
                                                    }
                                                    searchable
                                                >
                                                    <option value="">Select supplier...</option>
                                                    {suppliers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
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
                                                <option value="cheque">Cheque</option>
                                            </SelectField>
                                            {(forms.voucher.payment_mode === 'qr' || forms.voucher.payment_mode === 'bank' || forms.voucher.payment_mode === 'cheque') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.voucher.bank_name}
                                                    onChange={e => handleBankAccountSelect('voucher', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.voucher.payment_mode === 'cheque' && (
                                                <ChequeDetailsFields value={chequeDetails} onChange={setChequeDetails} />
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
                                            <div className="space-y-1.5 relative">
                                                <label className="block text-small font-bold text-ink">Ingredient / Item</label>
                                                <input
                                                    type="text"
                                                    value={ingredientQuery}
                                                    onChange={e => handleIngredientQueryChange(e.target.value)}
                                                    onFocus={() => setShowIngredientSuggestions(true)}
                                                    onBlur={() => setTimeout(() => setShowIngredientSuggestions(false), 150)}
                                                    placeholder="Type to search stock, or type a new item name"
                                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm px-3 py-2 border bg-surface text-ink placeholder:text-ink-subtle placeholder:font-normal transition-all"
                                                />
                                                {showIngredientSuggestions && (
                                                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-surface border border-hairline rounded-[var(--r-md)] shadow-lg">
                                                        {ingredientSuggestions.map(ing => (
                                                            <button
                                                                type="button"
                                                                key={ing.id}
                                                                onMouseDown={() => selectIngredientSuggestion(ing)}
                                                                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted transition-colors flex items-center justify-between gap-2"
                                                            >
                                                                <span className="font-semibold text-ink">{ing.name}</span>
                                                                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider shrink-0">{ing.unit} · Stock: {ing.stock_quantity}</span>
                                                            </button>
                                                        ))}
                                                        {ingredientSuggestions.length === 0 && (
                                                            <p className="px-3 py-2 text-xs text-ink-subtle font-semibold">No matching stock items.</p>
                                                        )}
                                                        {ingredientQuery.trim() && !ingredientExactMatch && (
                                                            <div className="px-3 py-2 text-[11px] font-bold text-brand-600 border-t border-hairline bg-brand-50/40">
                                                                + &quot;{ingredientQuery.trim()}&quot; isn&apos;t in your inventory yet — it&apos;ll be created as a new stock item on save.
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {isTypingNewIngredient && (
                                                <SelectField
                                                    label="Unit (new item)"
                                                    value={forms.inventory.unit}
                                                    onChange={e => updateForm('inventory', 'unit', e.target.value)}
                                                >
                                                    {['kg', 'g', 'L', 'mL', 'pcs', 'bottle', 'packet', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </SelectField>
                                            )}
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
                                            {forms.inventory.movement_type === 'purchase' && (
                                                <>
                                                    <InputField
                                                        label="Rate (Rs. per unit)"
                                                        type="number"
                                                        placeholder="0.00"
                                                        value={forms.inventory.rate}
                                                        onChange={e => updateForm('inventory', 'rate', e.target.value)}
                                                        min="0"
                                                        step="0.01"
                                                    />
                                                    {(parseFloat(forms.inventory.quantity) || 0) > 0 && (parseFloat(forms.inventory.rate) || 0) > 0 && (
                                                        <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider -mt-1">
                                                            Total: <span className="text-ink-subtle normal-case tabular-nums">Rs. {((parseFloat(forms.inventory.quantity) || 0) * (parseFloat(forms.inventory.rate) || 0)).toLocaleString()}</span>
                                                        </p>
                                                    )}
                                                    <SelectField
                                                        label="Supplier (optional)"
                                                        value={forms.inventory.supplier_id}
                                                        onChange={e => handleInventorySupplierSelect(e.target.value)}
                                                        rightElement={
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowSupplierModal(true)}
                                                                className="text-[10px] font-black text-brand-600 hover:text-brand-700 hover:underline uppercase tracking-wider transition-all"
                                                            >
                                                                + Quick Add
                                                            </button>
                                                        }
                                                        searchable
                                                    >
                                                        <option value="">Unspecified / Others</option>
                                                        {suppliers.map(s => (
                                                            <option key={s.id} value={s.id}>{s.name}</option>
                                                        ))}
                                                    </SelectField>
                                                    <SelectField
                                                        label="Category"
                                                        value={forms.inventory.category_id}
                                                        onChange={e => updateForm('inventory', 'category_id', e.target.value)}
                                                        searchable
                                                    >
                                                        <option value="">Select category...</option>
                                                        {stockCategoryOptions.map(({ category, label }) => (
                                                            <option key={category.id} value={category.id}>{label}</option>
                                                        ))}
                                                    </SelectField>
                                                    <p className="text-[10px] font-bold text-ink-muted -mt-2">
                                                        Picking a supplier fills in their usual category above — change it any time.
                                                    </p>
                                                    <InputField
                                                        label="Supplier's Bill Number (optional)"
                                                        type="text"
                                                        placeholder="e.g. their invoice/bill reference"
                                                        value={forms.inventory.bill_number}
                                                        onChange={e => updateForm('inventory', 'bill_number', e.target.value)}
                                                    />
                                                    <InputField
                                                        label="Paid Amount (Rs.)"
                                                        type="number"
                                                        placeholder="0.00 (0 = fully on credit)"
                                                        value={forms.inventory.paid_amount}
                                                        onChange={e => updateForm('inventory', 'paid_amount', e.target.value)}
                                                        min="0"
                                                        step="0.01"
                                                    />
                                                    {(parseFloat(forms.inventory.paid_amount) || 0) > 0 && (
                                                        <SupplierPaymentFields
                                                            value={inventoryPayment}
                                                            onChange={setInventoryPayment}
                                                            bankAccounts={bankAccounts}
                                                            paidAmount={parseFloat(forms.inventory.paid_amount) || 0}
                                                        />
                                                    )}
                                                </>
                                            )}
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
                                                rightElement={
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowSupplierModal(true)}
                                                        className="text-[10px] font-black text-brand-600 hover:text-brand-700 hover:underline uppercase tracking-wider transition-all"
                                                    >
                                                        + Quick Add
                                                    </button>
                                                }
                                            >
                                                <option value="">Select supplier...</option>
                                                {suppliers.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </SelectField>
                                            {supplierPaymentBalance !== null && (
                                                <div className="flex items-center gap-2.5 bg-teal-50 border border-teal-200 rounded-xl px-3.5 py-2.5">
                                                    <Info size={14} className="text-teal-600 shrink-0" />
                                                    <p className="text-xs font-bold text-teal-800">
                                                        Outstanding balance: <span className="tabular-nums">Rs. {supplierPaymentBalance.toLocaleString()}</span>
                                                    </p>
                                                </div>
                                            )}
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
                                                <option value="cheque">Cheque</option>
                                            </SelectField>
                                            {(forms.supplier_payment.payment_source === 'qr' || forms.supplier_payment.payment_source === 'bank' || forms.supplier_payment.payment_source === 'cheque') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.supplier_payment.bank_name}
                                                    onChange={e => handleBankAccountSelect('supplier_payment', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.supplier_payment.payment_source === 'cheque' && (
                                                <ChequeDetailsFields value={chequeDetails} onChange={setChequeDetails} />
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

                                    {/* ── STAFF SALARY PAYMENT ── */}
                                    {activeType === 'staff_payment' && (
                                        <>
                                            <SelectField
                                                label="Staff Member"
                                                value={forms.staff_payment.staff_id}
                                                onChange={e => handleStaffPaymentSelect(e.target.value)}
                                                searchable
                                            >
                                                <option value="">Select staff member...</option>
                                                {staffList.map(s => (
                                                    <option key={s.id} value={s.id}>{s.full_name}</option>
                                                ))}
                                            </SelectField>
                                            <SelectField
                                                label="Payment Type"
                                                value={forms.staff_payment.entry_type}
                                                onChange={e => handleStaffEntryTypeChange(e.target.value)}
                                            >
                                                <option value="salary_payout">Salary Payout</option>
                                                <option value="advance_payment">Advance Payment</option>
                                                <option value="bonus">Bonus</option>
                                            </SelectField>
                                            {staffPaymentBalance !== null && forms.staff_payment.entry_type === 'salary_payout' && (
                                                <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                                                    <Info size={14} className="text-amber-600 shrink-0" />
                                                    <p className="text-xs font-bold text-amber-800">
                                                        Current due: <span className="tabular-nums">Rs. {staffPaymentBalance.toLocaleString()}</span>
                                                    </p>
                                                </div>
                                            )}
                                            <InputField
                                                label="Payment Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.staff_payment.amount}
                                                onChange={e => updateForm('staff_payment', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Payment Method"
                                                value={forms.staff_payment.payment_mode}
                                                onChange={e => updateForm('staff_payment', 'payment_mode', e.target.value)}
                                            >
                                                <option value="cash">Cash</option>
                                                <option value="qr">QR / Mobile Banking</option>
                                                <option value="bank">Bank Transfer</option>
                                                <option value="cheque">Cheque</option>
                                            </SelectField>
                                            {(forms.staff_payment.payment_mode === 'qr' || forms.staff_payment.payment_mode === 'bank' || forms.staff_payment.payment_mode === 'cheque') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.staff_payment.bank_name}
                                                    onChange={e => handleBankAccountSelect('staff_payment', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.staff_payment.payment_mode === 'cheque' && (
                                                <ChequeDetailsFields value={chequeDetails} onChange={setChequeDetails} />
                                            )}
                                            <InputField
                                                label="Notes (optional)"
                                                type="text"
                                                placeholder="Pay period or payment note"
                                                value={forms.staff_payment.notes}
                                                onChange={e => updateForm('staff_payment', 'notes', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── EXPENSE PAYMENT ── */}
                                    {activeType === 'expense_payment' && (
                                        <>
                                            <InputField
                                                label="Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.expense_payment.amount}
                                                onChange={e => updateForm('expense_payment', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            {expenseCategories.length > 0 && (
                                                <SelectField
                                                    label="Expense Category"
                                                    value={forms.expense_payment.expense_category_id}
                                                    onChange={e => updateForm('expense_payment', 'expense_category_id', e.target.value)}
                                                    searchable
                                                >
                                                    <option value="">Select category...</option>
                                                    {expenseCategoryOptions.map(({ category, label }) => (
                                                        <option key={category.id} value={category.id}>{label}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {isActiveExpensePaymentFoodRelated && suppliers.length > 0 && (
                                                <SelectField
                                                    label="Supplier"
                                                    value={forms.expense_payment.supplier_id}
                                                    onChange={e => updateForm('expense_payment', 'supplier_id', e.target.value)}
                                                    rightElement={
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowSupplierModal(true)}
                                                            className="text-[10px] font-black text-brand-600 hover:text-brand-700 hover:underline uppercase tracking-wider transition-all"
                                                        >
                                                            + Quick Add
                                                        </button>
                                                    }
                                                    searchable
                                                >
                                                    <option value="">Select supplier...</option>
                                                    {suppliers.map(s => (
                                                        <option key={s.id} value={s.id}>{s.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            <SelectField
                                                label="Payment Method"
                                                value={forms.expense_payment.payment_mode}
                                                onChange={e => updateForm('expense_payment', 'payment_mode', e.target.value)}
                                            >
                                                <option value="cash">Cash</option>
                                                <option value="qr">QR / Mobile Banking</option>
                                                <option value="bank">Bank Transfer</option>
                                                <option value="cheque">Cheque</option>
                                            </SelectField>
                                            {(forms.expense_payment.payment_mode === 'qr' || forms.expense_payment.payment_mode === 'bank' || forms.expense_payment.payment_mode === 'cheque') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.expense_payment.bank_name}
                                                    onChange={e => handleBankAccountSelect('expense_payment', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            {forms.expense_payment.payment_mode === 'cheque' && (
                                                <ChequeDetailsFields value={chequeDetails} onChange={setChequeDetails} />
                                            )}
                                            <InputField
                                                label="Description"
                                                type="text"
                                                placeholder="What is this expense for?"
                                                value={forms.expense_payment.description}
                                                onChange={e => updateForm('expense_payment', 'description', e.target.value)}
                                            />
                                        </>
                                    )}

                                    {/* ── CUSTOMER PAYMENT ── */}
                                    {activeType === 'customer_payment' && (
                                        <>
                                            <SelectField
                                                label="Credit Customer"
                                                value={forms.customer_payment.customer_id}
                                                onChange={e => handleCustomerPaymentSelect(e.target.value)}
                                                searchable
                                            >
                                                <option value="">Select customer...</option>
                                                {customerAccounts.map(c => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.customer_name} {c.customer_phone ? `(${c.customer_phone})` : ''}
                                                    </option>
                                                ))}
                                            </SelectField>
                                            {customerPaymentBalance !== null && (
                                                <div className="flex items-center gap-2.5 bg-teal-50 border border-teal-200 rounded-xl px-3.5 py-2.5">
                                                    <Info size={14} className="text-teal-600 shrink-0" />
                                                    <p className="text-xs font-bold text-teal-800">
                                                        Outstanding balance: <span className="tabular-nums">Rs. {customerPaymentBalance.toLocaleString()}</span>
                                                    </p>
                                                </div>
                                            )}
                                            <InputField
                                                label="Repayment Amount (Rs.)"
                                                type="number"
                                                placeholder="0.00"
                                                value={forms.customer_payment.amount}
                                                onChange={e => updateForm('customer_payment', 'amount', e.target.value)}
                                                min="0"
                                                step="0.01"
                                            />
                                            <SelectField
                                                label="Payment Method"
                                                value={forms.customer_payment.payment_mode}
                                                onChange={e => updateForm('customer_payment', 'payment_mode', e.target.value)}
                                            >
                                                <option value="cash">Cash</option>
                                                <option value="qr">QR / Mobile Banking</option>
                                                <option value="bank">Bank Transfer</option>
                                            </SelectField>
                                            {(forms.customer_payment.payment_mode === 'qr' || forms.customer_payment.payment_mode === 'bank') && (
                                                <SelectField
                                                    label="Bank Account"
                                                    value={forms.customer_payment.bank_name}
                                                    onChange={e => updateForm('customer_payment', 'bank_name', e.target.value)}
                                                >
                                                    <option value="">Select bank...</option>
                                                    {bankAccounts.map(ba => (
                                                        <option key={ba.id} value={ba.name}>{ba.name}</option>
                                                    ))}
                                                </SelectField>
                                            )}
                                            <InputField
                                                label="Description / Notes (optional)"
                                                type="text"
                                                placeholder="Payment details or reference"
                                                value={forms.customer_payment.description}
                                                onChange={e => updateForm('customer_payment', 'description', e.target.value)}
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
                                            ? 'bg-surface-muted text-ink-subtle cursor-not-allowed'
                                            : 'bg-brand-500 hover:bg-brand-600 text-white shadow-md shadow-brand-500/20 hover:scale-[1.01] active:scale-[0.98]',
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
                        <div className="hidden lg:block bg-surface border border-dashed border-hairline rounded-2xl p-8 text-center">
                            <div className="p-3 rounded-2xl bg-surface-muted inline-flex mb-3">
                                <PenLine size={22} className="text-ink-subtle" />
                            </div>
                            <p className="text-sm font-semibold text-ink-subtle">Select an entry type</p>
                            <p className="text-xs text-ink-subtle mt-1.5">Click any card on the left to open its form here</p>
                        </div>
                    )}
                </div>
            </div>
            {/* Quick Add Supplier Modal */}
            {showSupplierModal && (
                <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <form
                        onSubmit={handleQuickAddSupplier}
                        className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150"
                    >
                        <div className="px-6 py-4 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <div>
                                <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Quick Setup</span>
                                <h2 className="text-base font-extrabold text-ink">Add New Supplier</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSupplierModal(false)}
                                className="p-1 text-ink-subtle hover:bg-surface-muted rounded-lg transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <InputField
                                label="Supplier Name"
                                required
                                value={newSupplierForm.name}
                                onChange={e => setNewSupplierForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Enter supplier name"
                            />
                            <InputField
                                label="Phone Number"
                                required
                                value={newSupplierForm.phone}
                                onChange={e => setNewSupplierForm(prev => ({ ...prev, phone: e.target.value }))}
                                placeholder="Enter phone number"
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <InputField
                                    label="PAN Number (optional)"
                                    value={newSupplierForm.pan}
                                    onChange={e => setNewSupplierForm(prev => ({ ...prev, pan: e.target.value }))}
                                    placeholder="Enter PAN"
                                />
                                <InputField
                                    label="VAT Number (optional)"
                                    value={newSupplierForm.vat}
                                    onChange={e => setNewSupplierForm(prev => ({ ...prev, vat: e.target.value }))}
                                    placeholder="Enter VAT"
                                />
                            </div>
                            <InputField
                                label="Address (optional)"
                                value={newSupplierForm.address}
                                onChange={e => setNewSupplierForm(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="Enter address"
                            />
                            <SelectField
                                label="Category"
                                value={newSupplierForm.category_id}
                                onChange={e => setNewSupplierForm(prev => ({ ...prev, category_id: e.target.value }))}
                                searchable
                            >
                                <option value="">Uncategorized</option>
                                {expenseCategoryOptions.map(({ category, label }) => (
                                    <option key={category.id} value={category.id}>{label}</option>
                                ))}
                            </SelectField>
                            <p className="text-[10px] font-bold text-ink-muted -mt-2">
                                Bills and stock purchases for this supplier will default to this category from now on.
                            </p>
                        </div>
                        <div className="px-6 py-4 bg-surface-muted/50 border-t border-hairline flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowSupplierModal(false)}
                                className="px-4 py-2 text-xs font-bold text-ink-subtle hover:bg-surface-muted rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSavingSupplier}
                                className="flex items-center gap-1.5 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-all"
                            >
                                {isSavingSupplier && <Loader2 size={12} className="animate-spin" />}
                                Save Supplier
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}
