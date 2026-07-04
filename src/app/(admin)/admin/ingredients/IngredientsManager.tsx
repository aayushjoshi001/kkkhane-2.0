'use client'

import { useState } from 'react'
import { createIngredientAction, addStockMovementAction, deleteIngredientAction, updateIngredientAction } from './actions'
import { Plus, Trash2, Edit2, AlertTriangle, Package, X, Check, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Ingredient } from '@/types/database'

export default function IngredientsManager({ initialIngredients, restaurantId }: {
    initialIngredients: Ingredient[]
    restaurantId: string
}) {
    const [ingredients, setIngredients] = useState(initialIngredients)
    const [showAdd, setShowAdd] = useState(false)
    const [editingItem, setEditingItem] = useState<Ingredient | null>(null)
    const [stockModal, setStockModal] = useState<Ingredient | null>(null)
    const [form, setForm] = useState({
        name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '',
    })
    const [moveForm, setMoveForm] = useState({ movement_type: 'purchase', quantity: '', notes: '' })
    const [saving, setSaving] = useState(false)

    function openEditModal(item: Ingredient) {
        setEditingItem(item)
        setForm({
            name: item.name,
            unit: item.unit,
            stock_quantity: item.stock_quantity.toString(),
            reorder_level: (item.reorder_level ?? 10).toString(),
            cost_per_unit: item.cost_per_unit.toString(),
            supplier: item.supplier || '',
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
        }

        if (editingItem) {
            // Stock quantity is owned by the movement ledger — editing it here
            // would bypass ingredient_movements and desync the audit trail. Drop it
            // from the update; quantity changes go through the Stock Movement action.
            const { stock_quantity: _sq, ...editable } = payload
            const result = await updateIngredientAction(editingItem.id, editable)
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            setIngredients(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...editable } : i).sort((a, b) => a.name.localeCompare(b.name)))
            toast.success('Stock item updated!')
        } else {
            const result = await createIngredientAction({
                restaurant_id: restaurantId,
                ...payload
            })
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            if (result.data) setIngredients(prev => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)))
            toast.success('Stock item added!')
        }
        setShowAdd(false)
        setEditingItem(null)
        setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '' })
    }

    async function handleStockMove() {
        if (!stockModal || !parseFloat(moveForm.quantity)) { toast.error('Enter a valid quantity'); return }
        setSaving(true)
        const result = await addStockMovementAction({
            ingredient_id: stockModal.id,
            movement_type: moveForm.movement_type,
            quantity: parseFloat(moveForm.quantity) || 0,
            notes: moveForm.notes || undefined,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        // Update local state
        const delta = moveForm.movement_type === 'purchase' ? (parseFloat(moveForm.quantity) || 0) : -(parseFloat(moveForm.quantity) || 0)
        setIngredients(prev => prev.map(i =>
            i.id === stockModal.id ? { ...i, stock_quantity: Math.max(0, i.stock_quantity + delta) } : i
        ))
        toast.success('Stock updated!')
        setStockModal(null)
        setMoveForm({ movement_type: 'purchase', quantity: '', notes: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this stock item?')) return
        const result = await deleteIngredientAction(id)
        if (result.error) { toast.error(result.error); return }
        setIngredients(prev => prev.filter(i => i.id !== id))
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
                                setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '' })
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
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Supplier</label>
                                <input
                                    type="text"
                                    value={form.supplier}
                                    onChange={e => setForm({ ...form, supplier: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3"
                                    placeholder="e.g. Wholesale Inc."
                                />
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAdd(false)
                                    setEditingItem(null)
                                    setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '' })
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
                    <div className="bg-surface rounded-card w-full max-w-md p-6 space-y-6 shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-hairline animate-in zoom-in-95 duration-200">
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
                        {ingredients.map(ing => {
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
                                            <button onClick={() => { setStockModal(ing); setMoveForm({ movement_type: 'purchase', quantity: '', notes: '' }) }}
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
                        {ingredients.length === 0 && (
                            <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-muted font-bold text-sm">No stock items tracked yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
