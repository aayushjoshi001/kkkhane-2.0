'use client'

import React, { useState, useEffect, useRef } from 'react'
import { NepaliInput } from '@/components/ui'
import Image from 'next/image'
import { Plus, Edit2, Trash2, GripVertical, Check, X, Tag, Loader2, Image as ImageIcon, Globe, Upload, Link, Search } from 'lucide-react'
import type { MenuCategory, MenuItem, Ingredient } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import {
    addCategoryAction, updateCategoryAction, deleteCategoryAction,
    addItemAction, updateItemAction, deleteItemAction,
    getItemRecipeAction
} from '@/app/(admin)/admin/menu/actions'
import { createIngredientAction } from '@/app/(admin)/admin/ingredients/actions'
import { convertToStockUnit } from '@/lib/conversions'
import { getRestaurantTranslationConfig } from '@/app/(admin)/admin/menu/translation-actions'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import TranslationModal from '@/components/admin/TranslationModal'

type TranslationRow = { language_code: string; entity_type: string; entity_id: string; translated_text: string }

// Monotonic counter for unique upload paths. Avoids crypto.randomUUID (unavailable
// on non-HTTPS LAN origins) and Date.now/Math.random (flagged by react-hooks/purity).
let uploadSeq = 0

export default function MenuManager({
    initialCategories,
    initialItems,
    initialIngredients,
    restaurantId
}: {
    initialCategories: MenuCategory[]
    initialItems: MenuItem[]
    initialIngredients: Ingredient[]
    restaurantId: string
}) {
    const [categories, setCategories] = useState<MenuCategory[]>(initialCategories)
    const money = useCurrency()
    const [items, setItems] = useState<MenuItem[]>(initialItems)
    const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients)
    const [recipe, setRecipe] = useState<{
        ingredient_id: string;
        quantity_needed: number;
        input_quantity?: number;
        input_unit?: string;
        input_raw?: string;
    }[]>([])
    const [showAddStockModal, setShowAddStockModal] = useState(false)
    const [newStockForm, setNewStockForm] = useState({
        name: '',
        unit: 'kg',
        stock_quantity: '',
        cost_per_unit: '',
        reorder_level: '10',
        supplier: ''
    })
    const [isCreatingStock, setIsCreatingStock] = useState(false)
    const [activeTab, setActiveTab] = useState<'categories' | 'items'>('items')
    const { confirm } = useConfirmStore()

    const [searchQuery, setSearchQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('all')

    const filteredItems = items.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              (item.description?.toLowerCase() || '').includes(searchQuery.toLowerCase())
        const matchesCategory = categoryFilter === 'all' || item.category_id === categoryFilter
        return matchesSearch && matchesCategory
    })

    // Category Modal State
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
    const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null)
    const [categoryName, setCategoryName] = useState('')
    const [categorySort, setCategorySort] = useState(0)
    const [categoryVisible, setCategoryVisible] = useState(true)
    const [categoryImageUrl, setCategoryImageUrl] = useState<string | null>('')
    const [categoryImageUploading, setCategoryImageUploading] = useState(false)

    // Item Modal State
    const [isItemModalOpen, setIsItemModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<MenuItem | null>(null)
    const [itemFormData, setItemFormData] = useState<Partial<MenuItem>>({
        name: '', description: '', price: 0, is_available: true, category_id: '', image_url: ''
    })
    const [hasVariations, setHasVariations] = useState(false)
    const [itemVariations, setItemVariations] = useState<{ id?: string; name: string; price: number; is_available: boolean; image_url?: string | null }[]>([])
    const [variationUploadIdx, setVariationUploadIdx] = useState<number | null>(null)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [imageUploading, setImageUploading] = useState(false)
    const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload')
    const imageInputRef = useRef<HTMLInputElement>(null)

    // Translation modal state
    const [translations, setTranslations] = useState<TranslationRow[]>([])
    const [hasNepali, setHasNepali] = useState(false)
    const [translateTarget, setTranslateTarget] = useState<{
        entityId: string; entityType: 'menu_item' | 'category'; name: string; description?: string | null
    } | null>(null)

    useEffect(() => {
        getRestaurantTranslationConfig().then(({ translations: t, languages: l }) => {
            setTranslations(t)
            setHasNepali(l.some(lang => lang.language_code === 'ne'))
        })
    }, [])

    // --- Category Handlers ---
    const openCategoryModal = (cat?: MenuCategory) => {
        if (cat) {
            setEditingCategory(cat)
            setCategoryName(cat.name)
            setCategorySort(cat.sort_order)
            setCategoryVisible(cat.is_visible)
            setCategoryImageUrl(cat.image_url ?? '')
        } else {
            setEditingCategory(null)
            setCategoryName('')
            setCategorySort(categories.length * 10)
            setCategoryVisible(true)
            setCategoryImageUrl('')
        }
        setIsCategoryModalOpen(true)
    }

    const saveCategory = async () => {
        if (!categoryName.trim()) return
        setIsSubmitting(true)

        if (editingCategory) {
            const res = await updateCategoryAction(editingCategory.id, {
                name: categoryName,
                sort_order: categorySort,
                is_visible: categoryVisible,
                image_url: categoryImageUrl || null
            })
            if (res.success) {
                setCategories(categories.map(c => c.id === editingCategory.id ? { ...c, name: categoryName, sort_order: categorySort, is_visible: categoryVisible, image_url: categoryImageUrl || null } : c))
                toast.success('Category updated')
            } else {
                toast.error(res.error || 'Failed to update category')
            }
        } else {
            const res = await addCategoryAction(restaurantId, categoryName, categorySort, categoryVisible, categoryImageUrl || null)
            if (res.data) {
                setCategories([...categories, res.data])
                toast.success('Category created')
            } else {
                toast.error(res.error || 'Failed to create category')
            }
        }

        setIsCategoryModalOpen(false)
        setIsSubmitting(false)
    }

    const deleteCategory = async (id: string) => {
        const isOk = await confirm({
            title: 'Delete Category?',
            message: 'Are you sure? Items within this category might be orphaned.',
            confirmText: 'Delete Category',
            isDestructive: true
        })
        if (!isOk) return

        const res = await deleteCategoryAction(id)
        if (res.success) {
            setCategories(categories.filter(c => c.id !== id))
            toast.success('Category deleted')
        } else {
            toast.error(res.error || 'Failed to delete category')
        }
    }

    // --- Image Upload Handlers ---
    const uploadToStorage = async (file: File): Promise<string | null> => {
        const supabase = createClient()
        const ext = file.name.split('.').pop()
        const path = `${restaurantId}/${file.lastModified}-${uploadSeq++}.${ext}`
        const { error } = await supabase.storage.from('menu-images').upload(path, file, { upsert: true })
        if (error) throw error
        const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(path)
        return urlData.publicUrl
    }

    const uploadMenuImage = async (file: File) => {
        setImageUploading(true)
        try {
            const url = await uploadToStorage(file)
            setItemFormData(prev => ({ ...prev, image_url: url }))
            toast.success('Image uploaded')
        } catch (err) {
            toast.error(err instanceof Error ? `Upload failed: ${err.message}` : 'Failed to upload image')
        } finally {
            setImageUploading(false)
        }
    }

    const uploadVariationImage = async (idx: number, file: File) => {
        setVariationUploadIdx(idx)
        try {
            const url = await uploadToStorage(file)
            setItemVariations(prev => prev.map((v, i) => i === idx ? { ...v, image_url: url } : v))
        } catch (err) {
            toast.error(err instanceof Error ? `Upload failed: ${err.message}` : 'Failed to upload image')
        } finally {
            setVariationUploadIdx(null)
        }
    }

    const uploadCategoryImage = async (file: File) => {
        setCategoryImageUploading(true)
        try {
            const url = await uploadToStorage(file)
            setCategoryImageUrl(url)
        } catch (err) {
            toast.error(err instanceof Error ? `Upload failed: ${err.message}` : 'Failed to upload image')
        } finally {
            setCategoryImageUploading(false)
        }
    }

    // --- Item Handlers ---
    const openItemModal = async (item?: MenuItem) => {
        if (item) {
            setEditingItem(item)
            setItemFormData({ ...item })
            setHasVariations(!!(item.variations && item.variations.length > 0))
            setItemVariations(item.variations ? item.variations.map(v => ({ ...v, is_available: v.is_available ?? true })) : [])
            const res = await getItemRecipeAction(item.id)
            if (res.data) {
                setRecipe(res.data.map(r => {
                    const ing = ingredients.find(i => i.id === r.ingredient_id)
                    return {
                        ingredient_id: r.ingredient_id,
                        quantity_needed: r.quantity_needed,
                        input_quantity: r.quantity_needed,
                        input_unit: ing?.unit || 'g'
                    }
                }))
            } else {
                setRecipe([])
            }
        } else {
            setEditingItem(null)
            setItemFormData({
                name: '', description: '', price: 0, is_available: true,
                category_id: categories[0]?.id || '', image_url: ''
            })
            setHasVariations(false)
            setItemVariations([])
            setRecipe([])
        }
        setIsItemModalOpen(true)
    }

    const saveItem = async () => {
        const basePrice = hasVariations ? 0 : Number(itemFormData.price || 0)
        
        if (!itemFormData.name || (!hasVariations && !itemFormData.price) || !itemFormData.category_id) return
        
        if (hasVariations) {
            if (itemVariations.length === 0) {
                toast.error('Please add at least one variation option')
                return
            }
            if (itemVariations.some(v => !v.name.trim() || isNaN(v.price) || v.price < 0)) {
                toast.error('All variations must have a name and a valid price')
                return
            }
        }

        setIsSubmitting(true)

        const payload = {
            ...itemFormData,
            restaurant_id: restaurantId,
            price: basePrice
        }

        const variationsPayload = hasVariations ? itemVariations : []
        const validRecipe = recipe.filter(r => r.ingredient_id && Number(r.quantity_needed) > 0)
            .map(r => ({ ...r, quantity_needed: Number(r.quantity_needed) }))

        if (editingItem) {
            const res = await updateItemAction(editingItem.id, payload, variationsPayload, validRecipe)
            if (res.success) {
                setItems(items.map(i => i.id === editingItem.id ? { 
                    ...i, 
                    ...payload, 
                    variations: variationsPayload as MenuItem['variations'] 
                } as MenuItem : i))
                toast.success('Item updated')
            } else {
                toast.error(res.error || 'Failed to update item')
            }
        } else {
            const res = await addItemAction(payload, variationsPayload, validRecipe)
            if (res.data) {
                toast.success('Item added')
                setTimeout(() => window.location.reload(), 800)
            } else {
                toast.error(res.error || 'Failed to add item')
            }
        }

        setIsItemModalOpen(false)
        setIsSubmitting(false)
    }

    const deleteItem = async (id: string) => {
        const isOk = await confirm({
            title: 'Delete Item?',
            message: 'Are you sure you want to delete this menu item?',
            confirmText: 'Delete Item',
            isDestructive: true
        })
        if (!isOk) return

        const res = await deleteItemAction(id)
        if (res.success) {
            setItems(items.filter(i => i.id !== id))
            toast.success('Item deleted')
        } else {
            toast.error(res.error || 'Failed to delete item')
        }
    }

    const getAvailableUnits = (baseUnit: string) => {
        const bu = baseUnit.toLowerCase();
        if (['pcs', 'pieces', 'box'].includes(bu)) {
            return [baseUnit];
        }
        
        const isWeightBase = ['kg', 'g'].includes(bu);
        const isVolumeBase = ['l', 'ml'].includes(bu);
        
        if (isWeightBase) {
            const units = [baseUnit, 'tbsp', 'tsp', 'cup', 'g', 'kg'];
            return units.filter((value, index, self) => self.findIndex(v => v.toLowerCase() === value.toLowerCase()) === index);
        }
        
        if (isVolumeBase) {
            const units = [baseUnit, 'tbsp', 'tsp', 'cup', 'ml', 'L'];
            return units.filter((value, index, self) => self.findIndex(v => v.toLowerCase() === value.toLowerCase()) === index);
        }
        
        return [baseUnit];
    };

    const handleRecipeRowChange = (
        index: number,
        fields: { ingredient_id?: string; input_quantity?: number; input_unit?: string; input_raw?: string }
    ) => {
        setRecipe(prev => prev.map((row, idx) => {
            if (idx !== index) return row;

            const updated = { ...row, ...fields } as typeof row & typeof fields;

            const ingId = updated.ingredient_id;
            const ing = ingredients.find(i => i.id === ingId);

            if ('ingredient_id' in fields) {
                updated.input_unit = ing?.unit || 'g';
                updated.input_quantity = 0; // reset to 0 initially
                updated.input_raw = '';
            }

            const qty = Number(updated.input_quantity || 0);
            const unit = updated.input_unit || ing?.unit || 'g';
            const baseUnit = ing?.unit || 'g';

            updated.quantity_needed = convertToStockUnit(
                ing?.name || '',
                qty,
                unit,
                baseUnit
            );

            return updated;
        }));
    };

    const handleCreateStock = async () => {
        if (!newStockForm.name.trim()) {
            toast.error('Stock name is required')
            return
        }
        setIsCreatingStock(true)
        try {
            const res = await createIngredientAction({
                restaurant_id: restaurantId,
                name: newStockForm.name,
                unit: newStockForm.unit,
                stock_quantity: parseFloat(newStockForm.stock_quantity) || 0,
                cost_per_unit: parseFloat(newStockForm.cost_per_unit) || 0,
                reorder_level: parseFloat(newStockForm.reorder_level) || 0,
                supplier: newStockForm.supplier || null
            })
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                toast.success('Stock item created!')
                const created: Ingredient = res.data as any
                setIngredients(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
                setRecipe(prev => {
                    const index = prev.findIndex(r => r.ingredient_id === '')
                    if (index !== -1) {
                        return prev.map((r, i) => i === index ? { ...r, ingredient_id: created.id } : r)
                    }
                    return [...prev, { ingredient_id: created.id, quantity_needed: 0 }]
                })
                setNewStockForm({
                    name: '',
                    unit: 'kg',
                    stock_quantity: '',
                    cost_per_unit: '',
                    reorder_level: '10',
                    supplier: ''
                })
                setShowAddStockModal(false)
            }
        } catch (err) {
            toast.error('Failed to create stock item')
            console.error(err)
        } finally {
            setIsCreatingStock(false)
        }
    }

    return (
        <div className="bg-surface rounded-[var(--r-2xl)] shadow-sm border border-hairline overflow-hidden flex flex-col">
            {/* Tabs - God Level Redesign */}
            <div className="flex p-2 bg-surface-muted gap-2 border-b border-hairline">
                <button
                    onClick={() => setActiveTab('items')}
                    className={`flex-1 py-3 text-sm font-bold rounded-[var(--r-lg)] transition-all duration-300 focus-ring ${activeTab === 'items' ? 'bg-surface text-ink shadow-[0_2px_12px_rgba(0,0,0,0.06)] ring-1 ring-black/5' : 'text-ink-muted hover:text-ink hover:bg-black/5'}`}
                >
                    Menu Items
                </button>
                <button
                    onClick={() => setActiveTab('categories')}
                    className={`flex-1 py-3 text-sm font-bold rounded-[var(--r-lg)] transition-all duration-300 focus-ring ${activeTab === 'categories' ? 'bg-surface text-ink shadow-[0_2px_12px_rgba(0,0,0,0.06)] ring-1 ring-black/5' : 'text-ink-muted hover:text-ink hover:bg-black/5'}`}
                >
                    Categories
                </button>
            </div>

            {/* Content Area */}
            <div className="p-6">
                {activeTab === 'categories' ? (
                    <div className="animate-fade-in">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-h3 text-ink">Manage Categories</h3>
                                <p className="text-small text-ink-subtle mt-1">Organize your menu structure.</p>
                            </div>
                            <button
                                onClick={() => openCategoryModal()}
                                className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold hover:bg-brand-600 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 focus-ring"
                            >
                                <Plus size={18} strokeWidth={2.5} /> Add Category
                            </button>
                        </div>
                        <ul className="flex flex-col gap-3">
                            {categories.sort((a, b) => a.sort_order - b.sort_order).map((cat) => (
                                <li key={cat.id} className="group flex items-center justify-between p-4 bg-surface border border-hairline hover:border-brand-300 rounded-[var(--r-xl)] shadow-sm hover:shadow-md transition-all duration-300">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <GripVertical size={20} className="text-ink-subtle cursor-grab shrink-0 hidden sm:block hover:text-ink transition-colors" />
                                        <div className="w-14 h-14 rounded-[var(--r-md)] bg-surface-muted flex items-center justify-center shrink-0 border border-hairline overflow-hidden shadow-inner">
                                            {cat.image_url ? (
                                                <Image src={cat.image_url} alt={cat.name} width={56} height={56} className="w-full h-full object-cover" />
                                            ) : (
                                                <ImageIcon size={24} className="text-ink-subtle opacity-50" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-bold text-ink text-base flex items-center gap-2">
                                                <span className="truncate">{cat.name}</span>
                                                {!cat.is_visible && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger-bg text-danger-fg uppercase tracking-wider shrink-0 shadow-sm">Hidden</span>}
                                            </div>
                                            <div className="text-xs font-semibold text-ink-subtle mt-1 flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-brand-500/50" />
                                                Sort Order: {cat.sort_order}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        {hasNepali && (
                                            <button onClick={() => setTranslateTarget({ entityId: cat.id, entityType: 'category', name: cat.name })} className="p-2 text-ink-subtle hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors focus-ring" title="Translate">
                                                <Globe size={18} />
                                            </button>
                                        )}
                                        <button onClick={() => openCategoryModal(cat)} className="p-2 text-ink-subtle hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors focus-ring">
                                            <Edit2 size={18} />
                                        </button>
                                        <button onClick={() => deleteCategory(cat.id)} className="p-2 text-ink-subtle hover:text-danger-fg rounded-lg hover:bg-danger-bg transition-colors focus-ring">
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </li>
                            ))}
                            {categories.length === 0 && (
                                <li className="p-12 text-center flex flex-col items-center justify-center border-2 border-dashed border-hairline rounded-[var(--r-xl)] bg-surface-muted/50">
                                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                                        <Tag size={28} className="text-ink-subtle" />
                                    </div>
                                    <p className="text-ink font-bold text-base">No categories yet</p>
                                    <p className="text-ink-subtle text-sm mt-1 max-w-sm">Create categories like &quot;Starters&quot; or &quot;Mains&quot; to organize your menu items.</p>
                                </li>
                            )}
                        </ul>
                    </div>
                ) : (
                    <div className="animate-fade-in">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-h3 text-ink">Menu Items</h3>
                                <p className="text-small text-ink-subtle mt-1">Manage your dishes and prices.</p>
                            </div>
                            <button
                                onClick={() => openItemModal()}
                                className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold hover:bg-brand-600 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 focus-ring disabled:opacity-50 disabled:pointer-events-none"
                                disabled={categories.length === 0}
                            >
                                <Plus size={18} strokeWidth={2.5} /> Add Item
                            </button>
                        </div>

                        {categories.length === 0 && (
                            <div className="bg-warning-bg border border-warning/20 text-warning-fg p-5 rounded-[var(--r-xl)] text-sm mb-6 flex items-start gap-3 shadow-sm">
                                <Tag className="shrink-0 mt-0.5 text-warning" size={20} />
                                <div>
                                    <p className="font-bold text-base">Categories Required</p>
                                    <p className="mt-1 text-warning-fg/80 font-medium">Please create at least one category before adding menu items.</p>
                                </div>
                            </div>
                        )}

                        {categories.length > 0 && (
                            <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-surface p-2 rounded-[var(--r-xl)] border border-hairline shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
                                <div className="relative flex-1">
                                    <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                                    <input
                                        type="text"
                                        placeholder="Search menu items..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 rounded-[var(--r-lg)] border border-transparent hover:border-hairline bg-surface-muted text-sm font-medium focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all text-ink placeholder:text-ink-subtle"
                                    />
                                </div>
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="rounded-[var(--r-lg)] border border-transparent hover:border-hairline bg-surface-muted px-4 py-2.5 text-sm font-medium text-ink outline-none focus:bg-surface focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:w-56 transition-all"
                                >
                                    <option value="all">All Categories</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="space-y-10">
                            {categories.filter(c => categoryFilter === 'all' || c.id === categoryFilter).map(cat => {
                                const catItems = filteredItems.filter(i => i.category_id === cat.id)
                                if (catItems.length === 0) return null

                                return (
                                    <div key={cat.id}>
                                        <div className="flex items-center gap-3 mb-4">
                                            <h4 className="font-extrabold text-ink text-lg tracking-tight">
                                                {cat.name}
                                            </h4>
                                            <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-bold tabular">
                                                {catItems.length}
                                            </span>
                                            <div className="flex-1 h-px bg-hairline ml-2" />
                                        </div>
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                            {catItems.map(item => (
                                                <div key={item.id} className="group relative flex gap-5 p-5 border border-hairline rounded-[var(--r-xl)] bg-surface hover:border-brand-300 hover:shadow-md transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                                                    <div className="w-24 h-24 rounded-[var(--r-lg)] bg-surface-muted flex items-center justify-center shrink-0 border border-hairline overflow-hidden shadow-inner">
                                                        {item.image_url ? (
                                                            <Image src={item.image_url} alt={item.name} width={96} height={96} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                                        ) : (
                                                            <ImageIcon className="text-ink-subtle opacity-40" size={32} />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0 flex flex-col">
                                                        <div className="flex justify-between items-start gap-2">
                                                            <h5 className="font-bold text-ink text-base truncate leading-tight">{item.name}</h5>
                                                            {item.variations && item.variations.length > 0 ? (
                                                                <span className="font-bold text-[11px] text-ink-subtle bg-surface-muted px-2 py-1 rounded-md shrink-0 uppercase tracking-wide">
                                                                    {item.variations.length} Options
                                                                </span>
                                                            ) : (
                                                                <span className="font-extrabold text-brand-600 shrink-0 tabular bg-brand-50 px-2 py-0.5 rounded-md">{money(item.price)}</span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-ink-muted line-clamp-2 mt-1.5 leading-relaxed">{item.description}</p>
                                                        
                                                        {item.variations && item.variations.length > 0 && (
                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                                {item.variations.map(v => (
                                                                    <span key={v.id || v.name} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-surface-muted text-ink px-2 py-1 rounded-lg border border-hairline/50 shadow-sm">
                                                                        {v.image_url ? (
                                                                            <Image src={v.image_url} alt={v.name} width={16} height={16} className="w-4 h-4 object-cover rounded shrink-0" />
                                                                        ) : null}
                                                                        {v.name}: <strong className="text-brand-600 tabular">{money(v.price)}</strong>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <div className="mt-auto pt-4 flex items-center justify-between">
                                                            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm ${item.is_available ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}>
                                                                {item.is_available ? 'Available' : 'Sold Out'}
                                                            </span>
                                                            
                                                            <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity translate-x-2 sm:group-hover:translate-x-0">
                                                                {hasNepali && (
                                                                    <button onClick={() => setTranslateTarget({ entityId: item.id, entityType: 'menu_item', name: item.name, description: item.description })} className="w-8 h-8 flex items-center justify-center text-ink-subtle hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors bg-surface border border-hairline shadow-sm" title="Translate">
                                                                        <Globe size={14} />
                                                                    </button>
                                                                )}
                                                                <button onClick={() => openItemModal(item)} className="w-8 h-8 flex items-center justify-center text-ink-subtle hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors bg-surface border border-hairline shadow-sm">
                                                                    <Edit2 size={14} />
                                                                </button>
                                                                <button onClick={() => deleteItem(item.id)} className="w-8 h-8 flex items-center justify-center text-ink-subtle hover:text-danger-fg rounded-lg hover:bg-danger-bg transition-colors bg-surface border border-hairline shadow-sm">
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Category Modal Overlay */}
            {isCategoryModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-surface rounded-card shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-hairline w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex justify-between items-center">
                            <h3 className="text-h3 text-ink">{editingCategory ? 'Edit Category' : 'New Category'}</h3>
                            <button onClick={() => setIsCategoryModalOpen(false)} className="text-ink-subtle hover:text-ink transition-colors focus-ring rounded-md">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Name</label>
                                <NepaliInput
                                    value={categoryName}
                                    onChange={val => setCategoryName(val)}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    placeholder="e.g. Starters"
                                />
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Category Image (Optional)</label>
                                {categoryImageUrl ? (
                                    <div className="relative rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted h-32 group/cat shadow-inner">
                                        <Image src={categoryImageUrl} alt="Category" fill sizes="400px" className="object-cover" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/cat:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                                            <label className="bg-surface text-ink text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer hover:-translate-y-0.5">
                                                <input type="file" accept="image/*" className="sr-only" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                                <Upload size={14} /> Change
                                            </label>
                                            <button type="button" onClick={() => setCategoryImageUrl('')} className="bg-danger-bg text-danger-fg text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 hover:-translate-y-0.5">
                                                <X size={14} /> Remove
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="w-full border-2 border-dashed border-hairline rounded-[var(--r-md)] h-32 flex flex-col items-center justify-center gap-2 text-ink-subtle hover:border-brand-400 hover:text-brand-500 hover:bg-brand-50 transition-colors cursor-pointer">
                                        <input type="file" accept="image/*" className="sr-only" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                        {categoryImageUploading ? <Loader2 size={24} className="animate-spin" /> : <ImageIcon size={24} />}
                                        <span className="text-xs font-bold">{categoryImageUploading ? 'Uploading…' : 'Click to upload photo'}</span>
                                    </label>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Sort Order</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={categorySort}
                                        onChange={e => { const v = e.target.value; if (/^\d*$/.test(v)) setCategorySort(Number(v)) }}
                                        placeholder="e.g. 1"
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                    />
                                </div>
                                <div className="flex items-center pt-7">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={categoryVisible}
                                            onChange={e => setCategoryVisible(e.target.checked)}
                                            className="rounded border-hairline text-brand-500 focus:ring-brand-500/20 w-5 h-5 bg-surface transition-colors"
                                        />
                                        <span className="text-sm font-bold text-ink group-hover:text-brand-600 transition-colors">Visible to Customers</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3">
                            <button onClick={() => setIsCategoryModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">
                                Cancel
                            </button>
                            <button disabled={!categoryName.trim() || isSubmitting} onClick={saveCategory} className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
                                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Save Category
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Item Modal Overlay */}
            {isItemModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-surface rounded-card shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-hairline w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex justify-between items-center shrink-0">
                            <h3 className="text-h3 text-ink">{editingItem ? 'Edit Item' : 'New Menu Item'}</h3>
                            <button onClick={() => setIsItemModalOpen(false)} className="text-ink-subtle hover:text-ink transition-colors focus-ring rounded-md">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5 overflow-y-auto">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Item Name *</label>
                                <NepaliInput
                                    value={itemFormData.name ?? ''}
                                    onChange={val => setItemFormData({ ...itemFormData, name: val })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    placeholder="e.g. Classic Cheeseburger"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Price *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-ink-subtle font-medium sm:text-sm">$</span>
                                        </div>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            disabled={hasVariations}
                                            value={hasVariations ? 'Variations' : (itemFormData.price ?? '')}
                                            onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setItemFormData({ ...itemFormData, price: v === '' ? undefined : Number(v) }) }}
                                            placeholder={hasVariations ? 'Set in variations' : 'e.g. 12.99'}
                                            className="w-full pl-7 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all disabled:bg-surface-muted disabled:text-ink-subtle disabled:opacity-70 tabular-nums"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Category *</label>
                                    <select
                                        value={itemFormData.category_id || ''}
                                        onChange={e => setItemFormData({ ...itemFormData, category_id: e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        <option value="" disabled>Select category</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Description</label>
                                <textarea
                                    value={itemFormData.description || ''}
                                    onChange={e => setItemFormData({ ...itemFormData, description: e.target.value })}
                                    rows={3}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all resize-none"
                                    placeholder="Delicious beef patty with cheddar..."
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-small font-bold text-ink">Image (Optional)</label>
                                    <div className="flex items-center gap-1 bg-surface-muted rounded-[var(--r-md)] p-1 border border-hairline">
                                        <button type="button" onClick={() => setImageMode('upload')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${imageMode === 'upload' ? 'bg-surface shadow-sm text-ink' : 'text-ink-subtle hover:text-ink'}`}>
                                            <Upload size={12} /> Upload
                                        </button>
                                        <button type="button" onClick={() => setImageMode('url')} className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${imageMode === 'url' ? 'bg-surface shadow-sm text-ink' : 'text-ink-subtle hover:text-ink'}`}>
                                            <Link size={12} /> URL
                                        </button>
                                    </div>
                                </div>
                                {imageMode === 'upload' ? (
                                    <div>
                                        <input
                                            ref={imageInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="sr-only"
                                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMenuImage(f) }}
                                        />
                                        {itemFormData.image_url ? (
                                            <div className="relative rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted shadow-inner group/img" style={{ height: 160 }}>
                                                <Image src={itemFormData.image_url} alt="Preview" fill sizes="400px" className="object-cover" />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                                                    <button type="button" onClick={() => imageInputRef.current?.click()} className="bg-surface text-ink text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
                                                        <Upload size={14} /> Change
                                                    </button>
                                                    <button type="button" onClick={() => setItemFormData(prev => ({ ...prev, image_url: '' }))} className="bg-danger-bg text-danger-fg text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
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
                                            value={itemFormData.image_url || ''}
                                            onChange={e => setItemFormData({ ...itemFormData, image_url: e.target.value })}
                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                            placeholder="https://example.com/image.jpg"
                                        />
                                        {itemFormData.image_url && (
                                            <div className="relative rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted shadow-inner" style={{ height: 140 }}>
                                                <Image src={itemFormData.image_url} alt="Preview" fill sizes="400px" unoptimized className="object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                            </div>
                                        )}
                                    </div>
                                )}                            </div>
                            
                            {/* Variations Section */}
                            <div className="border-t border-hairline pt-5 mt-3">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <span className="text-small font-bold text-ink block">Item Variations</span>
                                        <span className="text-xs text-ink-subtle">e.g., Small, Medium, Large sizes</span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer group">
                                        <input 
                                            type="checkbox" 
                                            className="sr-only peer" 
                                            checked={hasVariations} 
                                            onChange={e => {
                                                setHasVariations(e.target.checked)
                                                if (e.target.checked && itemVariations.length === 0) {
                                                    setItemVariations([{ name: '', price: 0, is_available: true, image_url: null }])
                                                }
                                            }} 
                                        />
                                        <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                    </label>
                                </div>

                                {hasVariations && (
                                    <div className="space-y-3 mt-4 bg-surface-muted/30 p-3.5 rounded-[var(--r-lg)] border border-hairline shadow-inner">
                                        {itemVariations.map((v, idx) => (
                                            <div key={idx} className="flex gap-3 bg-surface p-3 rounded-[var(--r-md)] border border-hairline shadow-sm hover:shadow-md transition-shadow">
                                                {/* Variation image */}
                                                <label className="relative w-16 h-16 shrink-0 rounded-[var(--r-md)] overflow-hidden border border-hairline bg-surface-muted flex items-center justify-center cursor-pointer group/var shadow-inner">
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="sr-only"
                                                        disabled={variationUploadIdx !== null}
                                                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadVariationImage(idx, f); e.target.value = '' }}
                                                    />
                                                    {variationUploadIdx === idx ? (
                                                        <Loader2 size={18} className="animate-spin text-brand-500" />
                                                    ) : v.image_url ? (
                                                        <>
                                                            <Image src={v.image_url} alt={v.name || 'Variation'} fill sizes="64px" className="object-cover" />
                                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/var:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                                                <Upload size={14} className="text-white" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-1 text-ink-subtle group-hover/var:text-brand-500 transition-colors">
                                                            <ImageIcon size={18} />
                                                            <span className="text-[10px] font-bold leading-none">Photo</span>
                                                        </div>
                                                    )}
                                                </label>

                                                {/* Variation fields */}
                                                <div className="flex-1 min-w-0 flex flex-col gap-2.5">
                                                    <input
                                                        type="text"
                                                        value={v.name}
                                                        onChange={e => {
                                                            const newVars = [...itemVariations]
                                                            newVars[idx].name = e.target.value
                                                            setItemVariations(newVars)
                                                        }}
                                                        placeholder="Variation Name (e.g. Small)"
                                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-2 border bg-surface text-ink transition-all"
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative flex-1 sm:flex-none sm:w-36">
                                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                                <span className="text-ink-subtle text-xs font-medium">$</span>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                value={v.price === 0 ? '' : v.price}
                                                                onChange={e => {
                                                                    const val = e.target.value
                                                                    if (/^\d*\.?\d*$/.test(val)) {
                                                                        const newVars = [...itemVariations]
                                                                        newVars[idx].price = val === '' ? 0 : Number(val)
                                                                        setItemVariations(newVars)
                                                                    }
                                                                }}
                                                                placeholder="Price"
                                                                className="w-full pl-6 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-2 border bg-surface text-ink transition-all tabular-nums"
                                                            />
                                                        </div>
                                                        {v.image_url && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setItemVariations(prev => prev.map((vv, i) => i === idx ? { ...vv, image_url: null } : vv))}
                                                                className="text-[11px] font-bold text-ink-subtle hover:text-danger-fg px-2 shrink-0 transition-colors"
                                                            >
                                                                Remove photo
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => setItemVariations(itemVariations.filter((_, i) => i !== idx))}
                                                            className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] shrink-0 ml-auto transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setItemVariations([...itemVariations, { name: '', price: 0, is_available: true, image_url: null }])}
                                            className="w-full py-2.5 border-2 border-dashed border-hairline text-ink-subtle hover:text-brand-500 hover:border-brand-400 hover:bg-brand-50 rounded-[var(--r-md)] text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-surface mt-2 focus-ring"
                                        >
                                            <Plus size={16} /> Add Option
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Recipe Section */}
                            <div className="border-t border-hairline pt-5 mt-3">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <span className="text-small font-bold text-ink block">Recipe (Stock Setup)</span>
                                        <span className="text-xs text-ink-subtle">Deduct stock items when this product is ordered</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setRecipe([...recipe, { ingredient_id: '', quantity_needed: 0, input_quantity: 0, input_unit: '' }])}
                                        className="flex items-center gap-1.5 text-xs font-bold text-brand-500 hover:text-brand-600 transition-colors px-2 py-1 rounded-md hover:bg-brand-50"
                                    >
                                        <Plus size={14} /> Add Ingredient
                                    </button>
                                </div>

                                {recipe.length > 0 ? (
                                    <div className="space-y-3 mt-4 bg-surface-muted/30 p-3.5 rounded-[var(--r-lg)] border border-hairline shadow-inner">
                                        {recipe.map((r, idx) => {
                                            const selectedIng = ingredients.find(ing => ing.id === r.ingredient_id)
                                            return (
                                                <div key={idx} className="flex flex-wrap gap-3 items-center bg-surface p-2.5 rounded-[var(--r-md)] border border-hairline shadow-sm hover:shadow-md transition-shadow">
                                                    <div className="flex-1 min-w-[140px]">
                                                        <select
                                                            value={r.ingredient_id}
                                                            onChange={e => handleRecipeRowChange(idx, { ingredient_id: e.target.value })}
                                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all"
                                                        >
                                                            <option value="" disabled>Select Stock Item</option>
                                                            {ingredients.map(ing => (
                                                                <option key={ing.id} value={ing.id}>{ing.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="w-20 shrink-0">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={r.input_raw ?? (r.input_quantity ? String(r.input_quantity) : '')}
                                                            onChange={e => {
                                                                const val = e.target.value
                                                                if (/^\d*\.?\d*$/.test(val)) {
                                                                    const n = val === '' || val === '.' ? 0 : Number(val)
                                                                    handleRecipeRowChange(idx, { input_raw: val, input_quantity: n })
                                                                }
                                                            }}
                                                            placeholder="Qty"
                                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all tabular-nums"
                                                        />
                                                    </div>
                                                    <div className="w-24 shrink-0">
                                                        <select
                                                            value={r.input_unit || selectedIng?.unit || 'g'}
                                                            onChange={e => handleRecipeRowChange(idx, { input_unit: e.target.value })}
                                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all"
                                                        >
                                                            {getAvailableUnits(selectedIng?.unit || 'g').map(u => (
                                                                <option key={u} value={u}>{u}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    {selectedIng && r.input_unit && r.input_unit !== selectedIng.unit && (
                                                        <span className="text-[10px] text-ink-subtle font-mono shrink-0 ml-1 bg-surface-muted px-2 py-1 rounded-md border border-hairline">
                                                            = {Number(r.quantity_needed).toFixed(3)} {selectedIng.unit}
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setRecipe(recipe.filter((_, i) => i !== idx))}
                                                        className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] ml-auto transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )
                                        })}
                                        
                                        <div className="flex justify-start mt-3 px-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowAddStockModal(true)}
                                                className="text-[11px] font-bold text-brand-500 hover:text-brand-600 hover:underline transition-colors flex items-center gap-1"
                                            >
                                                <Plus size={12} /> Create New Stock Item
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setRecipe([{ ingredient_id: '', quantity_needed: 0, input_quantity: 0, input_unit: '' }])}
                                        className="w-full py-2.5 border-2 border-dashed border-hairline text-ink-subtle hover:text-brand-500 hover:border-brand-400 hover:bg-brand-50 rounded-[var(--r-md)] text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-surface mt-2 focus-ring"
                                    >
                                        <Plus size={16} /> Add Recipe
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-4 bg-surface-muted/30 rounded-[var(--r-lg)] border border-hairline mt-4">
                                <div>
                                    <span className="text-small font-bold text-ink block">Availability</span>
                                    <span className="text-xs text-ink-subtle">Customers can order this item</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer group">
                                    <input type="checkbox" className="sr-only peer" checked={!!itemFormData.is_available} onChange={e => setItemFormData({ ...itemFormData, is_available: e.target.checked })} />
                                    <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                </label>
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3 shrink-0">
                            <button onClick={() => setIsItemModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">
                                Cancel
                            </button>
                            <button disabled={!itemFormData.name || (!hasVariations && !itemFormData.price) || !itemFormData.category_id || isSubmitting} onClick={saveItem} className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
                                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Save Item
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Translation Modal */}
            {translateTarget && (
                <TranslationModal
                    entityId={translateTarget.entityId}
                    entityType={translateTarget.entityType}
                    englishName={translateTarget.name}
                    englishDescription={translateTarget.description}
                    existingTranslations={translations}
                    onClose={() => {
                        setTranslateTarget(null)
                        // Refresh translations after save
                        getRestaurantTranslationConfig().then(({ translations: t }) => setTranslations(t))
                    }}
                />
            )}

            {/* Create Stock Modal Overlay */}
            {showAddStockModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-surface rounded-card shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-hairline w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex justify-between items-center">
                            <h3 className="text-h3 text-ink">Create New Stock Item</h3>
                            <button onClick={() => setShowAddStockModal(false)} className="text-ink-subtle hover:text-ink transition-colors focus-ring rounded-md">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Item Name *</label>
                                <input
                                    type="text"
                                    value={newStockForm.name}
                                    onChange={e => setNewStockForm({ ...newStockForm, name: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    placeholder="e.g. Tomato Sauce"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Unit *</label>
                                    <select
                                        value={newStockForm.unit}
                                        onChange={e => setNewStockForm({ ...newStockForm, unit: e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Initial Quantity *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStockForm.stock_quantity}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, stock_quantity: v })
                                        }}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                        placeholder="e.g. 50"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Cost per Unit ($) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStockForm.cost_per_unit}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, cost_per_unit: v })
                                        }}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                        placeholder="e.g. 2.50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Reorder Level</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStockForm.reorder_level}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, reorder_level: v })
                                        }}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                        placeholder="e.g. 10"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Supplier</label>
                                <input
                                    type="text"
                                    value={newStockForm.supplier}
                                    onChange={e => setNewStockForm({ ...newStockForm, supplier: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    placeholder="e.g. Wholesale Inc."
                                />
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddStockModal(false)}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!newStockForm.name.trim() || isCreatingStock}
                                onClick={handleCreateStock}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                            >
                                {isCreatingStock ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Create Stock
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
