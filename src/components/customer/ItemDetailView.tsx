'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, Plus, Minus, X, Check } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'react-hot-toast'
import type { MenuItem, CartItemModifier } from '@/types/database'
import { useCartStore, getCartItemKey } from '@/lib/stores/cart'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { useTranslation } from '@/lib/contexts/TranslationContext'
import { useRecommendedItemIds } from '@/lib/contexts/RecommendationsContext'

interface ItemDetailViewProps {
    item: MenuItem
    comboItems?: any[]
    menuItems?: MenuItem[]
    sessionId: string | undefined
    restaurantSlug: string
    restaurantId?: string
    onClose: () => void
    initialQuantity?: number
    initialCookingRequest?: string
    initialModifiers?: CartItemModifier[]
    onSaveEdit?: (modifiers: CartItemModifier[], quantity: number, request: string) => void
    isTakeout?: boolean
}

export default function ItemDetailView({
    item,
    comboItems = [],
    menuItems = [],
    sessionId,
    restaurantSlug,
    restaurantId,
    onClose,
    initialQuantity,
    initialCookingRequest,
    initialModifiers,
    onSaveEdit,
    isTakeout = false,
}: ItemDetailViewProps) {
    const { t } = useTranslation()
    const money = useCurrency()
    const displayName = t('menu_item_name', item.id, item.name)
    const displayDesc = item.description ? t('menu_item_description', item.id, item.description) : null

    const items = useHydratedStore(useCartStore, (s) => s.items) || []
    const addItem = useCartStore((s) => s.addItem)
    const updateQuantity = useCartStore((s) => s.updateQuantity)
    const setSession = useCartStore((s) => s.setSession)

    const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({})
    const [localQty, setLocalQty] = useState(1)
    const [cookingRequest, setCookingRequest] = useState('')

    // Variation quantities: { [variationId]: quantity }
    const hasVariations = (item.variations?.length ?? 0) > 0
    const [variationQtys, setVariationQtys] = useState<Record<string, number>>({})
    const [activeVariationId, setActiveVariationId] = useState<string | null>(null)

    // Initialize modifiers, quantity, and cooking request
    useEffect(() => {
        if (initialModifiers && initialModifiers.length > 0) {
            const init: Record<string, string[]> = {}
            item.modifier_groups?.forEach((g) => {
                init[g.id] = []
            })
            initialModifiers.forEach(mod => {
                const group = item.modifier_groups?.find(g => g.modifiers?.some(m => m.id === mod.modifierId))
                if (group) {
                    init[group.id].push(mod.modifierId)
                }
            })
            setSelectedMods(init)
        } else {
            const init: Record<string, string[]> = {}
            item.modifier_groups?.forEach((g) => {
                init[g.id] = []
            })
            setSelectedMods(init)
        }
    }, [item, initialModifiers])

    useEffect(() => {
        if (initialQuantity !== undefined) {
            setLocalQty(initialQuantity)
        } else {
            setLocalQty(1)
        }
    }, [initialQuantity])

    useEffect(() => {
        if (initialCookingRequest !== undefined) {
            setCookingRequest(initialCookingRequest)
        } else {
            setCookingRequest('')
        }
    }, [initialCookingRequest])

    const hasModifiers = (item.modifier_groups?.length ?? 0) > 0

    // "Pairs well with" — only for the fresh add-to-cart flow, not the cart-edit
    // sheet (onSaveEdit), since editing an existing line isn't a discovery moment.
    const recommendedIds = useRecommendedItemIds(item.id)
    const recommendedItems = onSaveEdit ? [] : recommendedIds
        .map((id) => menuItems.find((m) => m.id === id))
        .filter((m): m is MenuItem => !!m && m.is_available)
        .slice(0, 3)

    const handleQuickAdd = (recItem: MenuItem) => {
        if (!isTakeout && !sessionId) return
        if (sessionId) {
            setSession(sessionId, restaurantSlug, restaurantId)
        }
        const cartItem = {
            menuItemId: recItem.id,
            name: recItem.name,
            price: recItem.price,
            imageUrl: recItem.image_url || undefined,
            modifiers: [],
        }
        const key = getCartItemKey(cartItem)
        const existing = items.find((i) => getCartItemKey(i) === key)
        if (existing) {
            updateQuantity(key, existing.quantity + 1)
        } else {
            addItem(cartItem)
            updateQuantity(key, 1)
        }
        toast.success(`Added ${recItem.name}`)
    }

    // Build standard CartItemModifier list from current selections
    const currentModifiers: CartItemModifier[] = []
    item.modifier_groups?.forEach((group) => {
        const selected = selectedMods[group.id] || []
        selected.forEach((modId) => {
            const mod = group.modifiers?.find((m) => m.id === modId)
            if (mod) {
                currentModifiers.push({
                    modifierId: mod.id,
                    name: mod.name,
                    priceAdjustment: mod.price_adjustment,
                })
            }
        })
    })

    const targetCartKey = getCartItemKey({ menuItemId: item.id, modifiers: currentModifiers })

    // Calculate unit price including modifiers (for non-variation items)
    const modTotal = currentModifiers.reduce((sum, mod) => sum + mod.priceAdjustment, 0)
    const unitPrice = item.price + modTotal
    const totalPrice = unitPrice * localQty

    // Calculate total for variation items
    const variationTotal = hasVariations
        ? Object.entries(variationQtys).reduce((sum, [varId, qty]) => {
            const variation = item.variations!.find(v => v.id === varId)
            return sum + (variation ? variation.price * qty : 0)
        }, 0)
        : 0
    const variationItemCount = Object.values(variationQtys).reduce((sum, q) => sum + q, 0)

    // Display price: variation total or standard total
    const displayTotal = hasVariations ? variationTotal : totalPrice
    const displayPriceRange = hasVariations && item.variations!.length > 0
        ? `${money(Math.min(...item.variations!.map(v => v.price)))} – ${money(Math.max(...item.variations!.map(v => v.price)))}`
        : money(unitPrice)

    const toggleModifier = (groupId: string, modId: string, maxSelections: number) => {
        setSelectedMods((prev) => {
            const current = prev[groupId] || []
            if (current.includes(modId)) {
                return { ...prev, [groupId]: current.filter((id) => id !== modId) }
            }
            if (current.length >= maxSelections) {
                if (maxSelections === 1) {
                    return { ...prev, [groupId]: [modId] }
                }
                return { ...prev, [groupId]: [...current.slice(0, -1), modId] }
            }
            return { ...prev, [groupId]: [...current, modId] }
        })
    }

    // Handle variation quantity changes
    const setVariationQty = (varId: string, qty: number) => {
        const nextQty = Math.max(0, Math.min(qty, 20))
        setVariationQtys(prev => {
            const next = { ...prev }
            if (nextQty === 0) {
                delete next[varId]
            } else {
                next[varId] = nextQty
            }
            
            // Safe deferred state update to sync activeVariationId without concurrent render warnings
            setTimeout(() => {
                if (nextQty === 0) {
                    setActiveVariationId(currentActive => {
                        if (currentActive === varId) {
                            const remaining = Object.keys(next)
                            return remaining.length > 0 ? remaining[0] : null
                        }
                        return currentActive
                    })
                } else {
                    setActiveVariationId(varId)
                }
            }, 0)
            
            return next
        })
    }

    const handleAction = () => {
        if (!isTakeout && !sessionId) return
        if (sessionId) {
            setSession(sessionId, restaurantSlug, restaurantId)
        }

        // Check if required modifier selections are satisfied
        for (const group of item.modifier_groups || []) {
            const selected = selectedMods[group.id] || []
            if (selected.length < group.min_selections) {
                alert(`Please select options for ${group.name}`)
                return
            }
        }

        if (onSaveEdit) {
            onSaveEdit(currentModifiers, localQty, cookingRequest)
            return
        }

        // Variation mode: add each selected variation as a separate cart line
        if (hasVariations) {
            if (variationItemCount === 0) {
                alert('Please select at least one variation')
                return
            }

            for (const [varId, qty] of Object.entries(variationQtys)) {
                if (qty <= 0) continue
                const variation = item.variations!.find(v => v.id === varId)
                if (!variation) continue

                const cartItem = {
                    menuItemId: item.id,
                    name: item.name,
                    price: variation.price,
                    imageUrl: item.image_url || undefined,
                    modifiers: currentModifiers,
                    variationId: variation.id,
                    variationName: variation.name,
                }
                const varCartKey = getCartItemKey(cartItem)
                const existing = items.find((i) => getCartItemKey(i) === varCartKey)

                if (existing) {
                    updateQuantity(varCartKey, existing.quantity + qty)
                } else {
                    addItem(cartItem)
                    updateQuantity(varCartKey, qty)
                }

                if (cookingRequest.trim()) {
                    useCartStore.getState().updateSpecialRequest(varCartKey, cookingRequest)
                }
            }
            onClose()
            return
        }

        // Standard mode (no variations)
        const existing = items.find((i) => getCartItemKey(i) === targetCartKey)
        if (existing) {
            updateQuantity(targetCartKey, existing.quantity + localQty)
            if (cookingRequest.trim()) {
                useCartStore.getState().updateSpecialRequest(targetCartKey, cookingRequest)
            }
        } else {
            addItem({
                menuItemId: item.id,
                name: item.name,
                price: item.price,
                imageUrl: item.image_url || undefined,
                modifiers: currentModifiers,
            })
            updateQuantity(targetCartKey, localQty)
            if (cookingRequest.trim()) {
                useCartStore.getState().updateSpecialRequest(targetCartKey, cookingRequest)
            }
        }
        onClose()
    }

    const isVeg = item.tags?.some(tag => ['veg', 'vegetarian', 'vegan'].includes(tag.toLowerCase()))

    // Determine if the add button should be disabled
    const isAddDisabled = hasVariations
        ? (!item.is_available || (!isTakeout && !sessionId) || variationItemCount === 0)
        : (!item.is_available || (!isTakeout && !sessionId))

    return (
        <div 
            className="fixed inset-0 z-50 flex items-end justify-center p-0 bg-black/45 backdrop-blur-sm animate-fade-in"
            onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
            <div className="relative bg-white w-full sm:max-w-md rounded-t-[32px] sm:rounded-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-fade-up">
                
                {/* Header Banner */}
                <div className="relative w-full h-32 bg-gray-100 shrink-0">
                    {item.image_url ? (
                        <Image
                            src={item.image_url}
                            alt={displayName}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 100vw, 450px"
                            priority
                        />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#f5f0eb] to-[#ede8e0]">
                            <span className="text-4xl opacity-20">🍽️</span>
                        </div>
                    )}
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform z-20"
                    >
                        <X size={18} className="text-[#1A1006]" />
                    </button>
                </div>

                {/* Content Area */}
                <div className="relative z-10 -mt-6 bg-white rounded-t-[32px] px-4 pt-6 pb-24 overflow-y-auto flex-1 text-[#1A1006] font-sans">
                    {/* Overlapping thumbnail and details */}
                    <div className="flex gap-4 items-end relative z-20 mb-5">
                        <div className="relative w-18 h-18 rounded-2xl border-4 border-white bg-white shadow-md overflow-hidden shrink-0">
                            {item.image_url ? (
                                <Image
                                    src={item.image_url}
                                    alt={displayName}
                                    fill
                                    className="object-cover"
                                    sizes="72px"
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#f5f0eb] to-[#ede8e0]">
                                    <span className="text-3xl opacity-20">🍽️</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0 pb-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${isVeg ? "border-green-600" : "border-red-600"}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${isVeg ? "bg-green-600" : "bg-red-600"}`} />
                                </span>
                                <h2 className="text-base font-bold text-gray-900 leading-tight truncate">{displayName}</h2>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-1">
                                <p className="text-xs text-gray-400 font-semibold">{item.menu_categories?.name || 'Lunch'}</p>
                                <span className="text-sm font-black text-[var(--color-primary)]">{displayPriceRange}</span>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    {displayDesc && (
                        <p className="text-xs text-gray-500 font-semibold leading-relaxed mb-6">
                            {displayDesc}
                        </p>
                    )}

                    {/* Pairs well with — precomputed order co-occurrence, see refresh_menu_item_pairings() */}
                    {recommendedItems.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-gray-900 mb-2">Goes well with</h3>
                            <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
                                {recommendedItems.map((recItem) => {
                                    const isSimple = (recItem.modifier_groups?.length ?? 0) === 0 && (recItem.variations?.length ?? 0) === 0
                                    return (
                                        <div
                                            key={recItem.id}
                                            className="shrink-0 w-28 border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden"
                                        >
                                            <div className="relative w-full h-16 bg-gray-100">
                                                {recItem.image_url ? (
                                                    <Image
                                                        src={recItem.image_url}
                                                        alt={recItem.name}
                                                        fill
                                                        className="object-cover"
                                                        sizes="112px"
                                                    />
                                                ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#f5f0eb] to-[#ede8e0]">
                                                        <span className="text-lg opacity-20">🍽️</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-2">
                                                <p className="text-[11px] font-bold text-gray-900 leading-tight truncate">{recItem.name}</p>
                                                <div className="flex items-center justify-between mt-1">
                                                    <span className="text-[10px] font-bold text-gray-500">{money(recItem.price)}</span>
                                                    {isSimple && (
                                                        <button
                                                            onClick={() => handleQuickAdd(recItem)}
                                                            disabled={!isTakeout && !sessionId}
                                                            className="w-5 h-5 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center active:scale-90 transition disabled:opacity-40"
                                                            aria-label={`Add ${recItem.name}`}
                                                        >
                                                            <Plus size={11} strokeWidth={3} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Variations Section */}
                    {hasVariations && item.variations && item.variations.length > 0 && (
                        <div className="space-y-2 mb-6">
                            <div className="mb-2">
                                <h3 className="text-sm font-bold text-gray-900">Select Variants</h3>
                                <p className="text-[11px] text-gray-400 font-medium">
                                    Tap to add • Multiple selections allowed
                                </p>
                            </div>

                            <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-100 bg-white shadow-sm">
                                {item.variations.filter(v => v.is_available).map((variation) => {
                                    const qty = variationQtys[variation.id] || 0
                                    const isSelected = qty > 0
                                    const isActive = activeVariationId === variation.id
                                    return (
                                        <div
                                            key={variation.id}
                                            onClick={() => {
                                                if (qty === 0) {
                                                    setVariationQty(variation.id, 1)
                                                } else if (isActive) {
                                                    setVariationQty(variation.id, 0)
                                                } else {
                                                    setActiveVariationId(variation.id)
                                                }
                                            }}
                                            className={`flex items-center justify-between px-4 py-3.5 select-none transition-all cursor-pointer ${
                                                isActive
                                                    ? 'bg-[var(--color-primary)]/5 border-l-4 border-l-[var(--color-primary)]'
                                                    : isSelected
                                                        ? 'bg-[var(--color-primary)]/5/20 hover:bg-gray-50/50'
                                                        : 'hover:bg-gray-50/50'
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0 flex items-center gap-2.5">
                                                {variation.image_url && (
                                                    <Image
                                                        src={variation.image_url}
                                                        alt={variation.name}
                                                        width={40}
                                                        height={40}
                                                        className="w-10 h-10 rounded-lg object-cover shrink-0 border border-gray-100"
                                                    />
                                                )}
                                                <span className={`text-xs font-semibold ${isSelected ? 'text-gray-900 font-bold' : 'text-gray-700'}`}>
                                                    {variation.name}
                                                </span>
                                                {qty > 0 && (
                                                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-primary)] text-white scale-90">
                                                        ×{qty}
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <span className={`text-xs font-bold tabular-nums ${isSelected ? 'text-[var(--color-primary)]' : 'text-gray-950'}`}>
                                                    {money(variation.price)}
                                                </span>
                                                
                                                <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-all ${
                                                    isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-gray-300"
                                                }`}>
                                                    {isSelected && (
                                                        <Check size={10} className="text-white" strokeWidth={3} />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Modifiers List */}
                    {item.modifier_groups && item.modifier_groups.length > 0 && (
                        <div className="space-y-6">
                            {item.modifier_groups.map((group) => {
                                const selected = selectedMods[group.id] || []
                                const isRequired = group.min_selections > 0
                                const isRadio = group.max_selections === 1

                                return (
                                    <div key={group.id} className="space-y-2">
                                        <div className="mb-2">
                                            <h3 className="text-sm font-bold text-gray-900">{group.name}</h3>
                                            <p className="text-[11px] text-gray-400 font-medium">
                                                {isRequired ? 'Required' : 'Optional'} • {isRadio ? 'Select any 1 option' : `Select up to ${group.max_selections} options`}
                                            </p>
                                        </div>

                                        <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-100 mb-4 bg-white shadow-sm">
                                            {group.modifiers?.filter((m) => m.is_available).map((mod) => {
                                                const isSelected = selected.includes(mod.id)
                                                return (
                                                    <div
                                                        key={mod.id}
                                                        onClick={() => toggleModifier(group.id, mod.id, group.max_selections)}
                                                        className="flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-gray-50/50 select-none transition-all"
                                                    >
                                                        <span className="text-xs font-semibold text-gray-700">{mod.name}</span>
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs font-bold text-gray-950">
                                                                {mod.price_adjustment > 0
                                                                    ? `+${money(mod.price_adjustment)}`
                                                                    : 'Free'
                                                                }
                                                            </span>
                                                            {isRadio ? (
                                                                <div className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-all ${
                                                                    isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-gray-300"
                                                                }`}>
                                                                    {isSelected && (
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-all ${
                                                                    isSelected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-gray-300"
                                                                }`}>
                                                                    {isSelected && (
                                                                        <Check size={10} className="text-white" strokeWidth={3} />
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* Cooking request (optional) */}
                    <div className="border border-gray-100 rounded-2xl p-4 mt-6 bg-white shadow-sm">
                        <h4 className="text-xs font-bold text-gray-900 mb-1">Add a cooking request (optional)</h4>
                        <p className="text-[10px] text-gray-400 font-semibold mb-3">Add any special requests or preferences</p>
                        <textarea
                            value={cookingRequest}
                            onChange={(e) => setCookingRequest(e.target.value)}
                            placeholder="e.g., Extra spicy, No onions, Well done..."
                            className="w-full text-xs bg-gray-50 border border-gray-100 rounded-xl p-3 focus:outline-none focus:border-[var(--color-primary)] min-h-[70px] resize-none placeholder:text-gray-300 font-semibold text-gray-700"
                        />
                    </div>
                </div>

                {/* Sticky Bottom Panel */}
                <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-4 flex items-center justify-between gap-2 z-30">
                    {/* Quantity selector or Cancel button */}
                    {hasVariations ? (
                        activeVariationId ? (
                            <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-2.5 py-2 bg-white text-gray-600">
                                <button
                                    onClick={() => setVariationQty(activeVariationId, (variationQtys[activeVariationId] || 0) - 1)}
                                    className="hover:scale-105 active:scale-90 transition"
                                >
                                    <Minus size={14} strokeWidth={2.5} />
                                </button>
                                <span className="text-xs font-black min-w-[14px] text-center tabular-nums text-gray-800">
                                    {variationQtys[activeVariationId] || 0}
                                </span>
                                <button
                                    onClick={() => setVariationQty(activeVariationId, (variationQtys[activeVariationId] || 0) + 1)}
                                    disabled={(variationQtys[activeVariationId] || 0) >= 20}
                                    className="hover:scale-105 active:scale-90 transition"
                                >
                                    <Plus size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={onClose}
                                className="border border-gray-200 text-gray-500 font-bold px-4 py-2.5 rounded-xl text-xs active:scale-95 transition-all shrink-0"
                            >
                                Cancel
                            </button>
                        )
                    ) : (
                        <>
                            {/* Quantity selectors — only for non-variation items */}
                            <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-2.5 py-2 bg-white text-gray-600">
                                <button
                                    onClick={() => setLocalQty(q => Math.max(1, q - 1))}
                                    disabled={localQty <= 1}
                                    className="hover:scale-105 active:scale-90 transition disabled:opacity-40"
                                >
                                    <Minus size={14} strokeWidth={2.5} />
                                </button>
                                <span className="text-xs font-black min-w-[14px] text-center tabular-nums text-gray-800">
                                    {localQty}
                                </span>
                                <button
                                    onClick={() => setLocalQty(q => Math.min(20, q + 1))}
                                    disabled={localQty >= 20}
                                    className="hover:scale-105 active:scale-90 transition"
                                >
                                    <Plus size={14} strokeWidth={2.5} />
                                </button>
                            </div>

                            <button
                                onClick={onClose}
                                className="border border-gray-200 text-gray-500 font-bold px-4 py-2.5 rounded-xl text-xs active:scale-95 transition-all shrink-0"
                            >
                                Cancel
                            </button>
                        </>
                    )}

                    {/* Action Button (Add / Save) */}
                    <button
                        onClick={handleAction}
                        disabled={isAddDisabled}
                        className="flex-1 bg-[var(--color-primary)] text-white font-bold rounded-xl py-2.5 px-3 text-center text-xs active:scale-95 transition-all shadow-md shadow-orange-600/10 disabled:opacity-40 disabled:pointer-events-none"
                    >
                        {onSaveEdit 
                            ? `Save Changes ${money(displayTotal)}` 
                            : hasVariations
                                ? variationItemCount > 0
                                    ? `Add ${variationItemCount} item${variationItemCount > 1 ? 's' : ''} ${money(variationTotal)}`
                                    : 'Select a variant'
                                : `Add to Cart ${money(totalPrice)}`
                        }
                    </button>
                </div>

            </div>
        </div>
    )
}
