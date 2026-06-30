'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2, Edit2, ToggleLeft, ToggleRight, Sparkles, AlertCircle, Info, ShoppingBag, Upload, Link as LinkIcon, Image as ImageIcon, Loader2, X } from 'lucide-react'
import type { MenuItem, MenuCategory } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { addComboAction, updateComboAction, deleteComboAction } from './actions'
import toast from 'react-hot-toast'
import { useCurrency, useFeatures } from '@/lib/contexts/FeatureContext'

// Monotonic counter for unique upload paths — avoids crypto.randomUUID (unavailable
// on non-HTTPS LAN origins) and Date.now/Math.random (flagged by react-hooks/purity).
let uploadSeq = 0

interface ComboItemMapping {
    id: string
    combo_id: string
    item_id: string
    quantity: number
}

interface CombosManagerProps {
    initialCombos: MenuItem[]
    initialComboItems: ComboItemMapping[]
    categories: MenuCategory[]
    menuItems: MenuItem[]
    restaurantId: string
    isDbReady: boolean
    dbError?: string
}

export default function CombosManager({
    initialCombos,
    initialComboItems,
    categories,
    menuItems,
    restaurantId,
    isDbReady,
    dbError,
}: CombosManagerProps) {
    const [combos, setCombos] = useState<MenuItem[]>(initialCombos)
    const money = useCurrency()
    const { currencySymbol } = useFeatures()
    const [comboItems, setComboItems] = useState<ComboItemMapping[]>(initialComboItems)
    const [showForm, setShowForm] = useState(false)
    const [editingCombo, setEditingCombo] = useState<MenuItem | null>(null)
    const [saving, setSaving] = useState(false)
    const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload')
    const [imageUploading, setImageUploading] = useState(false)
    const imageInputRef = useRef<HTMLInputElement>(null)

    // Form state
    const [form, setForm] = useState({
        name: '',
        description: '',
        price: 0,
        category_id: '',
        image_url: '',
        is_available: true,
        components: [] as { item_id: string; quantity: number }[],
    })

    // If database schema is not set up
    if (!isDbReady) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 space-y-4">
                <div className="flex gap-3">
                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <div>
                        <h3 className="font-bold text-amber-900">Database Schema Migration Required</h3>
                        <p className="text-amber-700 text-sm mt-1">
                            The Combo Offers feature requires updates to the database schema. Please apply the migration SQL file to enable this page.
                        </p>
                        <p className="text-amber-600 text-xs mt-1 font-mono">{dbError || 'Column menu_items.is_combo or table combo_items does not exist'}</p>
                    </div>
                </div>

                <div className="bg-gray-900 text-gray-200 p-4 rounded-lg font-mono text-xs overflow-x-auto space-y-2">
                    <p className="text-gray-400"># Run the migration file or execute this SQL in the Supabase SQL Editor:</p>
                    <code>{`-- 1. Add is_combo to menu_items
ALTER TABLE public.menu_items ADD COLUMN is_combo BOOLEAN DEFAULT false NOT NULL;

-- 2. Create combo_items relation table
CREATE TABLE public.combo_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combo_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_combo_item UNIQUE (combo_id, item_id)
);

-- 3. Enable RLS
ALTER TABLE public.combo_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_combo_items" ON public.combo_items FOR SELECT USING (true);`}</code>
                </div>
            </div>
        )
    }

    const openNewComboForm = () => {
        setEditingCombo(null)
        setForm({
            name: '',
            description: '',
            price: 0,
            category_id: categories[0]?.id || '',
            image_url: '',
            is_available: true,
            components: [{ item_id: menuItems[0]?.id || '', quantity: 1 }],
        })
        setShowForm(true)
    }

    const openEditForm = (combo: MenuItem) => {
        setEditingCombo(combo)
        // Find existing components for this combo
        const existingComponents = comboItems
            .filter(ci => ci.combo_id === combo.id)
            .map(ci => ({
                item_id: ci.item_id,
                quantity: ci.quantity,
            }))

        setForm({
            name: combo.name,
            description: combo.description || '',
            price: combo.price,
            category_id: combo.category_id || '',
            image_url: combo.image_url || '',
            is_available: combo.is_available,
            components: existingComponents.length > 0 ? existingComponents : [{ item_id: menuItems[0]?.id || '', quantity: 1 }],
        })
        setShowForm(true)
    }

    // --- Image upload (combos are menu_items, so reuse the menu-images bucket) ---
    const uploadComboImage = async (file: File) => {
        setImageUploading(true)
        try {
            const supabase = createClient()
            const ext = file.name.split('.').pop()
            const path = `${restaurantId}/combo-${file.lastModified}-${uploadSeq++}.${ext}`
            const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true })
            if (error) throw error
            const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(path)
            setForm(prev => ({ ...prev, image_url: urlData.publicUrl }))
            toast.success('Image uploaded')
        } catch (err) {
            toast.error(err instanceof Error ? `Upload failed: ${err.message}` : 'Failed to upload image')
        } finally {
            setImageUploading(false)
        }
    }

    const handleAddComponentRow = () => {
        setForm(prev => ({
            ...prev,
            components: [...prev.components, { item_id: menuItems[0]?.id || '', quantity: 1 }],
        }))
    }

    const handleRemoveComponentRow = (index: number) => {
        setForm(prev => ({
            ...prev,
            components: prev.components.filter((_, i) => i !== index),
        }))
    }

    const handleComponentChange = (index: number, field: 'item_id' | 'quantity', value: string | number) => {
        setForm(prev => {
            const updated = [...prev.components]
            updated[index] = {
                ...updated[index],
                [field]: value,
            }
            return {
                ...prev,
                components: updated,
            }
        })
    }

    // Calculate normal items sum price
    const calculateComponentsNormalTotal = (components: { item_id: string; quantity: number }[]) => {
        return components.reduce((sum, comp) => {
            const item = menuItems.find(m => m.id === comp.item_id)
            return sum + (item ? item.price * comp.quantity : 0)
        }, 0)
    }

    const formNormalTotal = calculateComponentsNormalTotal(form.components)
    const formSavings = formNormalTotal > 0 ? formNormalTotal - form.price : 0
    const formSavingsPercentage = formNormalTotal > 0 ? Math.round((formSavings / formNormalTotal) * 100) : 0

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (form.components.length === 0) {
            toast.error('Please add at least one item to the combo offer')
            return
        }

        setSaving(true)
        if (editingCombo) {
            const result = await updateComboAction(
                editingCombo.id,
                {
                    name: form.name,
                    description: form.description || null,
                    price: form.price,
                    category_id: form.category_id || null,
                    image_url: form.image_url || null,
                    is_available: form.is_available,
                },
                form.components
            )

            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success('Combo offer updated successfully!')
                // Refresh local state (since we are not re-fetching from DB directly on client state)
                setCombos(prev =>
                    prev.map(c =>
                        c.id === editingCombo.id
                            ? {
                                  ...c,
                                  name: form.name,
                                  description: form.description || null,
                                  price: form.price,
                                  category_id: form.category_id || null,
                                  image_url: form.image_url || null,
                                  is_available: form.is_available,
                              }
                            : c
                    )
                )

                // Update combo items state
                setComboItems(prev => {
                    const filtered = prev.filter(ci => ci.combo_id !== editingCombo.id)
                    const added = form.components.map((c, i) => ({
                        id: `temp-${Date.now()}-${i}`,
                        combo_id: editingCombo.id,
                        item_id: c.item_id,
                        quantity: c.quantity,
                    }))
                    return [...filtered, ...added]
                })

                setShowForm(false)
            }
        } else {
            const result = await addComboAction(
                restaurantId,
                {
                    name: form.name,
                    description: form.description || null,
                    price: form.price,
                    category_id: form.category_id || null,
                    image_url: form.image_url || null,
                    is_available: form.is_available,
                },
                form.components
            )

            if (result.error) {
                toast.error(result.error)
            } else {
                toast.success('Combo offer created!')
                const newCombo = result.data as MenuItem
                setCombos(prev => [newCombo, ...prev])

                // Add newly created combo items mappings to local state
                const newMappings = form.components.map((c, i) => ({
                    id: `temp-${Date.now()}-${i}`,
                    combo_id: newCombo.id,
                    item_id: c.item_id,
                    quantity: c.quantity,
                }))
                setComboItems(prev => [...prev, ...newMappings])

                setShowForm(false)
            }
        }
        setSaving(false)
    }

    const handleToggleActive = async (combo: MenuItem) => {
        const newStatus = !combo.is_available
        const result = await updateComboAction(
            combo.id,
            {
                name: combo.name,
                description: combo.description,
                price: combo.price,
                category_id: combo.category_id,
                image_url: combo.image_url,
                is_available: newStatus,
            },
            comboItems.filter(ci => ci.combo_id === combo.id).map(ci => ({ item_id: ci.item_id, quantity: ci.quantity }))
        )

        if (result.error) {
            toast.error(result.error)
        } else {
            setCombos(prev => prev.map(c => (c.id === combo.id ? { ...c, is_available: newStatus } : c)))
            toast.success(`Combo set to ${newStatus ? 'Available' : 'Unavailable'}`)
        }
    }

    const handleDeleteCombo = async (comboId: string) => {
        if (!confirm('Are you sure you want to delete this combo offer?')) return

        const result = await deleteComboAction(comboId)
        if (result.error) {
            toast.error(result.error)
        } else {
            setCombos(prev => prev.filter(c => c.id !== comboId))
            setComboItems(prev => prev.filter(ci => ci.combo_id !== comboId))
            toast.success('Combo offer deleted successfully')
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <button
                    onClick={openNewComboForm}
                    className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-800 transition active:scale-95 shadow-sm"
                >
                    <Plus size={16} /> Create Combo Offer
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
                    <h2 className="text-lg font-bold text-gray-900">{editingCombo ? 'Edit Combo Offer' : 'Create New Combo Offer'}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Combo Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                                    placeholder="e.g. Double Deal Burger Bundle"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={e => setForm({ ...form, description: e.target.value })}
                                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none h-24 resize-none"
                                    placeholder="e.g. Get 2 Burgers, French Fries, and 2 Coca-Colas at a special discount."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Category *</label>
                                    <select
                                        value={form.category_id}
                                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                                        className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none bg-white"
                                    >
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Price ({currencySymbol}) *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        min="0"
                                        value={form.price || ''}
                                        onChange={e => setForm({ ...form, price: +e.target.value })}
                                        className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Image (Optional)</label>
                                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                                        <button type="button" onClick={() => setImageMode('upload')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${imageMode === 'upload' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                            <Upload size={11} /> Upload
                                        </button>
                                        <button type="button" onClick={() => setImageMode('url')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${imageMode === 'url' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                            <LinkIcon size={11} /> URL
                                        </button>
                                    </div>
                                </div>
                                {imageMode === 'upload' ? (
                                    <div>
                                        <input
                                            ref={imageInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadComboImage(f) }}
                                        />
                                        {form.image_url ? (
                                            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 group" style={{ height: 140 }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={form.image_url} alt="Combo preview" className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                    <button type="button" onClick={() => imageInputRef.current?.click()} className="bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1">
                                                        <Upload size={12} /> Change
                                                    </button>
                                                    <button type="button" onClick={() => setForm(prev => ({ ...prev, image_url: '' }))} className="bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1">
                                                        <X size={12} /> Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading} className="w-full border-2 border-dashed border-gray-200 rounded-xl h-28 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-primary hover:text-primary transition-colors disabled:opacity-50">
                                                {imageUploading ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                                                <span className="text-xs font-medium">{imageUploading ? 'Uploading…' : 'Click to upload photo'}</span>
                                                {!imageUploading && <span className="text-xs text-gray-300">JPG, PNG, WEBP up to 5MB</span>}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <input
                                            type="url"
                                            value={form.image_url}
                                            onChange={e => setForm({ ...form, image_url: e.target.value })}
                                            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none"
                                            placeholder="https://images.unsplash.com/photo-..."
                                        />
                                        {form.image_url && (
                                            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50" style={{ height: 120 }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={form.image_url} alt="Combo preview" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setForm(prev => ({ ...prev, is_available: !prev.is_available }))}
                                    className="text-gray-500"
                                >
                                    {form.is_available ? <ToggleRight size={26} className="text-green-500" /> : <ToggleLeft size={26} />}
                                </button>
                                <span className="text-sm font-semibold text-gray-700">Available on menu</span>
                            </div>
                        </div>

                        {/* Components Builder */}
                        <div className="border-t md:border-t-0 md:border-l border-gray-100 md:pl-5 pt-5 md:pt-0 space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Bundle Items *</label>
                                <button
                                    type="button"
                                    onClick={handleAddComponentRow}
                                    className="text-xs text-primary font-bold hover:underline flex items-center gap-1"
                                >
                                    <Plus size={14} /> Add Item
                                </button>
                            </div>

                            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                                {form.components.map((comp, idx) => (
                                    <div key={idx} className="flex gap-2 items-center">
                                        <select
                                            value={comp.item_id}
                                            onChange={e => handleComponentChange(idx, 'item_id', e.target.value)}
                                            className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary focus:outline-none bg-white min-w-0"
                                        >
                                            {menuItems.map(item => (
                                                <option key={item.id} value={item.id}>
                                                    {item.name} ({money(item.price)})
                                                </option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            min="1"
                                            required
                                            value={comp.quantity}
                                            onChange={e => handleComponentChange(idx, 'quantity', +e.target.value)}
                                            className="w-16 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none text-center"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveComponentRow(idx)}
                                            disabled={form.components.length === 1}
                                            className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-30 rounded-lg hover:bg-red-50 transition shrink-0"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                {form.components.length === 0 && (
                                    <p className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                                        No items added yet. Click &quot;Add Item&quot; to build this combo.
                                    </p>
                                )}
                            </div>

                            {/* Savings Summary box */}
                            {formNormalTotal > 0 && (
                                <div className="p-4 bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/10 rounded-2xl flex items-start gap-3">
                                    <Info className="text-amber-500 shrink-0 mt-0.5" size={16} />
                                    <div className="text-xs text-gray-600 space-y-1">
                                        <p>
                                            Normal total value of items: <span className="font-bold text-gray-900">{money(formNormalTotal)}</span>
                                        </p>
                                        <p>
                                            Combo offer price: <span className="font-bold text-gray-900">{money(form.price)}</span>
                                        </p>
                                        {formSavings > 0 ? (
                                            <p className="text-green-600 font-semibold flex items-center gap-1 mt-1.5 bg-green-50 px-2 py-0.5 rounded-lg w-max border border-green-100">
                                                <Sparkles size={12} /> Saves customers {money(formSavings)} ({formSavingsPercentage}%)!
                                            </p>
                                        ) : formSavings < 0 ? (
                                            <p className="text-amber-600 font-medium mt-1.5">
                                                Note: Combo price is higher than standard pricing.
                                            </p>
                                        ) : (
                                            <p className="text-gray-400 mt-1.5">Same as purchasing individually.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end border-t border-gray-100 pt-5">
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="px-5 py-2.5 border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 rounded-xl transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-5 py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition disabled:opacity-50 flex items-center gap-2"
                        >
                            {saving ? 'Saving...' : editingCombo ? 'Update Combo' : 'Create Combo'}
                        </button>
                    </div>
                </form>
            )}

            {/* List Table */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px] font-bold">
                            <tr>
                                <th className="text-left px-5 py-4 font-semibold">Combo Details</th>
                                <th className="text-left px-5 py-4 font-semibold">Category</th>
                                <th className="text-left px-5 py-4 font-semibold">Price</th>
                                <th className="text-left px-5 py-4 font-semibold hidden md:table-cell">Bundle Contents</th>
                                <th className="text-left px-5 py-4 font-semibold hidden md:table-cell">Savings</th>
                                <th className="text-left px-5 py-4 font-semibold">Status</th>
                                <th className="text-right px-5 py-4 font-semibold">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {combos.map(combo => {
                                const category = categories.find(c => c.id === combo.category_id)
                                // Get components
                                const componentsList = comboItems.filter(ci => ci.combo_id === combo.id)
                                const normalTotal = calculateComponentsNormalTotal(
                                    componentsList.map(c => ({ item_id: c.item_id, quantity: c.quantity }))
                                )
                                const savingsAmount = normalTotal > 0 ? normalTotal - combo.price : 0
                                const savingsPct = normalTotal > 0 ? Math.round((savingsAmount / normalTotal) * 100) : 0

                                return (
                                    <tr key={combo.id} className="hover:bg-gray-50 transition duration-150">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                {combo.image_url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={combo.image_url}
                                                        alt={combo.name}
                                                        className="w-10 h-10 rounded-xl object-cover shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-xl bg-gray-100 shrink-0 flex items-center justify-center text-lg">
                                                        📦
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="font-bold text-gray-900 text-sm leading-snug">{combo.name}</p>
                                                    {combo.description && (
                                                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{combo.description}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-gray-600 font-medium">
                                            {category ? category.name : <span className="text-gray-400 italic">None</span>}
                                        </td>
                                        <td className="px-5 py-4 font-bold text-gray-900">
                                            {money(combo.price)}
                                        </td>
                                        <td className="px-5 py-4 text-xs text-gray-500 hidden md:table-cell">
                                            <div className="space-y-0.5 max-w-xs">
                                                {componentsList.map(c => {
                                                    const it = menuItems.find(m => m.id === c.item_id)
                                                    return (
                                                        <div key={c.id} className="flex justify-between font-medium">
                                                            <span className="text-gray-600">{it?.name || 'Item'}</span>
                                                            <span className="text-gray-400 tabular-nums">×{c.quantity}</span>
                                                        </div>
                                                    )
                                                })}
                                                {componentsList.length === 0 && (
                                                    <span className="text-amber-500 font-medium flex items-center gap-1">
                                                        <AlertCircle size={12} /> Empty bundle contents
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 hidden md:table-cell">
                                            {savingsAmount > 0 ? (
                                                <div>
                                                    <span className="text-xs font-bold bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100 inline-block">
                                                        {money(savingsAmount)} ({savingsPct}%)
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4">
                                            <button
                                                onClick={() => handleToggleActive(combo)}
                                                className="text-gray-400 hover:text-gray-600 transition"
                                            >
                                                {combo.is_available ? (
                                                    <ToggleRight size={24} className="text-green-500" />
                                                ) : (
                                                    <ToggleLeft size={24} />
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <div className="flex gap-1 justify-end">
                                                <button
                                                    onClick={() => openEditForm(combo)}
                                                    className="p-1.5 text-gray-400 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition"
                                                    title="Edit Combo"
                                                >
                                                    <Edit2 size={15} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCombo(combo.id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition"
                                                    title="Delete Combo"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                            {combos.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                                        <ShoppingBag className="mx-auto mb-2 text-gray-200" size={36} />
                                        <p className="font-medium text-gray-500">No combo offers found.</p>
                                        <p className="text-xs text-gray-400 mt-0.5">Click &quot;Create Combo Offer&quot; above to add one.</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
