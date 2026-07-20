'use client'

import React, { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { NepaliInput } from '@/components/ui/NepaliInput'
import Modal from '@/components/ui/Modal'
import Image from 'next/image'
import { Plus, Edit2, Trash2, GripVertical, Check, X, Tag, Loader2, Image as ImageIcon, Globe, Upload, Link, Search } from 'lucide-react'
import type { MenuCategory, MenuItem, Ingredient, StationKind } from '@/types/database'
import { STATIONS, STATION_META, resolveStation } from '@/lib/stations'
import { createClient } from '@/lib/supabase/client'
import { useFileDrop } from '@/lib/hooks/useFileDrop'
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
import { fetchMenuData } from '@/lib/swr-fetchers'
import Select from '@/components/ui/Select'

type TranslationRow = { language_code: string; entity_type: string; entity_id: string; translated_text: string }

// Monotonic counter for unique upload paths. Avoids crypto.randomUUID (unavailable
// on non-HTTPS LAN origins) and Date.now/Math.random (flagged by react-hooks/purity).
let uploadSeq = 0

// The limit the upload zones promise the user ("up to 5MB").
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Half Plate is stored as a paired variation rather than a dedicated DB column.
// A plain item's pair is named "Full" / "Half"; a named variation's pair is
// "<name>" / "<name> (Half)" so multiple half-enabled variations stay unique.
const round2 = (n: number) => Math.round(n * 100) / 100
const halfTwinName = (baseName: string) => (baseName.trim() === 'Full' ? 'Half' : `${baseName} (Half)`)
const isHalfTwinName = (name: string) => name === 'Half' || name.endsWith(' (Half)')

// The file picker filters by accept="image/*", but a drag-and-drop doesn't —
// anything the OS lets you drag lands here, so the check has to happen in code.
// Returns a message to show the user, or null when the file is fine.
function imageFileError(file: File): string | null {
    if (!file.type.startsWith('image/')) return 'That file isn’t an image. Try a JPG, PNG, or WEBP.'
    if (file.size > MAX_IMAGE_BYTES) {
        return `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`
    }
    return null
}

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
    const { data: menuData = { categories: initialCategories, items: initialItems, ingredients: initialIngredients }, mutate } = useSWR<{
        categories: MenuCategory[];
        items: MenuItem[];
        ingredients: Ingredient[];
    }>(
        ['menu', restaurantId], 
        () => fetchMenuData(restaurantId), 
        { fallbackData: { categories: initialCategories, items: initialItems, ingredients: initialIngredients } }
    )
    const { categories, items, ingredients } = menuData
    const money = useCurrency()
    const [recipe, setRecipe] = useState<{
        ingredient_id: string;
        quantity_needed: number;
        input_quantity?: number;
        input_unit?: string;
        input_raw?: string;
        variation_id?: string | null;
        variation_name?: string | null;
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
    const [categoryStation, setCategoryStation] = useState<StationKind>('kitchen')
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
    // Half Plate for a plain (no custom variations) item: a Full/Half pair is
    // synthesized behind the scenes at save time, without exposing the
    // Item Variations editor. Custom variations (Small/Large, Chicken/Veg/...)
    // instead get a per-row half toggle further down, directly in itemVariations.
    const [simpleHalfPlateOn, setSimpleHalfPlateOn] = useState(false)

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
            setCategoryStation(cat.station ?? 'kitchen')
            setCategoryImageUrl(cat.image_url ?? '')
        } else {
            setEditingCategory(null)
            setCategoryName('')
            setCategorySort(categories.length * 10)
            setCategoryVisible(true)
            setCategoryStation('kitchen')
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
                station: categoryStation,
                image_url: categoryImageUrl || null
            })
            if (res.success) {
                mutate()
                toast.success('Category updated')
                setIsCategoryModalOpen(false)
            } else {
                toast.error(res.error || 'Failed to update category')
            }
        } else {
            const res = await addCategoryAction(restaurantId, categoryName, categorySort, categoryVisible, categoryImageUrl || null, categoryStation)
            if (res.data) {
                mutate()
                toast.success('Category created')
                setIsCategoryModalOpen(false)
            } else {
                toast.error(res.error || 'Failed to create category')
            }
        }

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
            mutate()
            toast.success('Category deleted')
        } else {
            toast.error(res.error || 'Failed to delete category')
        }
    }

    // --- Image Upload Handlers ---
    const uploadToStorage = async (file: File): Promise<string | null> => {
        const invalid = imageFileError(file)
        if (invalid) throw new Error(invalid)
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

    // Drop targets for the two full-size image zones. The variation thumbnails
    // are 64px squares — too small to be a sensible drop target, so they stay
    // click-to-browse.
    const itemImageDrop = useFileDrop(uploadMenuImage, { disabled: imageUploading })
    const categoryImageDrop = useFileDrop(uploadCategoryImage, { disabled: categoryImageUploading })

    // --- Item Handlers ---
    const openItemModal = async (item?: MenuItem) => {
        if (item) {
            setEditingItem(item)
            const variations = item.variations ? item.variations.map(v => ({ ...v, is_available: v.is_available ?? true })) : []
            // A plain item's synthesized Half Plate pair is exactly one "Full" +
            // one "Half" row — collapse it back to the simple, hidden-toggle form.
            const simplePair = variations.length === 2
                && variations.some(v => v.name.trim() === 'Full')
                && variations.some(v => v.name.trim() === 'Half')
            if (simplePair) {
                const full = variations.find(v => v.name.trim() === 'Full')!
                setItemFormData({ ...item, price: full.price })
                setHasVariations(false)
                setItemVariations([])
                setSimpleHalfPlateOn(true)
            } else {
                setItemFormData({ ...item })
                setHasVariations(variations.length > 0)
                setItemVariations(variations)
                setSimpleHalfPlateOn(false)
            }
            const res = await getItemRecipeAction(item.id)
            if (res.data) {
                setRecipe(res.data.map(r => {
                    const ing = ingredients.find(i => i.id === r.ingredient_id)
                    const matchedVar = item.variations?.find((v: any) => v.id === r.menu_item_variation_id)
                    return {
                        ingredient_id: r.ingredient_id,
                        quantity_needed: r.quantity_needed,
                        input_quantity: r.quantity_needed,
                        input_unit: ing?.unit || 'g',
                        variation_id: r.menu_item_variation_id || null,
                        variation_name: matchedVar?.name || null
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
            setSimpleHalfPlateOn(false)
        }
        setIsItemModalOpen(true)
    }

    // Turning custom Item Variations on/off. If a simple Half Plate pair was
    // active, it's carried into the now-visible editor as starter rows instead
    // of being silently dropped.
    const toggleItemVariations = (turningOn: boolean) => {
        setHasVariations(turningOn)
        if (turningOn) {
            if (simpleHalfPlateOn) {
                const fullPrice = Number(itemFormData.price || 0)
                setItemVariations([
                    { name: 'Full', price: fullPrice, is_available: true, image_url: null },
                    { name: 'Half', price: round2(fullPrice / 2), is_available: true, image_url: null }
                ])
                setSimpleHalfPlateOn(false)
            } else if (itemVariations.length === 0) {
                setItemVariations([{ name: '', price: 0, is_available: true, image_url: null }])
            }
        } else {
            setItemVariations([])
            setSimpleHalfPlateOn(false)
        }
    }

    // Per-variation Half Plate: adds/removes a paired "<name> (Half)" row
    // priced at 50% of that specific variation.
    const toggleVariationHalfPlate = (baseIdx: number, enabled: boolean) => {
        setItemVariations(prev => {
            const base = prev[baseIdx]
            const twinName = halfTwinName(base.name)
            if (enabled) {
                if (prev.some(v => v.name === twinName)) return prev
                return [...prev, { name: twinName, price: round2(base.price / 2), is_available: true, image_url: null }]
            }
            return prev.filter(v => v.name !== twinName)
        })
    }

    const saveItem = async () => {
        const effectiveHasVariations = hasVariations || simpleHalfPlateOn
        const basePrice = effectiveHasVariations ? 0 : Number(itemFormData.price || 0)

        if (!itemFormData.name || (!effectiveHasVariations && !itemFormData.price) || !itemFormData.category_id) return

        let variationsPayload: typeof itemVariations = []

        if (hasVariations) {
            if (itemVariations.length === 0) {
                toast.error('Please add at least one variation option')
                return
            }
            if (itemVariations.some(v => !v.name.trim() || isNaN(v.price) || v.price < 0)) {
                toast.error('All variations must have a name and a valid price')
                return
            }
            const normalizedNames = itemVariations.map(v => v.name.toLowerCase().trim())
            if (new Set(normalizedNames).size !== normalizedNames.length) {
                toast.error('Variation names must be unique (recipes are matched by name)')
                return
            }
            variationsPayload = itemVariations
        } else if (simpleHalfPlateOn) {
            const fullPrice = Number(itemFormData.price || 0)
            variationsPayload = [
                { name: 'Full', price: fullPrice, is_available: true, image_url: null },
                { name: 'Half', price: round2(fullPrice / 2), is_available: true, image_url: null }
            ]
        }

        setIsSubmitting(true)

        const payload = {
            ...itemFormData,
            restaurant_id: restaurantId,
            price: basePrice
        }

        const validRecipe = recipe.filter(r => r.ingredient_id && Number(r.quantity_needed) > 0)
            .map(r => ({ ...r, quantity_needed: Number(r.quantity_needed) }))

        if (editingItem) {
            const res = await updateItemAction(editingItem.id, payload, variationsPayload, validRecipe)
            if (res.success) {
                mutate()
                toast.success('Item updated')
                setIsItemModalOpen(false)
            } else {
                toast.error(res.error || 'Failed to update item')
            }
        } else {
            const res = await addItemAction(payload, variationsPayload, validRecipe)
            if (res.data) {
                mutate()
                toast.success('Item added')
                setIsItemModalOpen(false)
            } else {
                toast.error(res.error || 'Failed to add item')
            }
        }

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
            mutate()
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
        fields: { 
            ingredient_id?: string; 
            input_quantity?: number; 
            input_unit?: string; 
            input_raw?: string;
            variation_id?: string | null;
            variation_name?: string | null;
        }
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
                mutate()
                toast.success('Stock item created!')
                const created = res.data
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
                                            <div className="font-bold text-ink text-base flex items-center gap-2 min-w-0">
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
                                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center shadow-sm mb-4">
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
                                <Select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="rounded-[var(--r-lg)] border border-transparent hover:border-hairline bg-surface-muted px-4 py-2.5 text-sm font-medium text-ink outline-none focus:bg-surface focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:w-56 transition-all"
                                >
                                    <option value="all">All Categories</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </Select>
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
                                                        <div className="flex justify-between items-start gap-2 min-w-0">
                                                            <h5 className="font-bold text-ink text-base truncate leading-tight min-w-0 flex-1">{item.name}</h5>
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
                                                            <span className="flex items-center gap-1.5">
                                                            {resolveStation(item.station, categories.find(c => c.id === item.category_id)?.station) === 'bar' && (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm text-white" style={{ background: STATION_META.bar.accent }} title="Sent to the bar">
                                                                    <STATION_META.bar.icon size={11} /> Bar
                                                                </span>
                                                            )}
                                                            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm ${item.is_available ? 'bg-success-bg text-success-fg' : 'bg-danger-bg text-danger-fg'}`}>
                                                                {item.is_available ? 'Available' : 'Sold Out'}
                                                            </span>
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
                <Modal open onClose={() => setIsCategoryModalOpen(false)} size="md" ariaLabel={editingCategory ? 'Edit Category' : 'New Category'}>
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
                                    <div
                                        {...categoryImageDrop.dropProps}
                                        className={`relative rounded-[var(--r-md)] overflow-hidden bg-surface-muted h-32 group/cat shadow-inner border transition-shadow ${categoryImageDrop.isOver ? 'border-brand-500 ring-4 ring-brand-500/20' : 'border-hairline'}`}
                                    >
                                        <Image src={categoryImageUrl} alt="Category" fill sizes="400px" className="object-cover" />
                                        {categoryImageDrop.isOver ? (
                                            <div className="absolute inset-0 bg-brand-500/80 backdrop-blur-sm flex items-center justify-center gap-2 text-white text-xs font-bold pointer-events-none">
                                                <Upload size={14} /> Drop to replace
                                            </div>
                                        ) : (
                                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/cat:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                                                <label className="bg-surface text-ink text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 cursor-pointer hover:-translate-y-0.5">
                                                    <input type="file" accept="image/*" className="sr-only" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                                    <Upload size={14} /> Change
                                                </label>
                                                <button type="button" onClick={() => setCategoryImageUrl('')} className="bg-danger-bg text-danger-fg text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 hover:-translate-y-0.5">
                                                    <X size={14} /> Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <label
                                        {...categoryImageDrop.dropProps}
                                        className={`w-full border-2 border-dashed rounded-[var(--r-md)] h-32 flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer ${categoryImageDrop.isOver ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-hairline text-ink-subtle hover:border-brand-400 hover:text-brand-500 hover:bg-brand-50'}`}
                                    >
                                        <input type="file" accept="image/*" className="sr-only" disabled={categoryImageUploading} onChange={e => { const f = e.target.files?.[0]; if (f) uploadCategoryImage(f); e.target.value = '' }} />
                                        {categoryImageUploading ? <Loader2 size={24} className="animate-spin" /> : <ImageIcon size={24} />}
                                        <span className="text-xs font-bold">
                                            {categoryImageUploading ? 'Uploading…' : categoryImageDrop.isOver ? 'Drop to upload' : 'Drag a photo here, or click to browse'}
                                        </span>
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
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Prepared at</label>
                                <p className="text-xs text-ink-subtle mb-2">Sends these items&apos; tickets to the kitchen or the bar. Individual items can override this.</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {STATIONS.map(s => {
                                        const sm = STATION_META[s]
                                        const Icon = sm.icon
                                        const active = categoryStation === s
                                        return (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => setCategoryStation(s)}
                                                className={`flex items-center justify-center gap-2 py-2.5 rounded-[var(--r-md)] border-2 text-sm font-bold transition-all ${active ? 'text-white shadow-sm' : 'text-ink-subtle bg-surface border-hairline hover:border-hairline-strong'}`}
                                                style={active ? { background: sm.accent, borderColor: sm.accent } : undefined}
                                            >
                                                <Icon size={16} /> {sm.label}
                                            </button>
                                        )
                                    })}
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
                </Modal>
            )}

            {/* Item Modal Overlay */}
            {isItemModalOpen && (
                <Modal open onClose={() => setIsItemModalOpen(false)} size="lg" ariaLabel={editingItem ? 'Edit Item' : 'New Menu Item'} className="flex flex-col overflow-hidden max-h-[90vh]">
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
                                            <span className="text-ink-subtle font-medium sm:text-sm">Rs.</span>
                                        </div>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            disabled={hasVariations}
                                            value={hasVariations ? 'Variations' : (itemFormData.price ?? '')}
                                            onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setItemFormData({ ...itemFormData, price: v === '' ? undefined : Number(v) }) }}
                                            placeholder={hasVariations ? 'Set in variations' : 'e.g. 12.99'}
                                            className="w-full pl-10 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all disabled:bg-surface-muted disabled:text-ink-subtle disabled:opacity-70 tabular-nums"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-small font-bold text-ink mb-1.5">Category *</label>
                                    <Select
                                        value={itemFormData.category_id || ''}
                                        onChange={e => setItemFormData({ ...itemFormData, category_id: e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        <option value="" disabled>Select category</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </Select>
                                </div>
                            </div>
                            {!hasVariations && (
                                <div className="flex items-center justify-between bg-brand-50 border border-brand-100 rounded-[var(--r-md)] px-3.5 py-3">
                                    <div>
                                        <span className="text-small font-bold text-ink block">Half Plate</span>
                                        <span className="text-xs text-ink-subtle">
                                            {simpleHalfPlateOn
                                                ? `Also sold as Half at ${money(round2(Number(itemFormData.price || 0) / 2))}`
                                                : 'Also sell a Half Plate at 50% of the price above.'}
                                        </span>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer group shrink-0 ml-3">
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={simpleHalfPlateOn}
                                            onChange={e => setSimpleHalfPlateOn(e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                    </label>
                                </div>
                            )}
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
                                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadMenuImage(f); e.target.value = '' }}
                                        />
                                        {itemFormData.image_url ? (
                                            <div
                                                {...itemImageDrop.dropProps}
                                                className={`relative rounded-[var(--r-md)] overflow-hidden bg-surface-muted shadow-inner group/img border transition-shadow ${itemImageDrop.isOver ? 'border-brand-500 ring-4 ring-brand-500/20' : 'border-hairline'}`}
                                                style={{ height: 160 }}
                                            >
                                                <Image src={itemFormData.image_url} alt="Preview" fill sizes="400px" className="object-cover" />
                                                {itemImageDrop.isOver ? (
                                                    <div className="absolute inset-0 bg-brand-500/80 backdrop-blur-sm flex items-center justify-center gap-2 text-white text-sm font-bold pointer-events-none">
                                                        <Upload size={16} /> Drop to replace
                                                    </div>
                                                ) : (
                                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-sm">
                                                        <button type="button" onClick={() => imageInputRef.current?.click()} className="bg-surface text-ink text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
                                                            <Upload size={14} /> Change
                                                        </button>
                                                        <button type="button" onClick={() => setItemFormData(prev => ({ ...prev, image_url: '' }))} className="bg-danger-bg text-danger-fg text-xs font-bold px-4 py-2 rounded-[var(--r-md)] shadow-sm flex items-center gap-1.5 hover:-translate-y-0.5 transition-transform">
                                                            <X size={14} /> Remove
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => imageInputRef.current?.click()}
                                                disabled={imageUploading}
                                                {...itemImageDrop.dropProps}
                                                className={`w-full border-2 border-dashed rounded-[var(--r-md)] h-36 flex flex-col items-center justify-center gap-3 transition-colors disabled:opacity-50 focus-ring ${itemImageDrop.isOver ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-hairline text-ink-subtle hover:border-brand-400 hover:text-brand-500 hover:bg-brand-50'}`}
                                            >
                                                {imageUploading ? <Loader2 size={28} className="animate-spin" /> : <ImageIcon size={28} />}
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className="text-sm font-bold">
                                                        {imageUploading ? 'Uploading…' : itemImageDrop.isOver ? 'Drop to upload' : 'Drag a photo here, or click to browse'}
                                                    </span>
                                                    {!imageUploading && !itemImageDrop.isOver && <span className="text-xs text-ink-subtle">JPG, PNG, WEBP up to 5MB</span>}
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
                                            onChange={e => toggleItemVariations(e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                    </label>
                                </div>

                                {hasVariations && (
                                    <div className="space-y-3 mt-4 bg-surface-muted/30 p-3.5 rounded-[var(--r-lg)] border border-hairline shadow-inner">
                                        {itemVariations.map((v, idx) => {
                                            if (isHalfTwinName(v.name)) return null // rendered inline under its base row below
                                            const twinName = halfTwinName(v.name)
                                            const twinIdx = itemVariations.findIndex((vv, i) => i !== idx && vv.name === twinName)
                                            const twin = twinIdx !== -1 ? itemVariations[twinIdx] : null
                                            return (
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
                                                            const newName = e.target.value
                                                            setItemVariations(prev => {
                                                                const next = [...prev]
                                                                const oldName = next[idx].name
                                                                next[idx] = { ...next[idx], name: newName }
                                                                const oldTwinName = halfTwinName(oldName)
                                                                const oldTwinIdx = next.findIndex((vv, i) => i !== idx && vv.name === oldTwinName)
                                                                if (oldTwinIdx !== -1) next[oldTwinIdx] = { ...next[oldTwinIdx], name: halfTwinName(newName) }
                                                                return next
                                                            })
                                                        }}
                                                        placeholder="Variation Name (e.g. Small)"
                                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-2 border bg-surface text-ink transition-all"
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative flex-1 sm:flex-none sm:w-36">
                                                            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                                                                <span className="text-ink-subtle text-xs font-medium">Rs.</span>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                inputMode="decimal"
                                                                value={v.price === 0 ? '' : v.price}
                                                                onChange={e => {
                                                                    const val = e.target.value
                                                                    if (/^\d*\.?\d*$/.test(val)) {
                                                                        const newPrice = val === '' ? 0 : Number(val)
                                                                        setItemVariations(prev => {
                                                                            const next = [...prev]
                                                                            const name = next[idx].name
                                                                            next[idx] = { ...next[idx], price: newPrice }
                                                                            const tIdx = next.findIndex((vv, i) => i !== idx && vv.name === halfTwinName(name))
                                                                            if (tIdx !== -1) next[tIdx] = { ...next[tIdx], price: round2(newPrice / 2) }
                                                                            return next
                                                                        })
                                                                    }
                                                                }}
                                                                placeholder="Price"
                                                                className="w-full pl-9 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-2 border bg-surface text-ink transition-all tabular-nums"
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
                                                            onClick={() => {
                                                                // Removing a base variation also drops its auto-generated
                                                                // "(Half)" twin, so half-plate pricing never orphans.
                                                                const removedNames = [v.name.toLowerCase().trim(), twinName.toLowerCase().trim()]
                                                                const removedIds = itemVariations.filter(vv => removedNames.includes(vv.name.toLowerCase().trim())).map(vv => vv.id)
                                                                setItemVariations(prev => prev.filter(vv => !removedNames.includes(vv.name.toLowerCase().trim())))
                                                                // Drop any recipe rows scoped to this variation — otherwise they'd
                                                                // silently reattach to the whole item on save.
                                                                setRecipe(prev => prev.filter(r =>
                                                                    !(r.variation_id && removedIds.includes(r.variation_id)) &&
                                                                    !(r.variation_name && removedNames.includes(r.variation_name.toLowerCase().trim()))
                                                                ))
                                                            }}
                                                            className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] shrink-0 ml-auto transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                    <label className={`flex items-center gap-2 pt-1 ${!v.name.trim() ? 'opacity-50 pointer-events-none' : ''}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={!!twin}
                                                            disabled={!v.name.trim()}
                                                            onChange={e => toggleVariationHalfPlate(idx, e.target.checked)}
                                                            className="rounded border-hairline text-brand-500 focus:ring-brand-500/20 w-4 h-4 bg-surface transition-colors"
                                                        />
                                                        <span className="text-xs font-bold text-ink-subtle">
                                                            Half Plate{twin ? ` — ${money(twin.price)}` : ''}
                                                        </span>
                                                    </label>
                                                </div>
                                            </div>
                                            )
                                        })}
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
                                                        <Select
                                                            value={r.ingredient_id}
                                                            onChange={e => handleRecipeRowChange(idx, { ingredient_id: e.target.value })}
                                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all"
                                                        >
                                                            <option value="" disabled>Select Stock Item</option>
                                                            {ingredients.map(ing => (
                                                                <option key={ing.id} value={ing.id}>{ing.name}</option>
                                                            ))}
                                                        </Select>
                                                    </div>
                                                    {hasVariations && (
                                                         <div className="w-40 shrink-0">
                                                             <Select
                                                                 value={r.variation_id || r.variation_name || ''}
                                                                 onChange={e => {
                                                                     const val = e.target.value
                                                                     const matched = itemVariations.find(v => v.id === val || v.name === val)
                                                                     handleRecipeRowChange(idx, {
                                                                         variation_id: matched?.id || null,
                                                                         variation_name: matched?.name || null
                                                                     })
                                                                 }}
                                                                 className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all"
                                                             >
                                                                 <option value="">Whole Product (Base)</option>
                                                                 {itemVariations.filter(v => v.name.trim() !== '').map((v, vIdx) => (
                                                                     <option key={v.id || vIdx} value={v.id || v.name}>
                                                                         {v.name}
                                                                     </option>
                                                                 ))}
                                                             </Select>
                                                         </div>
                                                     )}
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
                                                        <Select
                                                            value={r.input_unit || selectedIng?.unit || 'g'}
                                                            onChange={e => handleRecipeRowChange(idx, { input_unit: e.target.value })}
                                                            className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all"
                                                        >
                                                            {getAvailableUnits(selectedIng?.unit || 'g').map(u => (
                                                                <option key={u} value={u}>{u}</option>
                                                            ))}
                                                        </Select>
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
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setRecipe([{ ingredient_id: '', quantity_needed: 0, input_quantity: 0, input_unit: '' }])}
                                            className="w-full py-2.5 border-2 border-dashed border-hairline text-ink-subtle hover:text-brand-500 hover:border-brand-400 hover:bg-brand-50 rounded-[var(--r-md)] text-xs font-bold flex items-center justify-center gap-1.5 transition-all bg-surface mt-2 focus-ring"
                                        >
                                            <Plus size={16} /> Add Recipe
                                        </button>
                                        <div className="mt-3 bg-surface-muted/30 p-3.5 rounded-[var(--r-lg)] border border-hairline">
                                            <label className="text-xs font-bold text-ink block mb-1">Estimated Cost Price (optional)</label>
                                            <span className="text-[11px] text-ink-subtle block mb-2">No recipe means stock won&apos;t auto-deduct for this item. Enter an estimated ingredient cost so profit reports still account for it.</span>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={itemFormData.estimated_cost_price ?? ''}
                                                onChange={e => {
                                                    const val = e.target.value
                                                    if (/^\d*\.?\d*$/.test(val)) setItemFormData({ ...itemFormData, estimated_cost_price: val === '' ? null : Number(val) })
                                                }}
                                                placeholder="e.g. 45.00"
                                                className="w-full sm:w-40 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 text-xs p-2.5 border bg-surface text-ink transition-all tabular-nums"
                                            />
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center justify-between p-4 bg-surface-muted/30 rounded-[var(--r-lg)] border border-hairline mt-4">
                                <div>
                                    <span className="text-small font-bold text-ink block">Availability</span>
                                    <span className="text-xs text-ink-subtle">Customers can order this item</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer group">
                                    <input type="checkbox" className="sr-only peer" checked={!!itemFormData.is_available} onChange={e => setItemFormData({ ...itemFormData, is_available: e.target.checked })} />
                                    <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                </label>
                            </div>

                            {/* Station: null/undefined = inherit the category's; an explicit
                                value overrides it (a hot drink in the Beverages category
                                that must still be made in the kitchen). */}
                            {(() => {
                                const catStation = categories.find(c => c.id === itemFormData.category_id)?.station ?? 'kitchen'
                                const inheritLabel = STATION_META[catStation].label
                                const options: { key: 'inherit' | StationKind; label: string }[] = [
                                    { key: 'inherit', label: `Category default (${inheritLabel})` },
                                    { key: 'kitchen', label: STATION_META.kitchen.label },
                                    { key: 'bar', label: STATION_META.bar.label },
                                ]
                                const current: 'inherit' | StationKind = itemFormData.station ?? 'inherit'
                                return (
                                    <div className="mt-4">
                                        <span className="text-small font-bold text-ink block mb-1.5">Prepared at</span>
                                        <div className="grid grid-cols-3 gap-2">
                                            {options.map(opt => {
                                                const active = current === opt.key
                                                const accent = opt.key === 'inherit' ? STATION_META[catStation].accent : STATION_META[opt.key].accent
                                                return (
                                                    <button
                                                        key={opt.key}
                                                        type="button"
                                                        onClick={() => setItemFormData({ ...itemFormData, station: opt.key === 'inherit' ? null : opt.key })}
                                                        className={`py-2 px-2 rounded-[var(--r-md)] border-2 text-xs font-bold transition-all ${active ? 'text-white shadow-sm' : 'text-ink-subtle bg-surface border-hairline hover:border-hairline-strong'}`}
                                                        style={active ? { background: accent, borderColor: accent } : undefined}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/50 border-t border-hairline flex justify-end gap-3 shrink-0">
                            <button onClick={() => setIsItemModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">
                                Cancel
                            </button>
                            <button disabled={!itemFormData.name || (!hasVariations && !itemFormData.price) || !itemFormData.category_id || isSubmitting} onClick={saveItem} className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
                                {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Save Item
                            </button>
                        </div>
                </Modal>
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
                <Modal open onClose={() => setShowAddStockModal(false)} size="md" ariaLabel="Create New Stock Item">
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
                                    <Select
                                        value={newStockForm.unit}
                                        onChange={e => setNewStockForm({ ...newStockForm, unit: e.target.value })}
                                        className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all"
                                    >
                                        {['kg', 'g', 'L', 'mL', 'pcs', 'lbs', 'oz', 'cups', 'tbsp', 'tsp'].map(u => (
                                            <option key={u} value={u}>{u}</option>
                                        ))}
                                    </Select>
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
                </Modal>
            )}
        </div>
    )
}
