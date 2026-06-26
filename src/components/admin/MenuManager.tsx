'use client'

import { useState, useEffect, useRef } from 'react'
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
                    variations: variationsPayload as any[] 
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50/50">
                <button
                    onClick={() => setActiveTab('items')}
                    className={`flex-1 py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'items' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                >
                    Menu Items
                </button>
                <button
                    onClick={() => setActiveTab('categories')}
                    className={`flex-1 py-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'categories' ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                >
                    Categories
                </button>
            </div>

            {/* Content Area */}
            <div className="p-6">
                {activeTab === 'categories' ? (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-semibold text-gray-800">Manage Categories</h3>
                            <button
                                onClick={() => openCategoryModal()}
                                className="flex items-center gap-2 bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
                            >
                                <Plus size={16} /> Add Category
                            </button>
                        </div>
                        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                            {categories.sort((a, b) => a.sort_order - b.sort_order).map((cat) => (
                                <li key={cat.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors bg-white">
                                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                        <GripVertical size={16} className="text-gray-300 cursor-grab shrink-0 hidden sm:block" />
                                        <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200 overflow-hidden">
                                            {cat.image_url ? (
                                                <Image src={cat.image_url} alt={cat.name} width={44} height={44} className="w-full h-full object-cover" />
                                            ) : (
                                                <ImageIcon size={18} className="text-gray-300" />
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-medium text-gray-900 flex items-center gap-2">
                                                <span className="truncate">{cat.name}</span>
                                                {!cat.is_visible && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 uppercase shrink-0">Hidden</span>}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">Sort: {cat.sort_order}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {hasNepali && (
                                            <button onClick={() => setTranslateTarget({ entityId: cat.id, entityType: 'category', name: cat.name })} className="p-2 text-gray-400 hover:text-purple-500 rounded-lg hover:bg-purple-50" title="Translate">
                                                <Globe size={16} />
                                            </button>
                                        )}
                                        <button onClick={() => openCategoryModal(cat)} className="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => deleteCategory(cat.id)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </li>
                            ))}
                            {categories.length === 0 && (
                                <li className="p-8 text-center text-gray-500 text-sm">No categories created yet.</li>
                            )}
                        </ul>
                    </div>
                ) : (
                    <div>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-semibold text-gray-800">Menu Items</h3>
                            <button
                                onClick={() => openItemModal()}
                                className="flex items-center gap-2 bg-[var(--color-primary)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-opacity-90 transition-colors"
                                disabled={categories.length === 0}
                            >
                                <Plus size={16} /> Add Item
                            </button>
                        </div>

                        {categories.length === 0 && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm mb-6 flex items-start gap-3">
                                <Tag className="shrink-0 mt-0.5 text-amber-500" size={18} />
                                <div>
                                    <p className="font-semibold">You need categories first!</p>
                                    <p className="mt-1">Please create at least one category before adding menu items.</p>
                                </div>
                            </div>
                        )}

                        {categories.length > 0 && (
                            <div className="flex flex-col sm:flex-row gap-3 mb-6 bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                                <div className="relative flex-1">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search menu items..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all bg-white"
                                    />
                                </div>
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 sm:w-48"
                                >
                                    <option value="all">All Categories</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="space-y-8">
                            {categories.filter(c => categoryFilter === 'all' || c.id === categoryFilter).map(cat => {
                                const catItems = filteredItems.filter(i => i.category_id === cat.id)
                                if (catItems.length === 0) return null

                                return (
                                    <div key={cat.id}>
                                        <h4 className="font-semibold text-gray-700 bg-gray-50/80 px-4 py-2 rounded-lg mb-3 border border-gray-100 flex items-center gap-2">
                                            <Tag size={14} className="text-[var(--color-primary)]" />
                                            {cat.name}
                                        </h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {catItems.map(item => (
                                                <div key={item.id} className="flex gap-4 p-4 border border-gray-200 rounded-xl bg-white hover:border-gray-300 transition-colors group">
                                                    <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                                                        {item.image_url ? (
                                                            <Image src={item.image_url} alt={item.name} width={64} height={64} className="w-full h-full object-cover rounded-lg" />
                                                        ) : (
                                                            <ImageIcon className="text-gray-300" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start">
                                                            <h5 className="font-semibold text-gray-900 truncate pr-2">{item.name}</h5>
                                                            {item.variations && item.variations.length > 0 ? (
                                                                <span className="font-bold text-xs text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded shrink-0">
                                                                    {item.variations.length} Options
                                                                </span>
                                                            ) : (
                                                                <span className="font-bold text-[var(--color-primary)] shrink-0">{money(item.price)}</span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-gray-500 line-clamp-2 mt-1 leading-snug">{item.description}</p>
                                                        
                                                        {item.variations && item.variations.length > 0 && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                                {item.variations.map(v => (
                                                                    <span key={v.id || v.name} className="inline-flex items-center gap-1.5 text-[10px] font-medium bg-gray-50 border border-gray-200 text-gray-600 pr-2 rounded-md overflow-hidden">
                                                                        {v.image_url ? (
                                                                            <Image src={v.image_url} alt={v.name} width={20} height={20} className="w-5 h-5 object-cover shrink-0" />
                                                                        ) : (
                                                                            <span className="pl-2" />
                                                                        )}
                                                                        <span className="py-0.5">{v.name}: <strong className="text-gray-900">{money(v.price)}</strong></span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        <div className="mt-3 flex items-center gap-2">
                                                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${item.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                {item.is_available ? 'Available' : 'Sold Out'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                                        {hasNepali && (
                                                            <button onClick={() => setTranslateTarget({ entityId: item.id, entityType: 'menu_item', name: item.name, description: item.description })} className="p-1.5 text-gray-400 hover:text-purple-500 rounded bg-gray-50 hover:bg-purple-50" title="Translate">
                                                                <Globe size={14} />
                                                            </button>
                                                        )}
                                                        <button onClick={() => openItemModal(item)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded bg-gray-50 hover:bg-blue-50">
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button onClick={() => deleteItem(item.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded bg-gray-50 hover:bg-red-50">
                                                            <Trash2 size={14} />
                                                        </button>
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
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="font-semibold text-gray-900">{editingCategory ? 'Edit Category' : 'New Category'}</h3>
                            <button onClick={() => setIsCategoryModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    type="text"
                                    value={categoryName}
                                    onChange={e => setCategoryName(e.target.value)}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Starters"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Category Image (Optional)</label>
                                {categoryImageUrl ? (
                                    <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50 h-28 group/cat">
                                        <Image src={categoryImageUrl} alt="Category" fill sizes="400px" className="object-cover" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/cat:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <label className="bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1 cursor-pointer">
                                                <input type="file" accept="image/*" className="hidden" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                                <Upload size={12} /> Change
                                            </label>
                                            <button type="button" onClick={() => setCategoryImageUrl('')} className="bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1">
                                                <X size={12} /> Remove
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="w-full border-2 border-dashed border-gray-200 rounded-xl h-28 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors cursor-pointer">
                                        <input type="file" accept="image/*" className="hidden" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                        {categoryImageUploading ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                                        <span className="text-xs font-medium">{categoryImageUploading ? 'Uploading…' : 'Click to upload photo'}</span>
                                    </label>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={categorySort}
                                        onChange={e => { const v = e.target.value; if (/^\d*$/.test(v)) setCategorySort(Number(v)) }}
                                        placeholder="e.g. 1"
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    />
                                </div>
                                <div className="flex items-center pt-6">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={categoryVisible}
                                            onChange={e => setCategoryVisible(e.target.checked)}
                                            className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)] w-4 h-4"
                                        />
                                        <span className="text-sm font-medium text-gray-700">Visible to Customers</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button onClick={() => setIsCategoryModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                                Cancel
                            </button>
                            <button disabled={!categoryName.trim() || isSubmitting} onClick={saveCategory} className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save Category
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Item Modal Overlay */}
            {isItemModalOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
                            <h3 className="font-semibold text-gray-900">{editingItem ? 'Edit Item' : 'New Menu Item'}</h3>
                            <button onClick={() => setIsItemModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                                <input
                                    type="text"
                                    value={itemFormData.name ?? ''}
                                    onChange={e => setItemFormData({ ...itemFormData, name: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Classic Cheeseburger"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500 sm:text-sm">$</span>
                                        </div>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            disabled={hasVariations}
                                            value={hasVariations ? 'Variations' : (itemFormData.price ?? '')}
                                            onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setItemFormData({ ...itemFormData, price: v === '' ? undefined : Number(v) }) }}
                                            placeholder={hasVariations ? 'Set in variations' : 'e.g. 12.99'}
                                            className="w-full pl-7 border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-400"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                                    <select
                                        value={itemFormData.category_id || ''}
                                        onChange={e => setItemFormData({ ...itemFormData, category_id: e.target.value })}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    >
                                        <option value="" disabled>Select category</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea
                                    value={itemFormData.description || ''}
                                    onChange={e => setItemFormData({ ...itemFormData, description: e.target.value })}
                                    rows={3}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border resize-none"
                                    placeholder="Delicious beef patty with cheddar..."
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="block text-sm font-medium text-gray-700">Image (Optional)</label>
                                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                                        <button type="button" onClick={() => setImageMode('upload')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${imageMode === 'upload' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                            <Upload size={11} /> Upload
                                        </button>
                                        <button type="button" onClick={() => setImageMode('url')} className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${imageMode === 'url' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                                            <Link size={11} /> URL
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
                                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMenuImage(f) }}
                                        />
                                        {itemFormData.image_url ? (
                                            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50" style={{ height: 140 }}>
                                                <Image src={itemFormData.image_url} alt="Preview" fill sizes="400px" className="object-cover" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                                    <button type="button" onClick={() => imageInputRef.current?.click()} className="bg-white text-gray-900 text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1">
                                                        <Upload size={12} /> Change
                                                    </button>
                                                    <button type="button" onClick={() => setItemFormData(prev => ({ ...prev, image_url: '' }))} className="bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow flex items-center gap-1">
                                                        <X size={12} /> Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading} className="w-full border-2 border-dashed border-gray-200 rounded-xl h-28 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-50">
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
                                            value={itemFormData.image_url || ''}
                                            onChange={e => setItemFormData({ ...itemFormData, image_url: e.target.value })}
                                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                            placeholder="https://example.com/image.jpg"
                                        />
                                        {itemFormData.image_url && (
                                            <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50" style={{ height: 120 }}>
                                                <Image src={itemFormData.image_url} alt="Preview" fill sizes="400px" unoptimized className="object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                                            </div>
                                        )}
                                    </div>
                                )}                            </div>
                            
                            {/* Variations Section */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <span className="text-sm font-medium text-gray-900 block">Item Variations</span>
                                        <span className="text-xs text-gray-500">e.g., Small, Medium, Large sizes</span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
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
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
                                    </label>
                                </div>

                                {hasVariations && (
                                    <div className="space-y-2 mt-3 bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                                        {itemVariations.map((v, idx) => (
                                            <div key={idx} className="flex gap-3 bg-white p-2.5 rounded-xl border border-gray-200">
                                                {/* Variation image */}
                                                <label className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center cursor-pointer group/var">
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        disabled={variationUploadIdx !== null}
                                                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadVariationImage(idx, f); e.target.value = '' }}
                                                    />
                                                    {variationUploadIdx === idx ? (
                                                        <Loader2 size={18} className="animate-spin text-gray-400" />
                                                    ) : v.image_url ? (
                                                        <>
                                                            <Image src={v.image_url} alt={v.name || 'Variation'} fill sizes="64px" className="object-cover" />
                                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/var:opacity-100 transition-opacity flex items-center justify-center">
                                                                <Upload size={14} className="text-white" />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-0.5 text-gray-400 group-hover/var:text-[var(--color-primary)] transition-colors">
                                                            <ImageIcon size={16} />
                                                            <span className="text-[9px] font-medium leading-none">Photo</span>
                                                        </div>
                                                    )}
                                                </label>

                                                {/* Variation fields */}
                                                <div className="flex-1 min-w-0 flex flex-col gap-2">
                                                    <input
                                                        type="text"
                                                        value={v.name}
                                                        onChange={e => {
                                                            const newVars = [...itemVariations]
                                                            newVars[idx].name = e.target.value
                                                            setItemVariations(newVars)
                                                        }}
                                                        placeholder="Variation Name (e.g. Small)"
                                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2 border bg-white"
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative flex-1 sm:flex-none sm:w-32">
                                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                                <span className="text-gray-500 text-xs">$</span>
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
                                                                className="w-full pl-6 border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2 border bg-white"
                                                            />
                                                        </div>
                                                        {v.image_url && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setItemVariations(prev => prev.map((vv, i) => i === idx ? { ...vv, image_url: null } : vv))}
                                                                className="text-[11px] font-medium text-gray-400 hover:text-red-500 px-1 shrink-0"
                                                            >
                                                                Remove photo
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => setItemVariations(itemVariations.filter((_, i) => i !== idx))}
                                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg shrink-0 ml-auto"
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
                                            className="w-full py-2 border border-dashed border-gray-200 text-gray-500 hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors bg-white mt-1"
                                        >
                                            <Plus size={14} /> Add Option
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Recipe Section */}
                            <div className="border-t border-gray-100 pt-4 mt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <span className="text-sm font-medium text-gray-900 block">Recipe (Stock Setup)</span>
                                        <span className="text-xs text-gray-500">Deduct stock items when this product is ordered</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setRecipe([...recipe, { ingredient_id: '', quantity_needed: 0, input_quantity: 0, input_unit: '' }])}
                                        className="flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:opacity-80"
                                    >
                                        <Plus size={14} /> Add Ingredient
                                    </button>
                                </div>

                                {recipe.length > 0 ? (
                                    <div className="space-y-2 mt-3 bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                                        {recipe.map((r, idx) => {
                                            const selectedIng = ingredients.find(ing => ing.id === r.ingredient_id)
                                            return (
                                                <div key={idx} className="flex flex-wrap gap-2 items-center bg-white p-2 rounded-lg border border-gray-200">
                                                    <div className="flex-1 min-w-[120px]">
                                                        <select
                                                            value={r.ingredient_id}
                                                            onChange={e => handleRecipeRowChange(idx, { ingredient_id: e.target.value })}
                                                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] text-xs p-2 border bg-white"
                                                        >
                                                            <option value="" disabled>Select Stock Item</option>
                                                            {ingredients.map(ing => (
                                                                <option key={ing.id} value={ing.id}>{ing.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="w-16 shrink-0">
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
                                                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] text-xs p-2 border bg-white"
                                                        />
                                                    </div>
                                                    <div className="w-20 shrink-0">
                                                        <select
                                                            value={r.input_unit || selectedIng?.unit || 'g'}
                                                            onChange={e => handleRecipeRowChange(idx, { input_unit: e.target.value })}
                                                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] text-xs p-2 border bg-white"
                                                        >
                                                            {getAvailableUnits(selectedIng?.unit || 'g').map(u => (
                                                                <option key={u} value={u}>{u}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    {selectedIng && r.input_unit && r.input_unit !== selectedIng.unit && (
                                                        <span className="text-[10px] text-gray-400 font-mono shrink-0 ml-1">
                                                            (= {Number(r.quantity_needed).toFixed(3)} {selectedIng.unit})
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setRecipe(recipe.filter((_, i) => i !== idx))}
                                                        className="p-1.5 text-gray-400 hover:text-red-500 rounded ml-auto"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            )
                                        })}
                                        
                                        <div className="flex justify-start mt-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowAddStockModal(true)}
                                                className="text-[11px] font-semibold text-purple-600 hover:underline"
                                            >
                                                + Create New Stock Item
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setRecipe([{ ingredient_id: '', quantity_needed: 0, input_quantity: 0, input_unit: '' }])}
                                        className="w-full py-2 border border-dashed border-gray-200 text-gray-500 hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors bg-white mt-1"
                                    >
                                        <Plus size={14} /> Add Recipe
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-100 mt-2">
                                <div>
                                    <span className="text-sm font-medium text-gray-900 block">Availability</span>
                                    <span className="text-xs text-gray-500">Customers can order this item</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={!!itemFormData.is_available} onChange={e => setItemFormData({ ...itemFormData, is_available: e.target.checked })} />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--color-primary)]"></div>
                                </label>
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3 shrink-0">
                            <button onClick={() => setIsItemModalOpen(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                                Cancel
                            </button>
                            <button disabled={!itemFormData.name || (!hasVariations && !itemFormData.price) || !itemFormData.category_id || isSubmitting} onClick={saveItem} className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save Item
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
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="font-semibold text-gray-900">Create New Stock Item</h3>
                            <button onClick={() => setShowAddStockModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                                <input
                                    type="text"
                                    value={newStockForm.name}
                                    onChange={e => setNewStockForm({ ...newStockForm, name: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Tomato Sauce"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                                    <select
                                        value={newStockForm.unit}
                                        onChange={e => setNewStockForm({ ...newStockForm, unit: e.target.value })}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border bg-white"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Initial Quantity *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStockForm.stock_quantity}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, stock_quantity: v })
                                        }}
                                        className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                        placeholder="e.g. 50"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost per Unit ($) *</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={newStockForm.cost_per_unit}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, cost_per_unit: v })
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
                                        value={newStockForm.reorder_level}
                                        onChange={e => {
                                            const v = e.target.value
                                            if (/^\d*\.?\d*$/.test(v)) setNewStockForm({ ...newStockForm, reorder_level: v })
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
                                    value={newStockForm.supplier}
                                    onChange={e => setNewStockForm({ ...newStockForm, supplier: e.target.value })}
                                    className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border"
                                    placeholder="e.g. Wholesale Inc."
                                />
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddStockModal(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                disabled={!newStockForm.name.trim() || isCreatingStock}
                                onClick={handleCreateStock}
                                className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                            >
                                {isCreatingStock ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Create Stock
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
