'use client'

import { useState, useMemo, Fragment } from 'react'
import Modal from '@/components/ui/Modal'
import { createIngredientAction, addStockMovementAction, deleteIngredientAction, updateIngredientAction, createIngredientCategoryAction, createIngredientSupplierAction } from './actions'
import { createSupplierBillAction } from '../suppliers/actions'
import {
    Plus, Trash2, Edit2, AlertTriangle, Package, PackagePlus, X, Check, Loader2, Boxes, History,
    Apple, Carrot, Drumstick, Fish, Milk, CupSoda, Wheat, Croissant, Egg, Wine, Popcorn, Nut,
    Sprout, ShoppingBasket, type LucideIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import type { Ingredient, ExpenseCategory, Supplier, BankAccount } from '@/types/database'
import { fetchIngredientsData, fetchIngredientMovements } from '@/lib/swr-fetchers'
import { formatCurrency, orderCategoriesForDisplay, findMainCategory } from '@/lib/utils'
import SupplierPaymentFields, {
    EMPTY_SUPPLIER_PAYMENT, validateSupplierPayment, isUnderpaidSplit, underpaidSplitConfirmMessage,
    UNSPECIFIED_SUPPLIER_NAME, OTHERS_SUPPLIER_ID, buildChequeDetailsFromSupplierPayment, type SupplierPaymentValue
} from '@/components/admin/SupplierPaymentFields'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

export interface IngredientMovementRow {
    id: string
    movement_type: string
    quantity: number
    notes: string | null
    created_at: string
    ingredients: { id: string; name: string; unit: string } | { id: string; name: string; unit: string }[] | null
    users: { full_name: string | null } | { full_name: string | null }[] | null
}

const MOVEMENT_TYPE_LABEL: Record<string, string> = {
    purchase: 'Purchase',
    usage: 'Usage',
    waste: 'Waste / Spoilage',
    adjustment: 'Adjustment',
    transfer: 'Transfer',
}

// Ingredient categories are free-text and restaurant-created (no color/icon
// column on ExpenseCategory), so each one is assigned a color deterministically
// from its id — same category always lands on the same hue across reloads,
// without needing a database migration just to make the stock table's group
// headers distinguishable from each other.
const CATEGORY_PALETTE = [
    { row: 'bg-indigo-50/70', text: 'text-indigo-700', border: 'border-indigo-200', chip: 'bg-indigo-100 text-indigo-700' },
    { row: 'bg-emerald-50/70', text: 'text-emerald-700', border: 'border-emerald-200', chip: 'bg-emerald-100 text-emerald-700' },
    { row: 'bg-amber-50/70', text: 'text-amber-700', border: 'border-amber-200', chip: 'bg-amber-100 text-amber-700' },
    { row: 'bg-rose-50/70', text: 'text-rose-700', border: 'border-rose-200', chip: 'bg-rose-100 text-rose-700' },
    { row: 'bg-teal-50/70', text: 'text-teal-700', border: 'border-teal-200', chip: 'bg-teal-100 text-teal-700' },
    { row: 'bg-purple-50/70', text: 'text-purple-700', border: 'border-purple-200', chip: 'bg-purple-100 text-purple-700' },
    { row: 'bg-blue-50/70', text: 'text-blue-700', border: 'border-blue-200', chip: 'bg-blue-100 text-blue-700' },
    { row: 'bg-orange-50/70', text: 'text-orange-700', border: 'border-orange-200', chip: 'bg-orange-100 text-orange-700' },
] as const

function categoryStyle(id: string) {
    let hash = 0
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
    return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]
}

// A generic folder glyph reads as a placeholder, not a designed category — so
// this reaches for a real icon that matches what the category actually is,
// keyed off common grocery/kitchen category words. Falls back to a shopping
// basket (still specific to "this holds stock items", not just "a folder")
// for anything that doesn't match.
const CATEGORY_ICON_KEYWORDS: [RegExp, LucideIcon][] = [
    [/fruit/i, Apple],
    [/veg/i, Carrot],
    [/(meat|poultry|chicken|mutton|pork|beef)/i, Drumstick],
    [/(seafood|fish)/i, Fish],
    [/(dairy|milk|cheese|butter|paneer|yogurt|yoghurt)/i, Milk],
    [/(beverage|drink|juice|soda)/i, CupSoda],
    [/(alcohol|beer|wine|liquor|spirit)/i, Wine],
    [/(grain|rice|flour|cereal)/i, Wheat],
    [/(bakery|bread|bun|pastry)/i, Croissant],
    [/egg/i, Egg],
    [/(spice|herb|masala|seasoning)/i, Sprout],
    [/(snack|nut|dry\s?fruit)/i, Nut],
    [/(popcorn|chips)/i, Popcorn],
]

function categoryIcon(name: string): LucideIcon {
    return CATEGORY_ICON_KEYWORDS.find(([re]) => re.test(name))?.[1] ?? ShoppingBasket
}

export default function IngredientsManager({
    initialIngredients,
    restaurantId,
    initialCategories = [],
    initialSuppliers = [],
    initialBankAccounts = [],
    initialMovements = [],
}: {
    initialIngredients: Ingredient[]
    restaurantId: string
    initialCategories: ExpenseCategory[]
    initialSuppliers: Supplier[]
    initialBankAccounts?: BankAccount[]
    initialMovements?: IngredientMovementRow[]
}) {
    const [viewMode, setViewMode] = useState<'stock' | 'activities'>('stock')
    const { confirm } = useConfirmStore()
    const { data: ingredients = initialIngredients, mutate } = useSWR(
        ['ingredients', restaurantId],
        () => fetchIngredientsData(restaurantId),
        { fallbackData: initialIngredients }
    )
    const { data: movements = initialMovements, mutate: mutateMovements } = useSWR(
        ['ingredient-movements', restaurantId],
        () => fetchIngredientMovements(restaurantId) as unknown as Promise<IngredientMovementRow[]>,
        { fallbackData: initialMovements }
    )

    // Categories and Suppliers local states (for inline addition)
    const [categories, setCategories] = useState<ExpenseCategory[]>(initialCategories)
    const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
    const [bankAccounts] = useState<BankAccount[]>(initialBankAccounts)

    const [showAdd, setShowAdd] = useState(false)
    const [editingItem, setEditingItem] = useState<Ingredient | null>(null)
    const [stockModal, setStockModal] = useState<Ingredient | null>(null)
    const [showPicker, setShowPicker] = useState(false)
    const [pickerIngredientId, setPickerIngredientId] = useState('')
    const [form, setForm] = useState({
        name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '',
    })
    // Paid amount + method for the initial purchase when creating a brand-new
    // stock item with a supplier attached — mirrors the Suppliers Ledger bill
    // pattern (quantity/rate compute the total, paying less than the total
    // leaves the rest as a due balance on that supplier).
    const [createPaidAmount, setCreatePaidAmount] = useState('')
    const [createBillNumber, setCreateBillNumber] = useState('')
    const [createPayment, setCreatePayment] = useState<SupplierPaymentValue>(EMPTY_SUPPLIER_PAYMENT)
    const [moveForm, setMoveForm] = useState({
        movement_type: 'purchase', quantity: '', rate: '', paid_amount: '', notes: '', supplier_id: '', bill_number: '', category_id: ''
    })
    const [movePayment, setMovePayment] = useState<SupplierPaymentValue>(EMPTY_SUPPLIER_PAYMENT)
    const [saving, setSaving] = useState(false)

    // Inline Category form state
    const [showAddCategory, setShowAddCategory] = useState(false)
    const [newCategoryName, setNewCategoryName] = useState('')
    const [newCategoryDesc, setNewCategoryDesc] = useState('')
    const [newCategoryParentId, setNewCategoryParentId] = useState('')
    const [addingCategory, setAddingCategory] = useState(false)

    // Inline Supplier form state
    const [showAddSupplier, setShowAddSupplier] = useState(false)
    const [newSupplierName, setNewSupplierName] = useState('')
    const [newSupplierPhone, setNewSupplierPhone] = useState('')
    const [newSupplierAddress, setNewSupplierAddress] = useState('')
    const [addingSupplier, setAddingSupplier] = useState(false)

    function openEditModal(item: Ingredient) {
        setEditingItem(item)
        setForm({
            name: item.name,
            unit: item.unit,
            stock_quantity: item.stock_quantity.toString(),
            reorder_level: (item.reorder_level ?? 10).toString(),
            cost_per_unit: item.cost_per_unit.toString(),
            supplier: item.supplier || '',
            category_id: item.category_id || '',
        })
        setShowAdd(true)
    }

    function resetCreateForm() {
        setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '' })
        setCreatePaidAmount('')
        setCreateBillNumber('')
        setCreatePayment(EMPTY_SUPPLIER_PAYMENT)
        resetInlineSupplierForm()
        resetInlineCategoryForm()
    }

    async function handleCreateOrUpdate() {
        if (!form.name.trim()) { toast.error('Name required'); return }

        const quantity = parseFloat(form.stock_quantity) || 0
        const rate = parseFloat(form.cost_per_unit) || 0
        // Only a brand-new item with a real quantity/rate is an actual
        // purchase worth billing — editing an existing item changes nothing
        // financially. A supplier is not required — naming one is optional,
        // so a manager can still log the purchase purely for their own
        // records without registering a formal supplier.
        const willBill = !editingItem && quantity > 0 && rate > 0
        const paidAmount = parseFloat(createPaidAmount) || 0
        const createTotal = quantity * rate

        if (willBill) {
            if (!form.category_id) { toast.error('Select a Category to record this purchase'); return }
            if (paidAmount > createTotal) { toast.error('Paid amount cannot exceed the total amount'); return }
            const paymentError = validateSupplierPayment(createPayment, paidAmount)
            if (paymentError) { toast.error(paymentError); return }
            if (isUnderpaidSplit(createPayment, paidAmount, createTotal)) {
                const ok = await confirm({ title: 'Underpaid split', message: underpaidSplitConfirmMessage(paidAmount, createTotal), confirmText: 'Continue', isDestructive: false })
                if (!ok) return
            }
        }

        setSaving(true)

        const payload = {
            name: form.name,
            unit: form.unit,
            stock_quantity: quantity,
            reorder_level: parseFloat(form.reorder_level) || 0,
            cost_per_unit: rate,
            supplier: form.supplier || null,
            category_id: form.category_id || null,
        }

        if (editingItem) {
            // Stock quantity is owned by the movement ledger — editing it here
            // would bypass ingredient_movements and desync the audit trail. Drop it
            // from the update; quantity changes go through the Stock Movement action.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { stock_quantity: _sq, ...editable } = payload
            const result = await updateIngredientAction(editingItem.id, editable)
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            mutate()
            toast.success('Stock item updated!')
        } else {
            const result = await createIngredientAction({
                restaurant_id: restaurantId,
                ...payload
            })
            if (result.error) { setSaving(false); toast.error(result.error); return }
            if (result.data) { mutate(); mutateMovements() }

            if (willBill) {
                const billRes = await createSupplierBillAction({
                    supplier_name: form.supplier || undefined,
                    category_id: form.category_id,
                    text_desc: `Initial stock: ${form.name}`,
                    quantity,
                    rate,
                    unit: form.unit,
                    amount: createTotal,
                    paid_amount: paidAmount,
                    payment_source: createPayment.payment_source,
                    bank_name: createPayment.payment_source !== 'cash' ? createPayment.bank_name.trim() : undefined,
                    cash_portion: createPayment.payment_source === 'cash_qr' ? (parseFloat(createPayment.cash_portion) || 0) : undefined,
                    qr_portion: createPayment.payment_source === 'cash_qr' ? (parseFloat(createPayment.qr_portion) || 0) : undefined,
                    cheque_details: createPayment.payment_source === 'cheque' ? buildChequeDetailsFromSupplierPayment(createPayment) : undefined,
                    bill_number: createBillNumber.trim() || undefined,
                })
                setSaving(false)
                if (billRes.error) {
                    toast.error(`Stock item added, but the supplier bill wasn't recorded: ${billRes.error}`)
                } else if (billRes.pendingApproval) {
                    toast.success('Stock item added. Cheque payment held pending manager approval.', { duration: 6000 })
                } else {
                    toast.success('Stock item added and supplier bill recorded!')
                    if (billRes.warning) toast.error(billRes.warning)
                }
            } else {
                setSaving(false)
                toast.success('Stock item added!')
            }
        }
        setShowAdd(false)
        setEditingItem(null)
        resetCreateForm()
    }

    function resetInlineCategoryForm() {
        setShowAddCategory(false)
        setNewCategoryName('')
        setNewCategoryDesc('')
        setNewCategoryParentId('')
    }

    async function handleInlineAddCategory(e: React.FormEvent) {
        e.preventDefault()
        const name = newCategoryName.trim()
        if (!name) return
        setAddingCategory(true)
        const result = await createIngredientCategoryAction({
            restaurant_id: restaurantId,
            name,
            description: newCategoryDesc || undefined,
            parent_id: newCategoryParentId || undefined,
        })
        setAddingCategory(false)
        if (result.error) {
            toast.error(result.error)
            return
        }
        if (result.data) {
            setCategories(prev => [...prev, result.data as ExpenseCategory])
            setForm(f => ({ ...f, category_id: result.data.id }))
            resetInlineCategoryForm()
            toast.success('Category created inline!')
        }
    }

    function resetInlineSupplierForm() {
        setShowAddSupplier(false)
        setNewSupplierName('')
        setNewSupplierPhone('')
        setNewSupplierAddress('')
    }

    async function handleInlineAddSupplier(e: React.FormEvent) {
        e.preventDefault()
        const name = newSupplierName.trim()
        if (!name) return
        // Same inline-add UI is shared by the Create/Edit modal (form.category_id)
        // and the restock/"Add on Stock Item" modal (moveForm.category_id) —
        // only one of those modals is ever open at a time.
        const categoryId = stockModal ? moveForm.category_id : form.category_id
        setAddingSupplier(true)
        const result = await createIngredientSupplierAction({
            restaurant_id: restaurantId,
            name,
            phone: newSupplierPhone || undefined,
            address: newSupplierAddress || undefined,
            category_id: categoryId || null
        })
        setAddingSupplier(false)
        if (result.error) {
            toast.error(result.error)
            return
        }
        if (result.data) {
            const newSupplier = result.data as Supplier
            setSuppliers(prev => [...prev, newSupplier])
            if (stockModal) {
                setMoveForm(f => ({ ...f, supplier_id: newSupplier.id }))
            } else {
                setForm(f => ({ ...f, supplier: newSupplier.name }))
            }
            resetInlineSupplierForm()
            toast.success('Supplier created inline!')
        }
    }

    // Every supplier is selectable here — picking one auto-fills the Category
    // below from that supplier's own category (see the Supplier <Select>
    // onChange), so the category no longer needs filtering the supplier list.
    const filteredSuppliers = suppliers

    // Group ingredients by category dynamically
    const categorizedIngredients = useMemo(() => {
        const groups: Record<string, Ingredient[]> = {}
        ingredients.forEach(ing => {
            const catId = ing.category_id || ''
            if (!groups[catId]) {
                groups[catId] = []
            }
            groups[catId].push(ing)
        })
        return groups
    }, [ingredients])

    // Categories are shared with the general Expense tracker, so the full
    // list includes ones that will never apply to stock (e.g. Electricity,
    // Rent). Categories created here are flagged is_stock_category so they
    // stay visible even before their first ingredient/supplier is attached
    // (fixes a chicken-and-egg bug where a freshly-created category vanished
    // again on next page load, since it had zero items yet).
    const stockRelevantCategories = useMemo(() => {
        return categories.filter(c => c.is_stock_category || c.id === form.category_id)
    }, [categories, form.category_id])

    const stockCategoryOptions = useMemo(
        () => orderCategoriesForDisplay(stockRelevantCategories),
        [stockRelevantCategories],
    )

    // Fallback for the restock picker below when the item itself has no
    // category yet — "Others" is the same catch-all bucket the Supplier
    // field already defaults to for an unspecified vendor, so a brand-new
    // item never starts the Category select on an empty placeholder.
    const othersStockCategoryId = useMemo(
        () => categories.find(c => c.is_stock_category && c.name.trim().toLowerCase() === 'others')?.id || '',
        [categories],
    )

    // Main (top-level) stock categories only — offered as the parent when
    // creating a new one inline, so a manager can nest it (e.g. a new
    // "Grains" subcategory under "Grocery") instead of only adding flat ones.
    const stockMainCategories = useMemo(
        () => categories.filter(c => c.is_stock_category && !c.parent_id),
        [categories],
    )

    // Auto-identifies the main category once a subcategory is picked, e.g.
    // selecting "Vegetables" surfaces "Grocery" automatically.
    const selectedMainCategory = useMemo(
        () => findMainCategory(categories, form.category_id),
        [categories, form.category_id],
    )

    const emptyMoveForm = {
        movement_type: 'purchase', quantity: '', rate: '', paid_amount: '', notes: '', supplier_id: '', bill_number: '', category_id: ''
    }

    // Suppliers who serve this category — closes the gap where a stock
    // purchase used to just repeat the ingredient's free-text supplier field
    // instead of linking to the real Suppliers Ledger record. Falls back to
    // every supplier if none share the category yet. Tracks moveForm's
    // category (auto-filled from the picked item, but editable) rather than
    // the item's own stored category, so changing it here re-filters live.
    const relevantSuppliers = useMemo(() => {
        if (!moveForm.category_id) return suppliers
        const matching = suppliers.filter(s => s.category_id === moveForm.category_id)
        return matching.length > 0 ? matching : suppliers
    }, [suppliers, moveForm.category_id])

    const effectiveSupplierId = moveForm.supplier_id || (relevantSuppliers.length === 1 ? relevantSuppliers[0].id : '')

    const isPurchase = moveForm.movement_type === 'purchase'
    const moveQuantity = parseFloat(moveForm.quantity) || 0
    const moveRate = parseFloat(moveForm.rate) || 0
    const moveTotal = moveQuantity * moveRate
    const movePaidAmount = parseFloat(moveForm.paid_amount) || 0

    function openStockModal(ing: Ingredient) {
        setStockModal(ing)
        setMoveForm({ ...emptyMoveForm, rate: ing.cost_per_unit ? ing.cost_per_unit.toString() : '', category_id: ing.category_id || othersStockCategoryId })
        setMovePayment(EMPTY_SUPPLIER_PAYMENT)
    }

    function closeStockModal() {
        setStockModal(null)
        setMoveForm(emptyMoveForm)
        setMovePayment(EMPTY_SUPPLIER_PAYMENT)
        resetInlineSupplierForm()
    }

    function openPicker() {
        if (ingredients.length === 0) { toast.error('No stock items yet — create one first'); return }
        setPickerIngredientId(ingredients[0].id)
        setShowPicker(true)
    }

    function confirmPicker() {
        const ing = ingredients.find(i => i.id === pickerIngredientId)
        if (!ing) return
        setShowPicker(false)
        openStockModal(ing)
    }

    async function handleStockMove() {
        if (!stockModal || moveQuantity <= 0) { toast.error('Enter a valid quantity'); return }

        const willBill = isPurchase && moveRate > 0
        const categoryId = moveForm.category_id
        if (willBill) {
            if (!categoryId) {
                toast.error('Select a category to record this purchase')
                return
            }
            if (movePaidAmount > moveTotal) { toast.error('Paid amount cannot exceed the total amount'); return }
            const paymentError = validateSupplierPayment(movePayment, movePaidAmount)
            if (paymentError) { toast.error(paymentError); return }
            if (isUnderpaidSplit(movePayment, movePaidAmount, moveTotal)) {
                const ok = await confirm({ title: 'Underpaid split', message: underpaidSplitConfirmMessage(movePaidAmount, moveTotal), confirmText: 'Continue', isDestructive: false })
                if (!ok) return
            }
        }

        setSaving(true)
        const result = await addStockMovementAction({
            ingredient_id: stockModal.id,
            movement_type: moveForm.movement_type,
            quantity: moveQuantity,
            notes: moveForm.notes || undefined,
        })

        if (result.error) {
            setSaving(false)
            toast.error(result.error)
            return
        }

        // A purchase records a supplier bill — same pattern as the Suppliers
        // Ledger's own "Record Bill" — so paying less than the total leaves
        // the rest as a due balance on that supplier, and paying 0 records
        // it as full credit rather than skipping the financial record.
        if (willBill) {
            const selectedSupplier = suppliers.find(s => s.id === effectiveSupplierId)
            const supplierName = effectiveSupplierId === OTHERS_SUPPLIER_ID
                ? UNSPECIFIED_SUPPLIER_NAME
                : selectedSupplier?.name || stockModal.supplier || UNSPECIFIED_SUPPLIER_NAME

            const billRes = await createSupplierBillAction({
                supplier_name: supplierName,
                category_id: categoryId as string,
                text_desc: `Restock: ${stockModal.name}`,
                quantity: moveQuantity,
                rate: moveRate,
                unit: stockModal.unit,
                amount: moveTotal,
                paid_amount: movePaidAmount,
                payment_source: movePayment.payment_source,
                bank_name: movePayment.payment_source !== 'cash' ? movePayment.bank_name.trim() : undefined,
                cash_portion: movePayment.payment_source === 'cash_qr' ? (parseFloat(movePayment.cash_portion) || 0) : undefined,
                qr_portion: movePayment.payment_source === 'cash_qr' ? (parseFloat(movePayment.qr_portion) || 0) : undefined,
                cheque_details: movePayment.payment_source === 'cheque' ? buildChequeDetailsFromSupplierPayment(movePayment) : undefined,
                bill_number: moveForm.bill_number.trim() || undefined,
            })

            // Keep cost_per_unit and category in sync with this purchase so the
            // next restock's rate is prefilled and the category picked here
            // (auto-filled from the item, or set for the first time if it had
            // none) is remembered on the item itself, not just this one bill.
            const updates: Record<string, unknown> = {}
            if (moveRate !== stockModal.cost_per_unit) updates.cost_per_unit = moveRate
            if (categoryId !== stockModal.category_id) updates.category_id = categoryId
            if (!billRes.error && Object.keys(updates).length > 0) {
                await updateIngredientAction(stockModal.id, updates)
            }

            setSaving(false)
            if (billRes.error) {
                toast.error(`Stock updated, but the supplier bill wasn't recorded: ${billRes.error}`)
                mutate()
                mutateMovements()
                closeStockModal()
                return
            }
            if (billRes.pendingApproval) {
                toast.success('Stock updated. Cheque payment held pending manager approval.', { duration: 6000 })
            } else {
                toast.success('Stock and supplier bill updated!')
                if (billRes.warning) toast.error(billRes.warning)
            }
        } else {
            setSaving(false)
            toast.success('Stock updated!')
        }

        mutate()
        mutateMovements()
        closeStockModal()
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this stock item?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteIngredientAction(id)
        if (result.error) { toast.error(result.error); return }
        mutate()
        mutateMovements()
        toast.success('Deleted')
    }

    const lowStock = ingredients.filter(i => i.reorder_level !== null && i.stock_quantity <= (i.reorder_level ?? 0))

    return (
        <div className="space-y-4">
            {/* Low Stock Alert */}
            {lowStock.length > 0 && (
                <div className="bg-amber-50/50 border border-amber-200/50 rounded-card p-5 flex items-start gap-4 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                        <AlertTriangle size={20} />
                    </div>
                    <div>
                        <p className="text-sm font-extrabold text-amber-900">Low Stock Alert</p>
                        <p className="text-[11px] font-bold text-amber-700/80 uppercase tracking-wider mt-1">
                            {lowStock.map(i => i.name).join(', ')} {lowStock.length === 1 ? 'is' : 'are'} at or below reorder level.
                        </p>
                    </div>
                </div>
            )}

            {/* Stock / Inventory Activities toggle */}
            <div className="grid grid-cols-2 bg-surface border border-hairline rounded-[var(--r-md)] p-1.5 shadow-sm">
                <button
                    type="button"
                    onClick={() => setViewMode('stock')}
                    className={`flex items-center justify-center gap-2 py-3.5 text-sm font-black uppercase tracking-wider rounded-lg transition-all focus-ring ${viewMode === 'stock' ? 'bg-brand-500 text-white shadow-md' : 'text-ink-subtle hover:text-ink hover:bg-surface-muted/40'}`}
                >
                    <Boxes size={16} /> Stock
                </button>
                <button
                    type="button"
                    onClick={() => setViewMode('activities')}
                    className={`flex items-center justify-center gap-2 py-3.5 text-sm font-black uppercase tracking-wider rounded-lg transition-all focus-ring ${viewMode === 'activities' ? 'bg-indigo-600 text-white shadow-md' : 'text-ink-subtle hover:text-ink hover:bg-surface-muted/40'}`}
                >
                    <History size={16} /> Inventory Activities
                </button>
            </div>

            {/* Header Action Buttons */}
            {viewMode === 'stock' && (
                <div className="flex justify-end items-center gap-3 mb-6">
                    <button onClick={openPicker}
                        className="flex items-center gap-2 bg-surface text-ink border border-hairline px-6 py-3 rounded-[var(--r-md)] text-sm font-bold shadow-sm hover:bg-surface-muted transition-all focus-ring">
                        <Plus size={16} /> Add on Stock Item
                    </button>
                    <button onClick={() => { setEditingItem(null); setShowAdd(true); }}
                        className="flex items-center gap-2 bg-brand-500 text-white px-6 py-3 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                        <PackagePlus size={16} /> Create New Stock Item
                    </button>
                </div>
            )}

            {/* Add/Edit Stock Modal Popup */}
            {showAdd && (
                <Modal
                    open
                    onClose={() => {
                        setShowAdd(false)
                        setEditingItem(null)
                        resetCreateForm()
                    }}
                    size="md"
                    ariaLabel={editingItem ? 'Edit Stock Item' : 'Create New Stock Item'}
                    className="text-left"
                >
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/30 flex justify-between items-center">
                            <h3 className="text-h3 font-extrabold text-ink">{editingItem ? 'Edit Stock Item' : 'Create New Stock Item'}</h3>
                            <button onClick={() => {
                                setShowAdd(false)
                                setEditingItem(null)
                                resetCreateForm()
                            }} className="w-8 h-8 rounded-full bg-surface border border-hairline flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors shadow-sm focus-ring">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Item Name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                    placeholder="e.g. Cheese"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Unit *</label>
                                    <Select
                                        value={form.unit}
                                        onChange={e => setForm({ ...form, unit: e.target.value })}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'bottle', 'packet', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </Select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">
                                        {editingItem ? 'Stock Quantity' : 'Stock Quantity *'}
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={form.stock_quantity}
                                        disabled={!!editingItem}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, stock_quantity: v })
                                        }}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 disabled:opacity-50 disabled:bg-surface-muted/30"
                                        placeholder="e.g. 50"
                                    />
                                    {editingItem && (
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">Use stock movement to change.</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Cost per Unit *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={form.cost_per_unit}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, cost_per_unit: v })
                                        }}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                        placeholder="e.g. 2.50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Reorder Level</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={form.reorder_level}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, reorder_level: v })
                                        }}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                        placeholder="e.g. 10"
                                    />
                                </div>
                            </div>
                            {/* Supplier Dropdown and Inline Addition — picking a supplier below
                                auto-fills the Category with that supplier's own category, so a
                                manager doesn't have to re-pick the category on every purchase;
                                the Category select right after it stays fully editable to override. */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Supplier</label>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddSupplier(!showAddSupplier)}
                                        className="text-[11px] font-black text-indigo-600 hover:text-indigo-700 transition-colors focus:outline-none"
                                    >
                                        {showAddSupplier ? '✕ Cancel' : '+ Add Supplier'}
                                    </button>
                                </div>

                                {showAddSupplier ? (
                                    <div className="bg-surface-muted/30 border border-hairline rounded-[var(--r-md)] p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
                                        <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">New Supplier Details</p>
                                        <input
                                            type="text"
                                            placeholder="Supplier Name (e.g. Organic Farm Co)"
                                            value={newSupplierName}
                                            onChange={e => setNewSupplierName(e.target.value)}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Phone Number"
                                            value={newSupplierPhone}
                                            onChange={e => setNewSupplierPhone(e.target.value)}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Address (Optional)"
                                            value={newSupplierAddress}
                                            onChange={e => setNewSupplierAddress(e.target.value)}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                        />
                                        {form.category_id && (
                                            <p className="text-[10px] text-ink-muted italic font-bold">
                                                * This supplier will automatically be linked to Category: {categories.find(c => c.id === form.category_id)?.name}
                                            </p>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handleInlineAddSupplier}
                                            disabled={!newSupplierName.trim() || addingSupplier}
                                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-[var(--r-md)] text-[10px] uppercase tracking-wider shadow-sm transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            {addingSupplier ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                            Create Supplier
                                        </button>
                                    </div>
                                ) : (
                                    <Select
                                        value={form.supplier}
                                        onChange={e => {
                                            const supplierName = e.target.value
                                            const matched = suppliers.find(s => s.name === supplierName)
                                            setForm(f => ({
                                                ...f,
                                                supplier: supplierName,
                                                // Only a fallback suggestion for a brand-new/uncategorized
                                                // item — an item's own established category (already in
                                                // the field when editing, or already chosen by hand) always
                                                // wins, since the same item can be bought from suppliers in
                                                // different categories without the item itself changing what
                                                // it is. The Category select below stays editable either way.
                                                category_id: (!f.category_id && matched?.category_id) ? matched.category_id : f.category_id,
                                            }))
                                        }}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        <option value="">No Supplier</option>
                                        {filteredSuppliers.map(s => (
                                            <option key={s.id} value={s.name}>{s.name}</option>
                                        ))}
                                        <option value={UNSPECIFIED_SUPPLIER_NAME}>Others (unauthorized / unregistered)</option>
                                    </Select>
                                )}
                            </div>

                            {/* Category Dropdown and Inline Addition */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Category</label>
                                    <button
                                        type="button"
                                        onClick={() => setShowAddCategory(!showAddCategory)}
                                        className="text-[11px] font-black text-brand-500 hover:text-brand-600 transition-colors focus:outline-none"
                                    >
                                        {showAddCategory ? '✕ Cancel' : '+ Add Category'}
                                    </button>
                                </div>

                                {showAddCategory ? (
                                    <div className="bg-surface-muted/30 border border-hairline rounded-[var(--r-md)] p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
                                        <p className="text-[10px] font-black text-brand-500 uppercase tracking-wider">New Category Details</p>
                                        <input
                                            type="text"
                                            placeholder="Category Name (e.g. Grains, Alcoholic Beverages)"
                                            value={newCategoryName}
                                            onChange={e => setNewCategoryName(e.target.value)}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Description (Optional)"
                                            value={newCategoryDesc}
                                            onChange={e => setNewCategoryDesc(e.target.value)}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                        />
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">Parent Category (Optional)</label>
                                            <Select
                                                value={newCategoryParentId}
                                                onChange={e => setNewCategoryParentId(e.target.value)}
                                                searchable
                                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                            >
                                                <option value="">None — top-level (e.g. Grocery)</option>
                                                {stockMainCategories.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </Select>
                                            <p className="text-[10px] font-bold text-ink-muted mt-1">Pick a main category to nest this as a subcategory, e.g. "Vegetables" under "Grocery".</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleInlineAddCategory}
                                            disabled={!newCategoryName.trim() || addingCategory}
                                            className="w-full py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold rounded-[var(--r-md)] text-[10px] uppercase tracking-wider shadow-sm transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            {addingCategory ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                            Create Category
                                        </button>
                                    </div>
                                ) : (
                                    <Select
                                        value={form.category_id}
                                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                                        searchable
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        <option value="">Uncategorized</option>
                                        {stockCategoryOptions.map(({ category, label }) => (
                                            <option key={category.id} value={category.id}>{label}</option>
                                        ))}
                                    </Select>
                                )}
                                {selectedMainCategory && (
                                    <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                                        Main Category: <span className="text-ink-subtle">{selectedMainCategory.name}</span>
                                    </p>
                                )}
                                {categories.length > stockRelevantCategories.length && (
                                    <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                                        Only showing categories already used for stock or suppliers — general expense categories like Electricity or Rent are hidden here.
                                    </p>
                                )}
                            </div>

                            {/* Total amount + payment — only meaningful for a brand-new item
                                actually being bought right now. A supplier is optional: leave
                                it as "No Supplier" to just log the purchase for your own records. */}
                            {!editingItem && (parseFloat(form.stock_quantity) || 0) > 0 && (parseFloat(form.cost_per_unit) || 0) > 0 && (
                                <div className="space-y-4 p-4 bg-surface-muted/30 border border-hairline rounded-[var(--r-md)] animate-in slide-in-from-top-1 duration-150">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-bold text-ink-subtle uppercase tracking-wider">Total Amount</span>
                                        <span className="font-extrabold text-sm text-ink">
                                            {formatCurrency((parseFloat(form.stock_quantity) || 0) * (parseFloat(form.cost_per_unit) || 0))}
                                        </span>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Supplier&apos;s Bill Number (optional)</label>
                                        <input
                                            type="text"
                                            value={createBillNumber}
                                            onChange={e => setCreateBillNumber(e.target.value)}
                                            placeholder="e.g. their invoice/bill reference"
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Paid Amount (Rs.)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            value={createPaidAmount}
                                            onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setCreatePaidAmount(v) }}
                                            placeholder="0.00 (Enter 0 if unpaid / full credit)"
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                        />
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">
                                            Owed to {form.supplier || UNSPECIFIED_SUPPLIER_NAME}: {formatCurrency(Math.max(0, (parseFloat(form.stock_quantity) || 0) * (parseFloat(form.cost_per_unit) || 0) - (parseFloat(createPaidAmount) || 0)))}
                                        </p>
                                    </div>
                                    <SupplierPaymentFields
                                        value={createPayment}
                                        onChange={setCreatePayment}
                                        bankAccounts={bankAccounts}
                                        paidAmount={parseFloat(createPaidAmount) || 0}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAdd(false)
                                    setEditingItem(null)
                                    resetCreateForm()
                                }}
                                className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!form.name.trim() || saving}
                                onClick={handleCreateOrUpdate}
                                className="px-6 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {editingItem ? 'Save Changes' : 'Create Stock'}
                            </button>
                        </div>
                </Modal>
            )}

            {/* Add on Stock Item — pick an existing item to restock */}
            {showPicker && (
                <Modal open onClose={() => setShowPicker(false)} size="sm" ariaLabel="Add on Stock Item" className="p-6 space-y-6">
                        <h3 className="text-h3 font-extrabold text-ink">Add on Stock Item</h3>
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Stock Item *</label>
                            <Select
                                value={pickerIngredientId}
                                onChange={e => setPickerIngredientId(e.target.value)}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                            >
                                {ingredients.map(ing => (
                                    <option key={ing.id} value={ing.id}>{ing.name} ({ing.stock_quantity} {ing.unit})</option>
                                ))}
                            </Select>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowPicker(false)} className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring">Cancel</button>
                            <button onClick={confirmPicker} className="px-6 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 focus-ring">
                                Continue
                            </button>
                        </div>
                </Modal>
            )}

            {/* Stock Movement Modal */}
            {stockModal && (
                <Modal open onClose={closeStockModal} size="md" ariaLabel={`Stock movement — ${stockModal.name}`} className="p-6 space-y-6">
                        <div>
                            <h3 className="text-h3 font-extrabold text-ink">Stock Movement — {stockModal.name}</h3>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1">Current Stock: <span className="text-brand-500">{stockModal.stock_quantity} {stockModal.unit}</span></p>
                        </div>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Type</label>
                                <Select value={moveForm.movement_type} onChange={e => setMoveForm({ ...moveForm, movement_type: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]">
                                    <option value="purchase">Purchase (add)</option>
                                    <option value="adjustment">Adjustment (add)</option>
                                    <option value="usage">Usage (subtract)</option>
                                    <option value="waste">Waste (subtract)</option>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Quantity ({stockModal.unit})</label>
                                <input type="text" inputMode="decimal" value={moveForm.quantity}
                                    onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setMoveForm({ ...moveForm, quantity: v }) }}
                                    placeholder="e.g. 5"
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                            </div>

                            {isPurchase && (
                                <div className="space-y-4 p-4 bg-surface-muted/30 border border-hairline rounded-[var(--r-md)]">
                                    <div className="space-y-2">
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Category</label>
                                        <Select value={moveForm.category_id} onChange={e => setMoveForm({ ...moveForm, category_id: e.target.value, supplier_id: '' })}
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3">
                                            <option value="">Select category...</option>
                                            {stockCategoryOptions.map(({ category, label }) => (
                                                <option key={category.id} value={category.id}>{label}</option>
                                            ))}
                                        </Select>
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">Auto-filled from this item&apos;s own category — change it any time.</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Supplier</label>
                                            <button
                                                type="button"
                                                onClick={() => setShowAddSupplier(!showAddSupplier)}
                                                className="text-[11px] font-black text-indigo-600 hover:text-indigo-700 transition-colors focus:outline-none"
                                            >
                                                {showAddSupplier ? '✕ Cancel' : '+ Add Supplier'}
                                            </button>
                                        </div>
                                        {showAddSupplier ? (
                                            <div className="bg-surface-muted/30 border border-hairline rounded-[var(--r-md)] p-4 space-y-3 animate-in slide-in-from-top-1 duration-150">
                                                <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wider">New Supplier Details</p>
                                                <input
                                                    type="text"
                                                    placeholder="Supplier Name (e.g. Organic Farm Co)"
                                                    value={newSupplierName}
                                                    onChange={e => setNewSupplierName(e.target.value)}
                                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Phone Number"
                                                    value={newSupplierPhone}
                                                    onChange={e => setNewSupplierPhone(e.target.value)}
                                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Address (Optional)"
                                                    value={newSupplierAddress}
                                                    onChange={e => setNewSupplierAddress(e.target.value)}
                                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 p-2.5"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleInlineAddSupplier}
                                                    disabled={!newSupplierName.trim() || addingSupplier}
                                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold rounded-[var(--r-md)] text-[10px] uppercase tracking-wider shadow-sm transition-colors flex items-center justify-center gap-1.5"
                                                >
                                                    {addingSupplier ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                    Create Supplier
                                                </button>
                                            </div>
                                        ) : (
                                            <Select value={effectiveSupplierId} onChange={e => setMoveForm({ ...moveForm, supplier_id: e.target.value })}
                                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3">
                                                <option value="">Select supplier...</option>
                                                {relevantSuppliers.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                                <option value={OTHERS_SUPPLIER_ID}>Others (unauthorized / unregistered)</option>
                                            </Select>
                                        )}
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">Matched by this item&apos;s category, so the bill lands under the right supplier in Suppliers Ledger — pick a different one each restock if you buy from more than one, or "Others" for an unauthorized/unregistered vendor.</p>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Rate (Rs. / {stockModal.unit})</label>
                                        <input type="text" inputMode="decimal" value={moveForm.rate}
                                            onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setMoveForm({ ...moveForm, rate: v }) }}
                                            placeholder="e.g. 2.50"
                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                    </div>

                                    {moveRate > 0 && (
                                        <>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="font-bold text-ink-subtle uppercase tracking-wider">Total Amount</span>
                                                <span className="font-extrabold text-sm text-ink">{formatCurrency(moveTotal)}</span>
                                            </div>

                                            <div>
                                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Supplier&apos;s Bill Number (optional)</label>
                                                <input type="text" value={moveForm.bill_number}
                                                    onChange={e => setMoveForm({ ...moveForm, bill_number: e.target.value })}
                                                    placeholder="e.g. their invoice/bill reference"
                                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                            </div>

                                            <div>
                                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Paid Amount (Rs.)</label>
                                                <input type="text" inputMode="decimal" value={moveForm.paid_amount}
                                                    onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setMoveForm({ ...moveForm, paid_amount: v }) }}
                                                    placeholder="0.00 (Enter 0 if unpaid / full credit)"
                                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                                <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">
                                                    Owed: {formatCurrency(Math.max(0, moveTotal - movePaidAmount))}
                                                </p>
                                            </div>

                                            <SupplierPaymentFields
                                                value={movePayment}
                                                onChange={setMovePayment}
                                                bankAccounts={bankAccounts}
                                                paidAmount={movePaidAmount}
                                            />
                                        </>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Notes</label>
                                <input type="text" value={moveForm.notes} onChange={e => setMoveForm({ ...moveForm, notes: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                    placeholder="e.g. Restock from supplier" />
                            </div>
                        </div>
                        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
                            <button onClick={closeStockModal} className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring">Cancel</button>
                            <button onClick={handleStockMove} disabled={saving}
                                className="bg-brand-500 text-white px-6 py-2.5 rounded-[var(--r-md)] text-sm font-bold disabled:opacity-50 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring flex items-center gap-2">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {saving ? 'Saving...' : 'Submit'}
                            </button>
                        </div>
                </Modal>
            )}

            {/* Stock Table */}
            {viewMode === 'stock' && (
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                {/* Horizontal scroll: the card around this clips with
                    overflow-hidden, so on a narrow screen the right-hand
                    columns were cut off with no way to reach them. */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/30 border-b border-hairline">
                            <tr>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Name</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Stock</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden md:table-cell">Reorder</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden md:table-cell">Cost/Unit</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden lg:table-cell">Supplier</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                        {categories.map(cat => {
                            const items = categorizedIngredients[cat.id] || []
                            if (items.length === 0) return null // Hide empty category!
                            const style = categoryStyle(cat.id)
                            const Icon = categoryIcon(cat.name)

                            return (
                                <Fragment key={cat.id}>
                                    <tr>
                                        <td colSpan={6} className={`px-5 py-2.5 border-y ${style.border} ${style.row}`}>
                                            <div className="flex items-center gap-2.5">
                                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${style.chip} shrink-0`}>
                                                    <Icon size={13} strokeWidth={2.5} />
                                                </span>
                                                <span className={`text-xs font-black uppercase tracking-wider ${style.text}`}>{cat.name}</span>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${style.border} ${style.chip}`}>
                                                    {items.length} {items.length === 1 ? 'item' : 'items'}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                    {items.map(ing => {
                                        const isLow = ing.reorder_level !== null && ing.stock_quantity <= (ing.reorder_level ?? 0)
                                        return (
                                            <tr key={ing.id} className={`hover:bg-surface-muted/30 transition-colors ${isLow ? 'bg-amber-50/30 hover:bg-amber-50/50' : ''}`}>
                                                <td className="px-5 py-4 font-extrabold text-ink flex items-center gap-2">
                                                    {isLow && <AlertTriangle size={16} className="text-amber-600" />}
                                                    {ing.name}
                                                </td>
                                                <td className={`px-5 py-4 text-right font-bold tabular-nums ${isLow ? 'text-amber-700' : 'text-brand-500'}`}>
                                                    {ing.stock_quantity} <span className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">{ing.unit}</span>
                                                </td>
                                                <td className="px-5 py-4 text-right text-ink-muted font-bold tabular-nums hidden md:table-cell">
                                                    {ing.reorder_level ?? '—'} <span className="text-[11px] font-bold uppercase tracking-wider">{ing.unit}</span>
                                                </td>
                                                <td className="px-5 py-4 text-right text-ink-subtle font-bold tabular-nums hidden md:table-cell">{formatCurrency(ing.cost_per_unit)}</td>
                                                <td className="px-5 py-4 text-ink-subtle font-medium hidden lg:table-cell">{ing.supplier || '—'}</td>
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-2 justify-end">
                                                        <button onClick={() => openEditModal(ing)}
                                                            className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all focus-ring shadow-sm bg-surface" title="Edit">
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button onClick={() => openStockModal(ing)}
                                                            className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-indigo-500 hover:bg-indigo-50 hover:border-indigo-200 transition-all focus-ring shadow-sm bg-surface" title="Stock Movement">
                                                            <Package size={14} />
                                                        </button>
                                                        <button onClick={() => handleDelete(ing.id)} className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-danger-fg hover:bg-danger-bg hover:border-danger-fg/30 transition-all focus-ring shadow-sm bg-surface" title="Delete">
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </Fragment>
                            )
                        })}

                        {/* Uncategorized items at the bottom */}
                        {categorizedIngredients[''] && categorizedIngredients[''].length > 0 && (
                            <Fragment>
                                <tr>
                                    <td colSpan={6} className="px-5 py-2.5 border-y border-hairline bg-surface-muted/40">
                                        <div className="flex items-center gap-2.5">
                                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-muted text-ink-subtle border border-hairline shrink-0">
                                                <Package size={13} strokeWidth={2.5} />
                                            </span>
                                            <span className="text-xs font-black uppercase tracking-wider text-ink-subtle">Uncategorized</span>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-hairline bg-surface-muted text-ink-subtle">
                                                {categorizedIngredients[''].length} {categorizedIngredients[''].length === 1 ? 'item' : 'items'}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                                {categorizedIngredients[''].map(ing => {
                                    const isLow = ing.reorder_level !== null && ing.stock_quantity <= (ing.reorder_level ?? 0)
                                    return (
                                        <tr key={ing.id} className={`hover:bg-surface-muted/30 transition-colors ${isLow ? 'bg-amber-50/30 hover:bg-amber-50/50' : ''}`}>
                                            <td className="px-5 py-4 font-extrabold text-ink flex items-center gap-2">
                                                {isLow && <AlertTriangle size={16} className="text-amber-600" />}
                                                {ing.name}
                                            </td>
                                            <td className={`px-5 py-4 text-right font-bold tabular-nums ${isLow ? 'text-amber-700' : 'text-brand-500'}`}>
                                                {ing.stock_quantity} <span className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">{ing.unit}</span>
                                            </td>
                                            <td className="px-5 py-4 text-right text-ink-muted font-bold tabular-nums hidden md:table-cell">
                                                {ing.reorder_level ?? '—'} <span className="text-[11px] font-bold uppercase tracking-wider">{ing.unit}</span>
                                            </td>
                                            <td className="px-5 py-4 text-right text-ink-subtle font-bold tabular-nums hidden md:table-cell">{formatCurrency(ing.cost_per_unit)}</td>
                                            <td className="px-5 py-4 text-ink-subtle font-medium hidden lg:table-cell">{ing.supplier || '—'}</td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-2 justify-end">
                                                    <button onClick={() => openEditModal(ing)}
                                                        className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all focus-ring shadow-sm bg-surface" title="Edit">
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button onClick={() => openStockModal(ing)}
                                                        className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-indigo-500 hover:bg-indigo-50 hover:border-indigo-200 transition-all focus-ring shadow-sm bg-surface" title="Stock Movement">
                                                        <Package size={14} />
                                                    </button>
                                                    <button onClick={() => handleDelete(ing.id)} className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-danger-fg hover:bg-danger-bg hover:border-danger-fg/30 transition-all focus-ring shadow-sm bg-surface" title="Delete">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </Fragment>
                        )}

                        {ingredients.length === 0 && (
                            <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-muted font-bold text-sm">No stock items tracked yet.</td></tr>
                        )}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* Inventory Activities — who moved stock, when, and on what item.
                Every purchase, restock, waste/usage entry and adjustment lands
                here the moment it's recorded, newest first. */}
            {viewMode === 'activities' && (
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                {/* Horizontal scroll: the card around this clips with
                    overflow-hidden, so on a narrow screen the right-hand
                    columns were cut off with no way to reach them. */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/30 border-b border-hairline">
                            <tr>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Date &amp; Time</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Item</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Type</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Quantity</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Entered By</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {movements.map(m => {
                                const ing = Array.isArray(m.ingredients) ? m.ingredients[0] : m.ingredients
                                const performer = Array.isArray(m.users) ? m.users[0] : m.users
                                // Mirrors addStockMovementAction's own delta rule
                                // (ingredients/actions.ts) — 'purchase' and 'adjustment'
                                // add to stock; 'usage' and 'waste' subtract from stock.
                                const isAddition = m.movement_type === 'purchase' || m.movement_type === 'adjustment'
                                return (
                                    <tr key={m.id} className="hover:bg-surface-muted/30 transition-colors">
                                        <td className="px-5 py-4 text-ink-subtle font-semibold whitespace-nowrap">
                                            <DateCell value={m.created_at} />
                                        </td>
                                        <td className="px-5 py-4 font-extrabold text-ink">{ing?.name || 'Deleted item'}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${isAddition ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                                {MOVEMENT_TYPE_LABEL[m.movement_type] || m.movement_type}
                                            </span>
                                        </td>
                                        <td className={`px-5 py-4 text-right font-bold tabular-nums ${isAddition ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {isAddition ? '+' : '-'}{m.quantity} <span className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{ing?.unit || ''}</span>
                                        </td>
                                        <td className="px-5 py-4 text-ink-subtle font-semibold">{performer?.full_name || 'Unknown'}</td>
                                        <td className="px-5 py-4 text-ink-subtle max-w-xs break-words whitespace-normal">{m.notes || <span className="italic">—</span>}</td>
                                    </tr>
                                )
                            })}
                            {movements.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-muted font-bold text-sm">No inventory activity recorded yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            )}
        </div>
    )
}
