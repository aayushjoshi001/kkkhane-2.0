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
            <div className="bg-surface-muted/30 border border-hairline rounded-[var(--r-lg)] p-6 space-y-4 shadow-inner">
                <div className="flex gap-3">
                    <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                    <div>
                        <h3 className="font-bold text-ink">Database Schema Migration Required</h3>
                        <p className="text-ink-subtle text-sm mt-1">
                            The Combo Offers feature requires updates to the database schema. Please apply the migration SQL file to enable this page.
                        </p>
                        <p className="text-amber-600 text-xs mt-1 font-mono">{dbError || 'Column menu_items.is_combo or table combo_items does not exist'}</p>
                    </div>
                </div>

                <div className="bg-surface text-ink-subtle p-4 rounded-[var(--r-md)] font-mono text-xs overflow-x-auto space-y-2 border border-hairline shadow-sm">
                    <p className="text-ink-subtle/70"># Run the migration file or execute this SQL in the Supabase SQL Editor:</p>
                    <code className="text-ink">{`-- 1. Add is_combo to menu_items
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
                    className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring"
                >
                    <Plus size={16} /> Create Combo Offer
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="bg-surface rounded-card border border-hairline p-6 space-y-6 shadow-sm">
                    <h2 className="text-h3 text-ink">{editingCombo ? 'Edit Combo Offer' : 'Create New Combo Offer'}</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-5">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Combo Name *</label>
                                <input
                                    type="text"
                                    required
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    placeholder="e.g. Double Deal Burger Bundle"
                                />
                            </div>

                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Description</label>
                                <textarea
                                    value={form.description}
                                    onChange={e => setForm({ ...form, description: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all resize-none h-24"
                                    placeholder="e.g. Get 2 Burgers, French Fries, and 2 Coca-Colas at a special discount."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Category *</label>
                                    <select
                                        value={form.category_id}
                                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Price ({currencySymbol}) *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        min="0"
                                        value={form.price || ''}
                                        onChange={e => setForm({ ...form, price: +e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-small font-bold text-ink">Image (Optional)</label>
                                    <div className="flex items-center gap-1 bg-surface-muted rounded-[var(--r-md)] p-1 border border-hairline">
                                        <button type="button" onClick={() => setImageMode('upload')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${imageMode === 'upload' ? 'bg-surface shadow-sm text-ink' : 'text-ink-subtle hover:text-ink'}`}>
                                            <Upload size={12} /> Upload
                                        </button>
                                        <button type="button" onClick={() => setImageMode('url')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${imageMode === 'url' ? 'bg-surface shadow-sm text-ink' : 'text-ink-subtle hover:text-ink'}`}>
                                            <LinkIcon size={12} /> URL
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
                                            <div className="relative rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted shadow-inner group/img" style={{ height: 160 }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={form.image_url} alt="Combo preview" className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                                                    <button type="button" onClick={() => imageInputRef.current?.click()} className="bg-surface text-ink text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
                                                        <Upload size={14} /> Change
                                                    </button>
                                                    <button type="button" onClick={() => setForm(prev => ({ ...prev, image_url: '' }))} className="bg-danger-bg text-danger-fg text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
                                                        <X size={14} /> Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading} className="w-full border-2 border-dashed border-hairline rounded-[var(--r-md)] h-36 flex flex-col items-center justify-center gap-3 text-ink-subtle hover:border-brand-400 hover:text-brand-500 hover:bg-brand-50 transition-colors disabled:opacity-50 focus-ring">
                                                {imageUploading ? <Loader2 size={28} className="animate-spin" /> : <ImageIcon size={28} />}
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-sm font-bold">{imageUploading ? 'Uploading…' : 'Click to upload photo'}</span>
                                                    {!imageUploading && <span className="text-xs text-ink-subtle">JPG, PNG, WEBP up to 5MB</span>}
                                                </div>
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <input
                                            type="url"
                                            value={form.image_url}
                                            onChange={e => setForm({ ...form, image_url: e.target.value })}
                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                            placeholder="https://images.unsplash.com/photo-..."
                                        />
                                        {form.image_url && (
                                            <div className="relative rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted shadow-inner" style={{ height: 140 }}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={form.image_url} alt="Combo preview" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-4 bg-surface-muted/30 rounded-[var(--r-lg)] border border-hairline mt-2">
                                <div>
                                    <span className="text-small font-bold text-ink block">Available on menu</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer group">
                                    <input type="checkbox" className="sr-only peer" checked={form.is_available} onChange={e => setForm(prev => ({ ...prev, is_available: e.target.checked }))} />
                                    <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                </label>
                            </div>
                        </div>

                        {/* Components Builder */}
                        <div className="border-t md:border-t-0 md:border-l border-hairline md:pl-6 pt-6 md:pt-0 space-y-5">
                            <div className="flex items-center justify-between">
                                <label className="block text-small font-bold text-ink">Bundle Items *</label>
                                <button
                                    type="button"
                                    onClick={handleAddComponentRow}
                                    className="text-xs font-bold text-brand-500 hover:text-brand-600 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-brand-50"
                                >
                                    <Plus size={14} /> Add Item
                                </button>
                            </div>

                            <div className="space-y-3 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                                {form.components.map((comp, idx) => (
                                    <div key={idx} className="flex gap-3 items-center bg-surface p-2.5 rounded-[var(--r-md)] border border-hairline shadow-sm">
                                        <select
                                            value={comp.item_id}
                                            onChange={e => handleComponentChange(idx, 'item_id', e.target.value)}
                                            className="flex-1 w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-sm p-2.5 border bg-surface text-ink transition-all min-w-0"
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
                                            className="w-16 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-sm p-2.5 border bg-surface text-ink transition-all text-center tabular-nums"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveComponentRow(idx)}
                                            disabled={form.components.length === 1}
                                            className="p-2 text-ink-subtle hover:text-danger-fg disabled:opacity-30 rounded-[var(--r-md)] hover:bg-danger-bg transition-colors shrink-0"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                                {form.components.length === 0 && (
                                    <p className="text-xs text-ink-subtle text-center py-6 border-2 border-dashed border-hairline rounded-[var(--r-md)]">
                                        No items added yet. Click &quot;Add Item&quot; to build this combo.
                                    </p>
                                )}
                            </div>

                            {/* Savings Summary box */}
                            {formNormalTotal > 0 && (
                                <div className="p-4 bg-brand-50/50 border border-brand-100/50 rounded-[var(--r-lg)] flex items-start gap-3 shadow-inner">
                                    <Info className="text-brand-500 shrink-0 mt-0.5" size={16} />
                                    <div className="text-sm text-ink-subtle space-y-1.5">
                                        <p>
                                            Normal total value of items: <span className="font-bold text-ink tabular-nums">{money(formNormalTotal)}</span>
                                        </p>
                                        <p>
                                            Combo offer price: <span className="font-bold text-ink tabular-nums">{money(form.price)}</span>
                                        </p>
                                        {formSavings > 0 ? (
                                            <p className="text-success-fg font-bold flex items-center gap-1.5 mt-2 bg-success-bg/50 px-2.5 py-1 rounded-[var(--r-md)] w-max border border-success-bg">
                                                <Sparkles size={14} /> Saves customers {money(formSavings)} ({formSavingsPercentage}%)!
                                            </p>
                                        ) : formSavings < 0 ? (
                                            <p className="text-amber-600 font-bold mt-2">
                                                Note: Combo price is higher than standard pricing.
                                            </p>
                                        ) : (
                                            <p className="text-ink-subtle mt-2">Same as purchasing individually.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end border-t border-hairline pt-6 mt-4">
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 focus-ring"
                        >
                            {saving ? <Loader2 size={18} className="animate-spin" /> : (editingCombo ? <Edit2 size={16} /> : <Plus size={16} />)}
                            {saving ? 'Saving...' : editingCombo ? 'Update Combo' : 'Create Combo'}
                        </button>
                    </div>
                </form>
            )}

            {/* List Table */}
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-ink-subtle uppercase tracking-wider text-[10px] font-bold border-b border-hairline">
                            <tr>
                                <th className="text-left px-6 py-4 font-bold">Combo Details</th>
                                <th className="text-left px-6 py-4 font-bold">Category</th>
                                <th className="text-left px-6 py-4 font-bold">Price</th>
                                <th className="text-left px-6 py-4 font-bold hidden md:table-cell">Bundle Contents</th>
                                <th className="text-left px-6 py-4 font-bold hidden md:table-cell">Savings</th>
                                <th className="text-left px-6 py-4 font-bold">Status</th>
                                <th className="text-right px-6 py-4 font-bold">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
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
                                    <tr key={combo.id} className="hover:bg-surface-muted/30 transition-colors duration-150">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                {combo.image_url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={combo.image_url}
                                                        alt={combo.name}
                                                        className="w-12 h-12 rounded-[var(--r-md)] object-cover shrink-0 shadow-sm border border-hairline"
                                                    />
                                                ) : (
                                                    <div className="w-12 h-12 rounded-[var(--r-md)] bg-surface-muted border border-hairline shrink-0 flex items-center justify-center text-lg shadow-sm">
                                                        📦
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="font-bold text-ink text-sm leading-snug">{combo.name}</p>
                                                    {combo.description && (
                                                        <p className="text-xs text-ink-subtle mt-1 line-clamp-1">{combo.description}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-ink-subtle font-medium">
                                            {category ? category.name : <span className="text-ink-subtle/50 italic">None</span>}
                                        </td>
                                        <td className="px-6 py-4 font-bold text-ink tabular-nums">
                                            {money(combo.price)}
                                        </td>
                                        <td className="px-6 py-4 text-xs text-ink-subtle hidden md:table-cell">
                                            <div className="space-y-1 max-w-[200px]">
                                                {componentsList.map(c => {
                                                    const it = menuItems.find(m => m.id === c.item_id)
                                                    return (
                                                        <div key={c.id} className="flex justify-between font-medium">
                                                            <span className="text-ink line-clamp-1">{it?.name || 'Item'}</span>
                                                            <span className="text-ink-subtle/70 tabular-nums shrink-0 ml-2">×{c.quantity}</span>
                                                        </div>
                                                    )
                                                })}
                                                {componentsList.length === 0 && (
                                                    <span className="text-amber-500 font-bold flex items-center gap-1.5 bg-amber-50 px-2 py-1 rounded-md w-max">
                                                        <AlertCircle size={12} /> Empty bundle
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 hidden md:table-cell">
                                            {savingsAmount > 0 ? (
                                                <div>
                                                    <span className="text-xs font-bold bg-success-bg/50 text-success-fg px-2.5 py-1 rounded-full border border-success-bg inline-block tabular-nums">
                                                        {money(savingsAmount)} ({savingsPct}%)
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-ink-subtle/50">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <label className="relative inline-flex items-center cursor-pointer group">
                                                <input 
                                                    type="checkbox" 
                                                    className="sr-only peer" 
                                                    checked={combo.is_available} 
                                                    onChange={() => handleToggleActive(combo)}
                                                />
                                                <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                            </label>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex gap-1.5 justify-end">
                                                <button
                                                    onClick={() => openEditForm(combo)}
                                                    className="p-2 text-ink-subtle hover:text-ink hover:bg-surface-muted rounded-[var(--r-md)] transition-colors"
                                                    title="Edit Combo"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCombo(combo.id)}
                                                    className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] transition-colors"
                                                    title="Delete Combo"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                            {combos.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-6 py-16 text-center text-ink-subtle">
                                        <ShoppingBag className="mx-auto mb-3 text-ink-subtle/30" size={40} />
                                        <p className="font-bold text-ink text-base">No combo offers found.</p>
                                        <p className="text-sm mt-1">Click &quot;Create Combo Offer&quot; above to add one.</p>
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
