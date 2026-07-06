'use client'

import { useState, useEffect } from 'react'
import { useCartStore, getCartItemKey } from '@/lib/stores/cart'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { Plus, Minus, X, Check, Clock, Flame, Leaf, Sparkles } from 'lucide-react'
import Image from 'next/image'
import type { MenuItem, CartItemModifier } from '@/types/database'
import { useTranslation } from '@/lib/contexts/TranslationContext'
import ItemDetailView from './ItemDetailView'

const TAG_STYLES: Record<string, { cls: string; icon?: string }> = {
    popular:      { cls: 'bg-amber-100 text-amber-800', icon: '★' },
    bestseller:   { cls: 'bg-amber-100 text-amber-800', icon: '★' },
    new:          { cls: 'bg-green-100 text-green-700', icon: '✦' },
    spicy:        { cls: 'bg-red-100 text-red-700', icon: '🌶' },
    hot:          { cls: 'bg-red-100 text-red-700' },
    veg:          { cls: 'bg-emerald-100 text-emerald-700', icon: '●' },
    vegetarian:   { cls: 'bg-emerald-100 text-emerald-700' },
    vegan:        { cls: 'bg-emerald-100 text-emerald-700' },
    'gluten-free':{ cls: 'bg-blue-100 text-blue-700' },
    recommended:  { cls: 'bg-purple-100 text-purple-700', icon: '♥' },
}

const ALLERGEN_ICONS: Record<string, string> = {
    nuts: '🥜', dairy: '🧀', eggs: '🥚', gluten: '🌾',
    soy: '🫘', fish: '🐟', shellfish: '🦐', sesame: '🫙',
}

export default function MenuItemCard({ item, comboItems = [], menuItems = [], sessionId, restaurantSlug, restaurantId, isTakeout = false }: {
    item: MenuItem
    comboItems?: any[]
    menuItems?: MenuItem[]
    sessionId?: string
    restaurantSlug: string
    restaurantId?: string
    isTakeout?: boolean
}) {
    const { t } = useTranslation()
    const money = useCurrency()
    const displayName = t('menu_item_name', item.id, item.name)
    const displayDesc = item.description ? t('menu_item_description', item.id, item.description) : null

    const items = useHydratedStore(useCartStore, (s) => s.items)
    const addItem = useCartStore((s) => s.addItem)
    const removeItem = useCartStore((s) => s.removeItem)
    const updateQuantity = useCartStore((s) => s.updateQuantity)
    const setSession = useCartStore((s) => s.setSession)

    const [showModifiers, setShowModifiers] = useState(false)
    const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>({})

    // Close the modifier sheet on Escape for keyboard/accessibility users.
    useEffect(() => {
        if (!showModifiers) return
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModifiers(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [showModifiers])

    const hasModifiers = (item.modifier_groups?.length ?? 0) > 0
    const hasVariations = (item.variations?.length ?? 0) > 0
    const isVeg = item.tags?.some(t => ['veg', 'vegetarian', 'vegan'].includes(t.toLowerCase()))
    
    // Format price range if there are variations with different prices
    let priceDisplay = money(item.price)
    if (hasVariations && item.variations && item.variations.length > 0) {
        const prices = item.variations.map(v => v.price)
        const minP = Math.min(...prices)
        const maxP = Math.max(...prices)
        priceDisplay = minP !== maxP ? `${money(minP)} - ${maxP}` : money(minP)
    }
    // The cart stores a separate line per (menuItemId + modifiers), so there can
    // be several lines for one menu item. The badge must show the combined count.
    const matchingItems = items.filter((i) => i.menuItemId === item.id)
    const quantity = matchingItems.reduce((sum, i) => sum + i.quantity, 0)
    // Inline +/- can only act on one concrete line, so they're reserved for items
    // without modifiers or variations (exactly one line). Complex items always use the sheet.
    const simpleCartItem = (hasModifiers || hasVariations) ? undefined : matchingItems[0]
    const cartKey = simpleCartItem ? getCartItemKey(simpleCartItem) : ''

    // For items with variations, show the ItemDetailView instead of modifier sheet
    const [showDetailView, setShowDetailView] = useState(false)

    function initModSelections() {
        const init: Record<string, string[]> = {}
        item.modifier_groups?.forEach(g => { init[g.id] = [] })
        setSelectedMods(init)
    }

    const handleAdd = () => {
        if (!isTakeout && !sessionId) return
        if (sessionId) {
            setSession(sessionId, restaurantSlug, restaurantId)
        }
        // Variation items always open the detail view for selection
        if (hasVariations) { setShowDetailView(true); return }
        // Modifier items always go through the sheet so each tap can pick its own
        // options and create the correct line — never blindly bump one variant.
        if (hasModifiers) { initModSelections(); setShowModifiers(true); return }
        if (quantity > 0) updateQuantity(cartKey, quantity + 1)
        else addItem({ menuItemId: item.id, name: item.name, price: item.price, imageUrl: item.image_url || undefined })
    }

    function handleConfirmModifiers() {
        for (const group of item.modifier_groups || []) {
            if ((selectedMods[group.id] || []).length < group.min_selections) return
        }
        const modifiers: CartItemModifier[] = []
        for (const group of item.modifier_groups || []) {
            for (const modId of (selectedMods[group.id] || [])) {
                const mod = group.modifiers?.find(m => m.id === modId)
                if (mod) modifiers.push({ modifierId: mod.id, name: mod.name, priceAdjustment: mod.price_adjustment })
            }
        }
        addItem({ menuItemId: item.id, name: item.name, price: item.price, imageUrl: item.image_url || undefined, modifiers })
        setShowModifiers(false)
    }

    function toggleModifier(groupId: string, modId: string, maxSelections: number) {
        setSelectedMods(prev => {
            const current = prev[groupId] || []
            if (current.includes(modId)) return { ...prev, [groupId]: current.filter(id => id !== modId) }
            if (current.length >= maxSelections) return { ...prev, [groupId]: [...current.slice(0, -1), modId] }
            return { ...prev, [groupId]: [...current, modId] }
        })
    }

    const handleRemove = () => {
        if (!cartKey) return
        if (quantity > 1) updateQuantity(cartKey, quantity - 1)
        else if (quantity === 1) removeItem(cartKey)
    }

    const modTotal = Object.values(selectedMods).flat().reduce((sum, modId) => {
        const mod = item.modifier_groups?.flatMap(g => g.modifiers || []).find(m => m.id === modId)
        return sum + (mod?.price_adjustment || 0)
    }, 0)

    const firstTag = (item.tags || [])[0]?.toLowerCase()
    const tagStyle = firstTag ? (TAG_STYLES[firstTag] || { cls: 'bg-surface/90 text-ink-muted' }) : null
    const displayAllergens = (item.allergens || []).slice(0, 3)

    return (
        <>
        <div style={{ boxShadow: '0 6px 20px -4px rgba(255,122,46,0.45), 0 2px 8px -2px rgba(0,0,0,0.18)' }} className={`group relative bg-brand-500 rounded-[32px] hover:shadow-[0_12px_32px_-4px_rgba(255,122,46,0.65),0_4px_12px_-2px_rgba(0,0,0,0.22)] hover:brightness-105 active:scale-[0.97] active:shadow-md transition-all duration-300 ease-out flex flex-col w-full p-3 pt-3.5 pb-3 gap-2.5 ${!item.is_available ? 'opacity-70' : ''}`}>
            {/* Top: Dish name with Veg/Non-Veg Logo (Starts from Left Corner) */}
            <div className="flex items-center gap-1.5 px-1.5 w-full justify-start text-left">
                <div className={`w-3.5 h-3.5 border-2 ${isVeg ? 'border-emerald-600' : 'border-red-700'} flex items-center justify-center p-0.5 shrink-0 bg-surface rounded-xs`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isVeg ? 'bg-emerald-600' : 'bg-red-700'}`} />
                </div>
                <h3 className="font-black text-[11px] text-white leading-tight uppercase line-clamp-1 truncate text-left drop-shadow-sm">
                    {displayName}
                </h3>
            </div>

            {/* Middle: Centered Wide Image Container */}
            <div className="relative w-full aspect-[16/10] rounded-[20px] bg-black/5 overflow-hidden shrink-0 shadow-sm border border-white/10 z-10">
                {item.image_url ? (
                    <Image
                        src={item.image_url}
                        alt={displayName}
                        fill
                        className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
                        sizes="200px"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                        <span className="text-xl opacity-20">🍽️</span>
                    </div>
                )}

                {/* Sold out overlay */}
                {!item.is_available && (
                    <div className="absolute inset-0 bg-surface/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <span className="bg-surface text-ink-muted font-bold px-1.5 py-0.5 rounded text-[8px] border border-gray-205 shadow-xs">
                            Sold Out
                        </span>
                    </div>
                )}
            </div>

            {/* Bottom Row: Price and Horizontal Quantity Controls */}
            <div className="flex items-center justify-between w-full px-1.5 mt-0.5 gap-2 z-20">
                {/* Left: Price */}
                <span className="font-black text-[13px] text-white tabular-nums text-left leading-none drop-shadow-sm">
                    {priceDisplay}
                </span>

                {/* Right: Quantity controls horizontal block */}
                <div className="shrink-0 flex items-center justify-end">
                    {(!isTakeout && !sessionId) ? null : (quantity === 0 || hasModifiers || hasVariations) ? (
                        <button
                            onClick={handleAdd}
                            disabled={!item.is_available}
                            className="bg-surface text-brand-500 px-3.5 py-1.5 rounded-full flex items-center justify-center font-black active:scale-95 transition-all shadow-sm text-[10px] tracking-wider uppercase leading-none min-w-[56px] text-center hover:bg-brand-50"
                            aria-label={`Add ${displayName} to cart`}
                        >
                            Add to cart
                        </button>
                    ) : (
                        <div className="bg-surface rounded-full flex flex-row items-center gap-2 p-1 px-1.5 shadow-sm h-7">
                            <button 
                                onClick={handleRemove}
                                aria-label={`Remove one ${displayName}`}
                                className="w-5 h-5 rounded-full bg-brand-100 hover:bg-brand-200 flex items-center justify-center text-brand-500 active:scale-90 transition"
                            >
                                <Minus size={9} strokeWidth={4.5} />
                            </button>
                            <span className="text-[11px] font-black leading-none tabular-nums text-brand-500 min-w-[12px] text-center my-0.5">{quantity}</span>
                            <button 
                                onClick={handleAdd}
                                aria-label={`Add one ${displayName}`}
                                className="w-5 h-5 rounded-full bg-brand-100 hover:bg-brand-200 flex items-center justify-center text-brand-500 active:scale-90 transition"
                            >
                                <Plus size={9} strokeWidth={4.5} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Modifier sheet */}
        {showModifiers && item.modifier_groups && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
                 onClick={(e) => { if (e.target === e.currentTarget) setShowModifiers(false) }}>
                <div role="dialog" aria-modal="true" aria-label={`Customise ${displayName}`}
                     className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-up sm:animate-scale-in">
                    <div className="flex justify-center pt-3 pb-1 sm:hidden">
                        <div className="w-10 h-1 bg-surface-muted rounded-full" />
                    </div>

                    <div className="px-5 py-4 border-b border-hairline flex items-start justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-ink text-base">{displayName}</h3>
                            <p className="text-xs text-ink-subtle mt-0.5">Customise your order</p>
                        </div>
                        <button onClick={() => setShowModifiers(false)}
                                aria-label="Close"
                                className="w-11 h-11 rounded-full bg-surface-muted flex items-center justify-center text-ink-subtle hover:bg-surface-muted transition shrink-0">
                            <X size={17} />
                        </button>
                    </div>

                    <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 scrollbar-thin">
                        {item.modifier_groups.map(group => {
                            const selected = selectedMods[group.id] || []
                            const isRequired = group.min_selections > 0
                            const isSatisfied = selected.length >= group.min_selections
                            return (
                                <div key={group.id}>
                                    <div className="flex items-center gap-2 mb-3">
                                        <h4 className="font-semibold text-ink text-sm">{group.name}</h4>
                                        {isRequired && !isSatisfied && (
                                            <span className="text-[10px] bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full font-medium">Required</span>
                                        )}
                                        {isRequired && isSatisfied && (
                                            <span className="text-[10px] bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full font-medium flex items-center gap-0.5">
                                                <Check size={9} /> Done
                                            </span>
                                        )}
                                        <span className="text-xs text-ink-subtle ml-auto">
                                            {group.max_selections === 1 ? 'Choose 1' : `Up to ${group.max_selections}`}
                                        </span>
                                    </div>
                                    <div className="space-y-2">
                                        {group.modifiers?.filter(m => m.is_available).map(mod => {
                                            const isSelected = selected.includes(mod.id)
                                            return (
                                                <button
                                                    key={mod.id}
                                                    onClick={() => toggleModifier(group.id, mod.id, group.max_selections)}
                                                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all ${
                                                        isSelected
                                                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                                                            : 'border-hairline bg-surface-muted hover:bg-surface-muted'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                                                            isSelected ? 'border-[var(--color-primary)] bg-[var(--color-primary)]' : 'border-hairline-strong'
                                                        }`}>
                                                            {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                                                        </div>
                                                        <span className={`${isSelected ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                                                            {mod.name}
                                                        </span>
                                                    </div>
                                                    <span className={`text-sm tabular-nums ${isSelected ? 'text-[var(--color-primary)] font-semibold' : 'text-ink-subtle'}`}>
                                                        {mod.price_adjustment > 0 ? `+${money(mod.price_adjustment)}` : mod.price_adjustment < 0 ? money(mod.price_adjustment) : 'Free'}
                                                    </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div className="p-5 border-t border-hairline">
                        <button
                            onClick={handleConfirmModifiers}
                            className="w-full bg-[var(--color-primary)] text-white py-3.5 rounded-xl font-semibold text-sm active:scale-[0.98] transition-all shadow-lg shadow-[var(--color-primary)]/20"
                        >
                            Add to Cart — {money(item.price + modTotal)}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Variation item detail view */}
        {showDetailView && (
            <ItemDetailView
                item={item}
                comboItems={comboItems}
                menuItems={menuItems}
                sessionId={sessionId}
                restaurantSlug={restaurantSlug}
                restaurantId={restaurantId}
                isTakeout={isTakeout}
                onClose={() => setShowDetailView(false)}
            />
        )}
        </>
    )
}
