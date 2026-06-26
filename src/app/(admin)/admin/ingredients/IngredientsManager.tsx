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
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={20} className="text-amber-600 mt-0.5" />
                    <div>
                        <p className="font-medium text-amber-900">Low Stock Alert</p>
                        <p className="text-sm text-amber-700 mt-1">
                            {lowStock.map(i => i.name).join(', ')} {lowStock.length === 1 ? 'is' : 'are'} at or below reorder level.
                        </p>
                    </div>
                </div>
            )}

            {/* Header Action Button */}
            <div className="flex justify-between items-center">
                <button onClick={() => { setEditingItem(null); setShowAdd(true); }}
                    className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors">
                    <Plus size={16} /> Add Stock Item
                </button>
            </div>

            {/* Add/Edit Stock Modal Popup */}
            {showAdd && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-left">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="font-semibold text-gray-900">{editingItem ? 'Edit Stock Item' : 'Create New Stock Item'}</h3>
                            <button onClick={() => {
                                setShowAdd(false)
                                setEditingItem(null)
                                setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '' })
                            }} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Cheese"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                                    <select
                                        value={form.unit}
                                        onChange={e => setForm({ ...form, unit: e.target.value })}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border bg-white"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                                        placeholder="e.g. 50"
                                    />
                                    {editingItem && (
                                        <p className="text-[11px] text-gray-400 mt-1">Use the stock movement action to change quantity.</p>
                                    )}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Unit ($) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={form.cost_per_unit}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, cost_per_unit: v })
                                        }}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                        placeholder="e.g. 2.50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={form.reorder_level}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, reorder_level: v })
                                        }}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                        placeholder="e.g. 10"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                                <input
                                    type="text"
                                    value={form.supplier}
                                    onChange={e => setForm({ ...form, supplier: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Wholesale Inc."
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAdd(false)
                                    setEditingItem(null)
                                    setForm({ name: '', unit: 'kg', stock_quantity: '', reorder_level: '10', cost_per_unit: '', supplier: '' })
                                }}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!form.name.trim() || saving}
                                onClick={handleCreateOrUpdate}
                                className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {editingItem ? 'Save Changes' : 'Create Stock'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stock Movement Modal */}
            {stockModal && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl">
                        <h3 className="font-semibold text-gray-900">Stock Movement — {stockModal.name}</h3>
                        <p className="text-sm text-gray-500">Current: {stockModal.stock_quantity} {stockModal.unit}</p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
                                <select value={moveForm.movement_type} onChange={e => setMoveForm({ ...moveForm, movement_type: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                                    <option value="purchase">Purchase (add)</option>
                                    <option value="usage">Usage (subtract)</option>
                                    <option value="waste">Waste (subtract)</option>
                                    <option value="adjustment">Adjustment (subtract)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1">Quantity ({stockModal.unit})</label>
                                <input type="text" inputMode="decimal" value={moveForm.quantity}
                                    onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setMoveForm({ ...moveForm, quantity: v }) }}
                                    placeholder="e.g. 5"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1">Notes</label>
                                <input type="text" value={moveForm.notes} onChange={e => setMoveForm({ ...moveForm, notes: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button onClick={() => setStockModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-55 rounded-lg">Cancel</button>
                            <button onClick={handleStockMove} disabled={saving}
                                className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-800 transition-colors">
                                {saving ? 'Saving...' : 'Submit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Stock Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-medium">Name</th>
                            <th className="text-right px-4 py-3 font-medium">Stock</th>
                            <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Reorder</th>
                            <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Cost/Unit</th>
                            <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Supplier</th>
                            <th className="text-right px-4 py-3 font-medium">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {ingredients.map(ing => {
                            const isLow = ing.reorder_level !== null && ing.stock_quantity <= (ing.reorder_level ?? 0)
                            return (
                                <tr key={ing.id} className={`hover:bg-gray-50 ${isLow ? 'bg-amber-50' : ''}`}>
                                    <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                        {isLow && <AlertTriangle size={14} className="text-amber-600" />}
                                        {ing.name}
                                    </td>
                                    <td className={`px-4 py-3 text-right font-mono ${isLow ? 'text-amber-700 font-semibold' : 'text-gray-700'}`}>
                                        {ing.stock_quantity} {ing.unit}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{ing.reorder_level ?? '—'} {ing.unit}</td>
                                    <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">${ing.cost_per_unit.toFixed(2)}</td>
                                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{ing.supplier || '—'}</td>
                                    <td className="px-4 py-3 text-right flex items-center gap-2 justify-end">
                                        <button onClick={() => openEditModal(ing)}
                                            className="text-blue-500 hover:text-blue-700 p-1.5 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => { setStockModal(ing); setMoveForm({ movement_type: 'purchase', quantity: '', notes: '' }) }}
                                            className="text-gray-600 hover:text-gray-900 p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="Stock Movement">
                                            <Package size={16} />
                                        </button>
                                        <button onClick={() => handleDelete(ing.id)} className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                        {ingredients.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No stock items tracked yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
