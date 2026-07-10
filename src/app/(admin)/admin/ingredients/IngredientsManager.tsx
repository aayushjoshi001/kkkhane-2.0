'use client'

import { useState, useMemo, Fragment } from 'react'
import { createIngredientAction, addStockMovementAction, deleteIngredientAction, updateIngredientAction, createIngredientCategoryAction, createIngredientSupplierAction } from './actions'
import { createVoucherAction } from '../vouchers/actions'
import { Plus, Trash2, Edit2, AlertTriangle, Package, X, Check, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import type { Ingredient, ExpenseCategory, Supplier, BankAccount } from '@/types/database'
import { fetchIngredientsData } from '@/lib/swr-fetchers'

export default function IngredientsManager({
    initialIngredients,
    restaurantId,
    initialCategories = [],
    initialSuppliers = [],
    initialBankAccounts = []
}: {
    initialIngredients: Ingredient[]
    restaurantId: string
    initialCategories: ExpenseCategory[]
    initialSuppliers: Supplier[]
    initialBankAccounts?: BankAccount[]
}) {
    const { data: ingredients = initialIngredients, mutate } = useSWR(
        ['ingredients', restaurantId],
        () => fetchIngredientsData(restaurantId),
        { fallbackData: initialIngredients }
    )

    // Categories and Suppliers local states (for inline addition)
    const [categories, setCategories] = useState<ExpenseCategory[]>(initialCategories)
    const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
    const [bankAccounts] = useState<BankAccount[]>(initialBankAccounts)

    const [showAdd, setShowAdd] = useState(false)
    const [editingItem, setEditingItem] = useState<Ingredient | null>(null)
    const [stockModal, setStockModal] = useState<Ingredient | null>(null)
    const [form, setForm] = useState({
        name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '',
    })
    const [moveForm, setMoveForm] = useState({
        movement_type: 'purchase', quantity: '', notes: '',
        amount_paid: '', payment_method: 'cash' as 'cash' | 'qr' | 'cheque',
        bank_account_id: '', cheque_date: '', cheque_number: '', supplier_id: ''
    })
    const [saving, setSaving] = useState(false)

    // Inline Category form state
    const [showAddCategory, setShowAddCategory] = useState(false)
    const [newCategoryName, setNewCategoryName] = useState('')
    const [newCategoryDesc, setNewCategoryDesc] = useState('')
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

    async function handleCreateOrUpdate() {
        if (!form.name.trim()) { toast.error('Name required'); return }
        setSaving(true)
        
        const payload = {
            name: form.name,
            unit: form.unit,
            stock_quantity: parseFloat(form.stock_quantity) || 0,
            reorder_level: parseFloat(form.reorder_level) || 0,
            cost_per_unit: parseFloat(form.cost_per_unit) || 0,
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
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            if (result.data) mutate()
            toast.success('Stock item added!')
        }
        setShowAdd(false)
        setEditingItem(null)
        setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '' })
    }

    async function handleInlineAddCategory(e: React.FormEvent) {
        e.preventDefault()
        const name = newCategoryName.trim()
        if (!name) return
        setAddingCategory(true)
        const result = await createIngredientCategoryAction({
            restaurant_id: restaurantId,
            name,
            description: newCategoryDesc || undefined
        })
        setAddingCategory(false)
        if (result.error) {
            toast.error(result.error)
            return
        }
        if (result.data) {
            setCategories(prev => [...prev, result.data as ExpenseCategory])
            setForm(f => ({ ...f, category_id: result.data.id }))
            setNewCategoryName('')
            setNewCategoryDesc('')
            setShowAddCategory(false)
            toast.success('Category created inline!')
        }
    }

    async function handleInlineAddSupplier(e: React.FormEvent) {
        e.preventDefault()
        const name = newSupplierName.trim()
        if (!name) return
        setAddingSupplier(true)
        const result = await createIngredientSupplierAction({
            restaurant_id: restaurantId,
            name,
            phone: newSupplierPhone || undefined,
            address: newSupplierAddress || undefined,
            category_id: form.category_id || null
        })
        setAddingSupplier(false)
        if (result.error) {
            toast.error(result.error)
            return
        }
        if (result.data) {
            setSuppliers(prev => [...prev, result.data as Supplier])
            setForm(f => ({ ...f, supplier: result.data.name }))
            setNewSupplierName('')
            setNewSupplierPhone('')
            setNewSupplierAddress('')
            setShowAddSupplier(false)
            toast.success('Supplier created inline!')
        }
    }

    // Filter suppliers: only show those matching the selected category, or general ones
    const filteredSuppliers = useMemo(() => {
        if (!form.category_id) {
            return suppliers
        }
        return suppliers.filter(s => !s.category_id || s.category_id === form.category_id)
    }, [suppliers, form.category_id])

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

    const emptyMoveForm = {
        movement_type: 'purchase', quantity: '', notes: '',
        amount_paid: '', payment_method: 'cash' as 'cash' | 'qr' | 'cheque',
        bank_account_id: '', cheque_date: '', cheque_number: '', supplier_id: ''
    }

    // Bank accounts relevant to the selected payment method — QR pays into a
    // wallet-type account, cheque deposits into a bank-type account. Falls
    // back to showing everything if the restaurant hasn't set up that type
    // yet, so the picker is never a dead end.
    const paymentBankAccounts = useMemo(() => {
        const wantType = moveForm.payment_method === 'qr' ? 'wallet' : 'bank'
        const matching = bankAccounts.filter(b => b.account_type === wantType)
        return matching.length > 0 ? matching : bankAccounts
    }, [bankAccounts, moveForm.payment_method])

    // Suppliers who serve this ingredient's category — closes the gap where
    // a stock purchase used to just repeat the ingredient's free-text
    // supplier field instead of linking to the real Suppliers Ledger record.
    // Falls back to every supplier if none share the category yet.
    const relevantSuppliers = useMemo(() => {
        if (!stockModal?.category_id) return suppliers
        const matching = suppliers.filter(s => s.category_id === stockModal.category_id)
        return matching.length > 0 ? matching : suppliers
    }, [suppliers, stockModal])

    const effectiveSupplierId = moveForm.supplier_id || (relevantSuppliers.length === 1 ? relevantSuppliers[0].id : '')

    const isPurchase = moveForm.movement_type === 'purchase'
    const amountPaid = parseFloat(moveForm.amount_paid) || 0

    async function handleStockMove() {
        if (!stockModal || !parseFloat(moveForm.quantity)) { toast.error('Enter a valid quantity'); return }

        if (isPurchase && amountPaid > 0) {
            if ((moveForm.payment_method === 'qr' || moveForm.payment_method === 'cheque') && !moveForm.bank_account_id) {
                toast.error('Select which bank account this payment affects')
                return
            }
            if (moveForm.payment_method === 'cheque' && !moveForm.cheque_date) {
                toast.error('Cheque date is required')
                return
            }
        }

        setSaving(true)
        const result = await addStockMovementAction({
            ingredient_id: stockModal.id,
            movement_type: moveForm.movement_type,
            quantity: parseFloat(moveForm.quantity) || 0,
            notes: moveForm.notes || undefined,
        })

        if (result.error) {
            setSaving(false)
            toast.error(result.error)
            return
        }

        // Record the payment as an expense, dated to today, and move it out
        // of cash/bank via the same voucher + day-book pipeline the rest of
        // the app uses — so it shows up in Cash Book / Bank Book / Bank
        // Ledger and (for cheques) waits for manager approval before it
        // actually reduces the selected bank account.
        if (isPurchase && amountPaid > 0) {
            const selectedBank = bankAccounts.find(b => b.id === moveForm.bank_account_id)
            const selectedSupplier = suppliers.find(s => s.id === effectiveSupplierId)
            const partyName = selectedSupplier?.name || stockModal.supplier || stockModal.name
            const voucherRes = await createVoucherAction({
                voucher_type: 'payment',
                category: 'stock',
                party_name: partyName,
                amount: amountPaid,
                payment_mode: moveForm.payment_method,
                bank_name: selectedBank?.name,
                particulars: `Stock Purchase: ${stockModal.name} (${moveForm.quantity} ${stockModal.unit})`,
                expense_category_id: stockModal.category_id || undefined,
                cheque_details: moveForm.payment_method === 'cheque' ? {
                    written_name: partyName,
                    bank_cheque: selectedBank?.name || '',
                    cheque_number: moveForm.cheque_number,
                    cheque_date: moveForm.cheque_date,
                    cheque_type: 'normal'
                } : undefined
            })
            setSaving(false)
            if (voucherRes.error) {
                toast.error(`Stock updated, but payment wasn't recorded: ${voucherRes.error}`)
                mutate()
                setStockModal(null)
                setMoveForm(emptyMoveForm)
                return
            }
            toast.success(
                moveForm.payment_method === 'cheque'
                    ? 'Stock updated — cheque payment recorded, pending manager approval'
                    : 'Stock and payment updated!'
            )
        } else {
            setSaving(false)
            toast.success('Stock updated!')
        }

        mutate()
        setStockModal(null)
        setMoveForm(emptyMoveForm)
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this stock item?')) return
        const result = await deleteIngredientAction(id)
        if (result.error) { toast.error(result.error); return }
        mutate()
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

            {/* Header Action Button */}
            <div className="flex justify-end items-center mb-6">
                <button onClick={() => { setEditingItem(null); setShowAdd(true); }}
                    className="flex items-center gap-2 bg-brand-500 text-white px-6 py-3 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                    <Plus size={16} /> Add Stock Item
                </button>
            </div>

            {/* Add/Edit Stock Modal Popup */}
            {showAdd && (
                <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface rounded-card shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-hairline w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 text-left">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/30 flex justify-between items-center">
                            <h3 className="text-h3 font-extrabold text-ink">{editingItem ? 'Edit Stock Item' : 'Create New Stock Item'}</h3>
                            <button onClick={() => {
                                setShowAdd(false)
                                setEditingItem(null)
                                setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '' })
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
                                    <select
                                        value={form.unit}
                                        onChange={e => setForm({ ...form, unit: e.target.value })}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
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
                                            placeholder="Category Name (e.g. Food, Beverages)"
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
                                    <select
                                        value={form.category_id}
                                        onChange={e => setForm({ ...form, category_id: e.target.value, supplier: '' })}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        <option value="">Uncategorized</option>
                                        {stockRelevantCategories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                )}
                                {categories.length > stockRelevantCategories.length && (
                                    <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">
                                        Only showing categories already used for stock or suppliers — general expense categories like Electricity or Rent are hidden here.
                                    </p>
                                )}
                            </div>

                            {/* Supplier Dropdown and Inline Addition */}
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
                                    <select
                                        value={form.supplier}
                                        onChange={e => setForm({ ...form, supplier: e.target.value })}
                                        className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]"
                                    >
                                        <option value="">No Supplier</option>
                                        {filteredSuppliers.map(s => (
                                            <option key={s.id} value={s.name}>{s.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAdd(false)
                                    setEditingItem(null)
                                    setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '', category_id: '' })
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
                    </div>
                </div>
            )}

            {/* Stock Movement Modal */}
            {stockModal && (
                <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-surface rounded-card w-full max-w-md p-6 space-y-6 shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-hairline animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                        <div>
                            <h3 className="text-h3 font-extrabold text-ink">Stock Movement — {stockModal.name}</h3>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1">Current Stock: <span className="text-brand-500">{stockModal.stock_quantity} {stockModal.unit}</span></p>
                        </div>
                        <div className="space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Type</label>
                                <select value={moveForm.movement_type} onChange={e => setMoveForm({ ...moveForm, movement_type: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]">
                                    <option value="purchase">Purchase (add)</option>
                                    <option value="usage">Usage (subtract)</option>
                                    <option value="waste">Waste (subtract)</option>
                                    <option value="adjustment">Adjustment (subtract)</option>
                                </select>
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
                                    <div>
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Supplier</label>
                                        {relevantSuppliers.length === 0 ? (
                                            <p className="text-[11px] font-bold text-ink-muted">No suppliers set up yet — payment will be recorded under &quot;{stockModal.supplier || stockModal.name}&quot;.</p>
                                        ) : (
                                            <select value={effectiveSupplierId} onChange={e => setMoveForm({ ...moveForm, supplier_id: e.target.value })}
                                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3">
                                                <option value="">Select supplier...</option>
                                                {relevantSuppliers.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        )}
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">Matched by this item&apos;s category, so the payment lands under the right supplier in Suppliers Ledger.</p>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Amount Paid</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-subtle">Rs.</span>
                                            <input type="text" inputMode="decimal" value={moveForm.amount_paid}
                                                onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setMoveForm({ ...moveForm, amount_paid: v }) }}
                                                placeholder="0 if not paid yet"
                                                className="w-full pl-9 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink tabular-nums placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                        </div>
                                        <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">Enter 0 if this stock hasn&apos;t been paid for yet — no payment will be recorded.</p>
                                    </div>

                                    {amountPaid > 0 && (
                                        <>
                                            <div>
                                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Payment Method</label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {(['cash', 'qr', 'cheque'] as const).map(m => (
                                                        <button key={m} type="button"
                                                            onClick={() => setMoveForm({ ...moveForm, payment_method: m, bank_account_id: '' })}
                                                            className={`py-2 rounded-[var(--r-md)] text-xs font-bold border transition ${moveForm.payment_method === m ? 'bg-brand-50 border-brand-500 text-brand-600' : 'bg-surface border-hairline text-ink hover:bg-surface-muted/40'}`}>
                                                            {m === 'cash' ? 'Cash' : m === 'qr' ? 'QR' : 'Cheque'}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mt-1.5">
                                                    {moveForm.payment_method === 'cash' && 'Reduces the cash drawer immediately.'}
                                                    {moveForm.payment_method === 'qr' && 'Reduces the selected wallet/bank account immediately.'}
                                                    {moveForm.payment_method === 'cheque' && 'Only reduces the selected bank account once a manager approves it.'}
                                                </p>
                                            </div>

                                            {(moveForm.payment_method === 'qr' || moveForm.payment_method === 'cheque') && (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">
                                                        {moveForm.payment_method === 'qr' ? 'QR / Wallet Account' : 'Bank Account'}
                                                    </label>
                                                    {paymentBankAccounts.length === 0 ? (
                                                        <p className="text-[11px] font-bold text-danger-fg">No bank accounts set up yet — add one in Bank Book first.</p>
                                                    ) : (
                                                        <select value={moveForm.bank_account_id} onChange={e => setMoveForm({ ...moveForm, bank_account_id: e.target.value })}
                                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5%22%20stroke%3D%22%236b7280%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_12px_center]">
                                                            <option value="">Select account...</option>
                                                            {paymentBankAccounts.map(b => (
                                                                <option key={b.id} value={b.id}>{b.name}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}

                                            {moveForm.payment_method === 'cheque' && (
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Cheque Date *</label>
                                                        <input type="date" value={moveForm.cheque_date} onChange={e => setMoveForm({ ...moveForm, cheque_date: e.target.value })}
                                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Cheque # <span className="text-ink-subtle font-normal normal-case">(optional)</span></label>
                                                        <input type="text" value={moveForm.cheque_number} onChange={e => setMoveForm({ ...moveForm, cheque_number: e.target.value })}
                                                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                                                    </div>
                                                </div>
                                            )}
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
                            <button onClick={() => setStockModal(null)} className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring">Cancel</button>
                            <button onClick={handleStockMove} disabled={saving}
                                className="bg-brand-500 text-white px-6 py-2.5 rounded-[var(--r-md)] text-sm font-bold disabled:opacity-50 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring flex items-center gap-2">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {saving ? 'Saving...' : 'Submit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stock Table */}
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
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
                        
                        return (
                            <Fragment key={cat.id}>
                                <tr className="bg-surface-muted/30">
                                    <td colSpan={6} className="px-5 py-2.5 text-xs font-black text-indigo-700 uppercase tracking-wider bg-surface-muted/20">
                                        📁 {cat.name} ({items.length} {items.length === 1 ? 'item' : 'items'})
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
                                            <td className="px-5 py-4 text-right text-ink-subtle font-bold tabular-nums hidden md:table-cell">${ing.cost_per_unit.toFixed(2)}</td>
                                            <td className="px-5 py-4 text-ink-subtle font-medium hidden lg:table-cell">{ing.supplier || '—'}</td>
                                            <td className="px-5 py-4">
                                                <div className="flex items-center gap-2 justify-end">
                                                    <button onClick={() => openEditModal(ing)}
                                                        className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all focus-ring shadow-sm bg-surface" title="Edit">
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button onClick={() => { setStockModal(ing); setMoveForm(emptyMoveForm) }}
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
                            <tr className="bg-surface-muted/30">
                                <td colSpan={6} className="px-5 py-2.5 text-xs font-black text-gray-500 uppercase tracking-wider bg-surface-muted/20">
                                    📦 Uncategorized Items ({categorizedIngredients[''].length} {categorizedIngredients[''].length === 1 ? 'item' : 'items'})
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
                                        <td className="px-5 py-4 text-right text-ink-subtle font-bold tabular-nums hidden md:table-cell">${ing.cost_per_unit.toFixed(2)}</td>
                                        <td className="px-5 py-4 text-ink-subtle font-medium hidden lg:table-cell">{ing.supplier || '—'}</td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2 justify-end">
                                                <button onClick={() => openEditModal(ing)}
                                                    className="w-8 h-8 rounded-full border border-hairline flex items-center justify-center text-ink-subtle hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all focus-ring shadow-sm bg-surface" title="Edit">
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={() => { setStockModal(ing); setMoveForm(emptyMoveForm) }}
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
    )
}
