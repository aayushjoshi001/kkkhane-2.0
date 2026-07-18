'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, Search, Plus, Minus, Trash2, Loader2, ShoppingCart, Utensils, MessageSquare, CheckCircle2, ArrowLeft } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { getStaffMenu, placeStaffOrder, placeRoomOrderDirect } from '@/app/(staff)/waiter/actions'
import { toast } from 'react-hot-toast'

interface Modifier {
    id: string
    name: string
    price_adjustment: number
}

interface ModifierGroup {
    id: string
    name: string
    min_selection: number
    max_selection: number
    modifiers: Modifier[]
}

interface Variation {
    id: string
    name: string
    price: number
}

interface MenuItem {
    id: string
    name: string
    price: number
    category_id: string | null
    is_available: boolean
    variations?: Variation[]
    modifier_groups?: ModifierGroup[]
}

interface Category {
    id: string
    name: string
}

interface QuickOrderModalProps {
    isOpen: boolean
    onClose: () => void
    sessionId?: string
    tableName?: string
    restaurantId: string
    activeTables?: any[]
    bookingId?: string
    onSuccess?: (orderId: string) => void
}

interface CartItem {
    id: string // unique instance ID in cart
    menuItemId: string
    name: string
    price: number
    quantity: number
    specialRequest: string
    variationId?: string
    variationName?: string
    modifiers: {
        modifierId: string
        name: string
        priceAdjustment: number
    }[]
}

export default function QuickOrderModal({
    isOpen,
    onClose,
    sessionId,
    tableName,
    restaurantId,
    activeTables,
    bookingId,
    onSuccess
}: QuickOrderModalProps) {
    const [mounted, setMounted] = useState(false)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    
    const [categories, setCategories] = useState<Category[]>([])
    const [menuItems, setMenuItems] = useState<any[]>([])
    
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [cart, setCart] = useState<CartItem[]>([])
    const [customerNote, setCustomerNote] = useState('')
    const [selectedSession, setSelectedSession] = useState<{ id: string; token: string; label: string } | null>(null)
    const [showMobileCart, setShowMobileCart] = useState(false)

    // Modifier/Variation Configuration State
    const [configuringItem, setConfiguringItem] = useState<MenuItem | null>(null)
    const [selectedVariation, setSelectedVariation] = useState<Variation | null>(null)
    const [selectedModifiers, setSelectedModifiers] = useState<Record<string, Modifier[]>>({}) // groupId -> selected modifiers
    const [specialRequestInput, setSpecialRequestInput] = useState('')

    // Shown after a successful placement so the cashier gets a clear, explicit
    // confirmation instead of relying on a toast that disappears with the modal.
    const [orderConfirmation, setOrderConfirmation] = useState<{
        itemCount: number
        total: number
        label: string
    } | null>(null)

    // Shown BEFORE submission — an explicit "are you sure" step so a misclick
    // on "Place Order" can't send a wrong order straight to the kitchen.
    const [showConfirmDialog, setShowConfirmDialog] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (!isOpen) return
        if (sessionId && tableName) {
            setSelectedSession({ id: sessionId, token: sessionId, label: tableName })
        } else if (activeTables && activeTables.length > 0) {
            const firstActive = activeTables.find(t => t.activeSession)
            if (firstActive) {
                setSelectedSession({
                    id: firstActive.activeSession.id,
                    token: firstActive.activeSession.session_token,
                    label: firstActive.label
                })
            } else {
                setSelectedSession(null)
            }
        } else {
            setSelectedSession(null)
        }
    }, [isOpen, sessionId, tableName, activeTables])

    useEffect(() => {
        if (!isOpen || !restaurantId) return
        
        async function loadMenu() {
            setLoading(true)
            const res = await getStaffMenu(restaurantId)
            if (res.success && res.categories && res.menuItems) {
                setCategories(res.categories)
                setMenuItems(res.menuItems.filter((i: any) => i.is_available))
            } else {
                toast.error(res.error || 'Failed to load menu')
            }
            setLoading(false)
        }
        loadMenu()
    }, [isOpen, restaurantId])

    // Filter items
    const filteredItems = useMemo(() => {
        return menuItems.filter(item => {
            const matchesCategory = selectedCategoryId === 'all' || item.category_id === selectedCategoryId
            const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase())
            return matchesCategory && matchesSearch
        })
    }, [menuItems, selectedCategoryId, searchQuery])

    // Total Calculation
    const cartTotal = useMemo(() => {
        return cart.reduce((total, item) => {
            const itemPrice = item.price
            const modifiersPrice = item.modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0)
            return total + (itemPrice + modifiersPrice) * item.quantity
        }, 0)
    }, [cart])

    if (!mounted || !isOpen) return null

    const handleAddToCartClick = (item: MenuItem) => {
        const hasVariations = item.variations && item.variations.length > 0
        const hasModifiers = item.modifier_groups && item.modifier_groups.length > 0

        if (hasVariations || hasModifiers) {
            // Open customization sub-modal
            setConfiguringItem(item)
            setSelectedVariation(item.variations?.[0] || null)
            setSelectedModifiers({})
            setSpecialRequestInput('')
        } else {
            // Add directly
            addToCartDirectly(item)
        }
    }

    const addToCartDirectly = (item: MenuItem, variation?: Variation | null, modifiers: Modifier[] = [], note = '') => {
        const itemPrice = variation ? variation.price : item.price
        const variationName = variation ? variation.name : undefined
        const variationId = variation ? variation.id : undefined

        // Unique key for matching same items in cart
        const modifierIds = modifiers.map(m => m.id).sort().join(',')
        const cartItemId = `${item.id}-${variationId || 'none'}-${modifierIds}-${note}`

        setCart(prev => {
            const existingIndex = prev.findIndex(i => i.id === cartItemId)
            if (existingIndex > -1) {
                const updated = [...prev]
                updated[existingIndex].quantity += 1
                return updated
            }

            return [...prev, {
                id: cartItemId,
                menuItemId: item.id,
                name: item.name,
                price: itemPrice,
                quantity: 1,
                specialRequest: note,
                variationId,
                variationName,
                modifiers: modifiers.map(m => ({
                    modifierId: m.id,
                    name: m.name,
                    priceAdjustment: m.price_adjustment
                }))
            }]
        })
        toast.success(`Added ${item.name} to cart`)
    }

    const handleAddConfiguredItem = () => {
        if (!configuringItem) return

        // Validate min selections
        if (configuringItem.modifier_groups) {
            for (const group of configuringItem.modifier_groups) {
                const selected = selectedModifiers[group.id] || []
                if (selected.length < group.min_selection) {
                    toast.error(`Please select at least ${group.min_selection} item(s) from ${group.name}`)
                    return
                }
            }
        }

        const flatModifiers: Modifier[] = []
        Object.values(selectedModifiers).forEach(list => flatModifiers.push(...list))

        addToCartDirectly(configuringItem, selectedVariation, flatModifiers, specialRequestInput)
        setConfiguringItem(null)
    }

    const toggleModifier = (group: ModifierGroup, modifier: Modifier) => {
        setSelectedModifiers(prev => {
            const selected = prev[group.id] || []
            const exists = selected.find(m => m.id === modifier.id)

            let updated: Modifier[]
            if (exists) {
                updated = selected.filter(m => m.id !== modifier.id)
            } else {
                // Enforce max selection
                if (group.max_selection === 1) {
                    updated = [modifier]
                } else if (selected.length < group.max_selection) {
                    updated = [...selected, modifier]
                } else {
                    toast.error(`Maximum selection reached for ${group.name}`)
                    return prev
                }
            }

            return {
                ...prev,
                [group.id]: updated
            }
        })
    }

    const updateQuantity = (cartItemId: string, amount: number) => {
        setCart(prev => {
            const updated = prev.map(item => {
                if (item.id === cartItemId) {
                    const newQty = item.quantity + amount
                    return newQty > 0 ? { ...item, quantity: newQty } : null
                }
                return item
            }).filter(Boolean) as CartItem[]
            if (updated.length === 0) {
                setShowMobileCart(false)
            }
            return updated
        })
    }

    const getCartItemQuantity = (menuItemId: string, variationId?: string) => {
        const match = cart.find(ci => ci.menuItemId === menuItemId && ci.variationId === variationId)
        return match ? match.quantity : 0
    }

    const handleQuantityChange = (menuItem: MenuItem, variation?: Variation | null, change: number = 1) => {
        const variationId = variation ? variation.id : undefined
        const existing = cart.find(ci => ci.menuItemId === menuItem.id && ci.variationId === variationId)
        if (existing) {
            updateQuantity(existing.id, change)
        } else if (change > 0) {
            addToCartDirectly(menuItem, variation)
        }
    }

    const handlePlaceOrder = async () => {
        if (cart.length === 0) {
            toast.error('Cart is empty')
            return
        }

        if (!selectedSession && !bookingId) {
            toast.error('No table session or room stay selected')
            return
        }

        setShowConfirmDialog(false)
        setSubmitting(true)
        try {
            const res = bookingId && !selectedSession
                ? await placeRoomOrderDirect(bookingId, cart, customerNote)
                : selectedSession
                    ? await placeStaffOrder(selectedSession.token, cart, customerNote)
                    : { error: 'No active session found.' }
            if (res && res.success) {
                if (res.orderId) {
                    onSuccess?.(res.orderId)
                }
                setOrderConfirmation({
                    itemCount: cart.reduce((sum, item) => sum + item.quantity, 0),
                    total: cartTotal,
                    label: bookingId ? 'the room bill' : `Table ${selectedSession?.label ?? ''}`
                })
                setCart([])
                setCustomerNote('')
                setShowMobileCart(false)
            } else {
                const errMsg = res?.error || 'Failed to place order'
                if (errMsg === 'Unauthorized') {
                    toast.error('Session expired. Redirecting to login...')
                    setTimeout(() => { 
                        window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}` 
                    }, 1500)
                } else {
                    toast.error(errMsg)
                }
            }
        } catch (err: any) {
            console.error('[handlePlaceOrder] Error:', err)
            const msg = err?.message || ''
            if (msg.includes('Unauthorized') || msg.includes('unexpected response')) {
                toast.error('Session expired. Redirecting to login...')
                setTimeout(() => { 
                    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}` 
                }, 1500)
            } else {
                toast.error('Failed to place order. Please try again.')
            }
        } finally {
            setSubmitting(false)
        }
    }

    const handleConfirmationDone = () => {
        setOrderConfirmation(null)
        onClose()
    }

    return (
        <>
        {/* Success confirmation — an explicit post-placement acknowledgement so the
            cashier gets clear feedback instead of a toast that vanishes with the modal. */}
        <Modal
            open={!!orderConfirmation}
            onClose={handleConfirmationDone}
            size="sm"
            layer="top"
            ariaLabel="Order placed"
            className="p-8 flex flex-col items-center text-center gap-4"
        >
            {orderConfirmation && (
                <>
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <CheckCircle2 size={36} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-black text-ink">Order Placed!</h3>
                        <p className="text-body text-ink-subtle mt-1">
                            {orderConfirmation.itemCount} item{orderConfirmation.itemCount !== 1 ? 's' : ''} sent to the kitchen and added to {orderConfirmation.label}.
                        </p>
                    </div>
                    <div className="w-full py-3 rounded-xl bg-surface-muted text-center">
                        <span className="text-caption font-bold text-ink-subtle uppercase">Order Total</span>
                        <p className="text-h2 font-black text-ink">Rs. {orderConfirmation.total}</p>
                    </div>
                    <Button block variant="primary" onClick={handleConfirmationDone} className="py-3 font-bold">
                        Done
                    </Button>
                </>
            )}
        </Modal>
        {/* Main POS workspace — hidden while the success card is showing. */}
        <Modal open={isOpen && !orderConfirmation} onClose={onClose} size="full" ariaLabel="Quick POS Order" className="flex flex-col overflow-hidden" layer="top" backdropClassName="!z-[99999]">
                {/* Header */}
                <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500">
                            <Utensils size={20} />
                        </div>
                        <div>
                            <h3 className="text-h3 font-black text-ink">Quick POS Order</h3>
                            {activeTables && activeTables.length > 0 ? (
                                <div className="mt-1 flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-ink-subtle uppercase">Table:</span>
                                    <select
                                        value={selectedSession?.id || ''}
                                        onChange={e => {
                                            const table = activeTables.find(t => t.activeSession?.id === e.target.value)
                                            if (table && table.activeSession) {
                                                setSelectedSession({
                                                    id: table.activeSession.id,
                                                    token: table.activeSession.session_token,
                                                    label: table.label
                                                })
                                            }
                                        }}
                                        className="text-caption font-black text-brand-500 bg-surface border border-hairline rounded-lg px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    >
                                        <option value="" disabled>Select Table...</option>
                                        {activeTables
                                            .filter(t => t.activeSession)
                                            .map(t => (
                                                <option key={t.id} value={t.activeSession.id}>
                                                    Table {t.label}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            ) : selectedSession ? (
                                <p className="text-caption text-ink-subtle mt-0.5">Table {selectedSession.label} · Active Session</p>
                            ) : bookingId && tableName ? (
                                <p className="text-caption text-brand-500 font-bold mt-0.5">🛎 {tableName} · Room Order</p>
                            ) : (
                                <p className="text-caption text-amber-500 font-semibold mt-0.5">No active table sessions found</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {!showMobileCart && (
                            <button
                                onClick={() => setShowMobileCart(true)}
                                className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 transition relative"
                            >
                                <ShoppingCart size={18} />
                                {cart.length > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 bg-brand-500 text-white rounded-full text-[9px] font-black w-5 h-5 flex items-center justify-center shadow-md">
                                        {cart.length}
                                    </span>
                                )}
                            </button>
                        )}
                        <button 
                            onClick={onClose}
                            className="w-10 h-10 md:w-8 md:h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                        <Loader2 size={40} className="animate-spin text-brand-500" />
                        <p className="text-body text-ink-subtle">Loading menu items…</p>
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Categories Left Panel */}
                        <div className="w-48 bg-surface-muted border-r border-hairline overflow-y-auto hidden md:flex flex-col p-2 gap-1 select-none">
                            <button
                                onClick={() => setSelectedCategoryId('all')}
                                className={`px-4 py-3 text-left text-label font-bold rounded-xl transition-all ${
                                    selectedCategoryId === 'all' 
                                        ? 'bg-brand-500 text-white shadow-md' 
                                        : 'hover:bg-surface text-ink-subtle'
                                }`}
                            >
                                All Items
                            </button>
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategoryId(cat.id)}
                                    className={`px-4 py-3 text-left text-label font-bold rounded-xl transition-all ${
                                        selectedCategoryId === cat.id 
                                            ? 'bg-brand-500 text-white shadow-md' 
                                            : 'hover:bg-surface text-ink-subtle'
                                    }`}
                                >
                                    {cat.name}
                                </button>
                            ))}
                        </div>

                        {/* Items Middle Panel */}
                        <div className={`flex-1 flex flex-col bg-surface overflow-hidden ${showMobileCart ? 'hidden md:flex' : ''}`}>
                            {/* Search Bar */}
                            <div className="p-4 border-b border-hairline bg-surface-muted/20 flex flex-col gap-3 shrink-0">
                                <div className="relative">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder="Search dish by name..."
                                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-hairline bg-surface text-ink text-body focus:outline-none focus:ring-2 focus:ring-brand-500"
                                    />
                                    {searchQuery && (
                                        <button 
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>

                                {/* Horizontal Categories Selector (Mobile Only) */}
                                <div className="md:hidden flex gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 select-none shrink-0">
                                    <button
                                        onClick={() => setSelectedCategoryId('all')}
                                        className={`px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
                                            selectedCategoryId === 'all' 
                                                ? 'bg-brand-500 text-white shadow-sm' 
                                                : 'bg-surface text-ink-subtle border border-hairline'
                                        }`}
                                    >
                                        All
                                    </button>
                                    {categories.map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => setSelectedCategoryId(cat.id)}
                                            className={`px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
                                                selectedCategoryId === cat.id 
                                                    ? 'bg-brand-500 text-white shadow-sm' 
                                                    : 'bg-surface text-ink-subtle border border-hairline'
                                            }`}
                                        >
                                            {cat.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Dishes List */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-1">
                                {filteredItems.length === 0 ? (
                                    <div className="text-center py-12 text-ink-subtle">
                                        <Utensils size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-body font-semibold">No items found</p>
                                    </div>
                                ) : (
                                    filteredItems.map(item => {
                                        const hasVariations = item.variations && item.variations.length > 0
                                        const hasModifiers = item.modifier_groups && item.modifier_groups.length > 0

                                        return (
                                            <div 
                                                key={item.id}
                                                className="p-4 md:p-3 rounded-xl border border-transparent hover:border-hairline hover:bg-surface-muted/30 transition-all select-none flex flex-col gap-1.5"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1 pr-4">
                                                        <h4 className="text-body font-bold text-ink">{item.name}</h4>
                                                    </div>
                                                    {!hasVariations && (
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-body font-extrabold text-ink-muted">
                                                                Rs. {item.price}
                                                            </span>
                                                            {hasModifiers ? (
                                                                <button
                                                                    onClick={() => handleAddToCartClick(item)}
                                                                    className="w-11 h-11 md:w-8 md:h-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-sm cursor-pointer"
                                                                >
                                                                    <Plus className="w-5 h-5 md:w-4 md:h-4" />
                                                                </button>
                                                            ) : (() => {
                                                                const qty = getCartItemQuantity(item.id)
                                                                if (qty > 0) {
                                                                    return (
                                                                        <div className="flex items-center gap-2">
                                                                            <button
                                                                                onClick={() => handleQuantityChange(item, null, -1)}
                                                                                className="w-8 h-8 md:w-7 md:h-7 rounded-lg bg-surface border border-hairline flex items-center justify-center hover:bg-surface-muted transition"
                                                                            >
                                                                                <Minus size={14} className="text-ink-subtle" />
                                                                            </button>
                                                                            <span className="text-body font-black text-ink w-4 text-center">{qty}</span>
                                                                            <button
                                                                                onClick={() => handleQuantityChange(item, null, 1)}
                                                                                className="w-8 h-8 md:w-7 md:h-7 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition"
                                                                            >
                                                                                <Plus size={14} />
                                                                            </button>
                                                                        </div>
                                                                    )
                                                                }
                                                                return (
                                                                    <button
                                                                        onClick={() => handleQuantityChange(item, null, 1)}
                                                                        className="w-11 h-11 md:w-8 md:h-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-all active:scale-95 shadow-sm cursor-pointer"
                                                                    >
                                                                        <Plus className="w-5 h-5 md:w-4 md:h-4" />
                                                                    </button>
                                                                )
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>

                                                {hasVariations && (
                                                    <div className="pl-3 border-l-2 border-brand-500/20 space-y-2 mt-1">
                                                        {item.variations.map((v: Variation) => {
                                                            const qty = getCartItemQuantity(item.id, v.id)
                                                            return (
                                                                <div key={v.id} className="flex items-center justify-between py-1 border-b border-hairline last:border-0">
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-caption font-bold text-ink-muted truncate">{v.name}</p>
                                                                        <p className="text-[10px] text-ink-subtle font-semibold">Rs. {v.price}</p>
                                                                    </div>
                                                                    <div className="flex items-center gap-3">
                                                                        {hasModifiers ? (
                                                                            <button
                                                                                onClick={() => {
                                                                                    setConfiguringItem(item)
                                                                                    setSelectedVariation(v)
                                                                                    setSelectedModifiers({})
                                                                                    setSpecialRequestInput('')
                                                                                }}
                                                                                className="w-8 h-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition active:scale-95 cursor-pointer"
                                                                            >
                                                                                <Plus size={14} />
                                                                            </button>
                                                                        ) : qty > 0 ? (
                                                                            <div className="flex items-center gap-2">
                                                                                <button
                                                                                    onClick={() => handleQuantityChange(item, v, -1)}
                                                                                    className="w-7 h-7 rounded-lg bg-surface border border-hairline flex items-center justify-center hover:bg-surface-muted transition"
                                                                                >
                                                                                    <Minus size={12} className="text-ink-subtle" />
                                                                                </button>
                                                                                <span className="text-caption font-black text-ink w-4 text-center">{qty}</span>
                                                                                <button
                                                                                    onClick={() => handleQuantityChange(item, v, 1)}
                                                                                    className="w-7 h-7 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition"
                                                                                >
                                                                                    <Plus size={12} />
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => handleQuantityChange(item, v, 1)}
                                                                                className="w-8 h-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition active:scale-95 cursor-pointer"
                                                                            >
                                                                                <Plus size={14} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>

                        {/* Cart Right Panel */}
                        <div className={`w-full md:w-80 border-l border-hairline bg-surface-muted/40 flex flex-col overflow-hidden ${!showMobileCart ? 'hidden md:flex' : ''}`}>
                            <div className="p-4 border-b border-hairline bg-surface-muted/65 flex items-center gap-2 text-ink font-bold shrink-0">
                                {showMobileCart && (
                                    <button
                                        onClick={() => setShowMobileCart(false)}
                                        className="md:hidden mr-1.5 p-1 rounded-lg hover:bg-surface-muted text-ink-subtle hover:text-ink transition active:scale-95"
                                    >
                                        <ArrowLeft size={18} />
                                    </button>
                                )}
                                <ShoppingCart size={16} />
                                <span>Order Basket</span>
                                <span className="ml-auto bg-brand-500/10 text-brand-500 rounded-full px-2 py-0.5 text-xs font-black">
                                    {cart.length}
                                </span>
                            </div>

                            {/* Cart Items List */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {cart.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center text-ink-subtle opacity-75 px-4 py-8">
                                        <ShoppingCart size={32} className="mb-2 text-ink-subtle/50" />
                                        <p className="text-caption font-bold">Cart is empty</p>
                                        <p className="text-[10px] mt-0.5">Click + next to a dish to add it</p>
                                        {showMobileCart && (
                                            <button
                                                onClick={() => setShowMobileCart(false)}
                                                className="md:hidden mt-4 px-4 py-2 rounded-xl bg-surface border border-hairline text-ink text-caption font-bold hover:bg-surface-muted transition active:scale-95 cursor-pointer"
                                            >
                                                Back to Menu
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    cart.map(item => (
                                        <div key={item.id} className="bg-surface rounded-xl border border-hairline p-3 shadow-sm flex flex-col gap-2">
                                            <div className="flex justify-between items-start gap-1">
                                                <div className="min-w-0">
                                                    <p className="text-body font-bold text-ink truncate">{item.name}</p>
                                                    {item.variationName && (
                                                        <p className="text-[10px] text-brand-500 font-extrabold mt-0.5">Size: {item.variationName}</p>
                                                    )}
                                                    {item.modifiers.length > 0 && (
                                                        <p className="text-[9px] text-ink-subtle mt-0.5 truncate">
                                                            + {item.modifiers.map(m => m.name).join(', ')}
                                                        </p>
                                                    )}
                                                    {item.specialRequest && (
                                                        <p className="text-[9px] text-warning-fg bg-warning/5 border border-warning/10 px-1 rounded mt-1 italic">
                                                            &quot;{item.specialRequest}&quot;
                                                        </p>
                                                    )}
                                                </div>
                                                <span className="text-caption font-black text-ink shrink-0">
                                                    Rs. {item.price + item.modifiers.reduce((s, m) => s + m.priceAdjustment, 0)}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between border-t border-hairline pt-2 mt-1">
                                                <button 
                                                    onClick={() => updateQuantity(item.id, -1)}
                                                    className="w-6 h-6 rounded bg-surface border border-hairline flex items-center justify-center hover:bg-surface-muted transition"
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <span className="text-body font-black text-ink">{item.quantity}</span>
                                                <button 
                                                    onClick={() => updateQuantity(item.id, 1)}
                                                    className="w-6 h-6 rounded bg-surface border border-hairline flex items-center justify-center hover:bg-surface-muted transition"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        setCart(prev => {
                                                            const updated = prev.filter(i => i.id !== item.id)
                                                            if (updated.length === 0) {
                                                                setShowMobileCart(false)
                                                            }
                                                            return updated
                                                        })
                                                        toast.success('Removed item')
                                                    }}
                                                    className="w-6 h-6 rounded bg-danger/10 hover:bg-danger-bg text-danger-fg flex items-center justify-center transition"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Cart Summary & Action */}
                            {cart.length > 0 && (
                                <div className="p-4 border-t border-hairline bg-surface shadow-md space-y-3 shrink-0">
                                    <div className="space-y-2">
                                        <div className="relative">
                                            <MessageSquare size={13} className="absolute left-2.5 top-3 text-ink-subtle" />
                                            <input
                                                type="text"
                                                value={customerNote}
                                                onChange={e => setCustomerNote(e.target.value)}
                                                placeholder="Order kitchen notes (optional)..."
                                                className="w-full pl-8 pr-3 py-2 text-[11px] rounded-lg border border-hairline bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                                            />
                                        </div>
                                        <div className="flex justify-between items-center py-1">
                                            <span className="text-caption font-bold text-ink-subtle">Basket Total:</span>
                                            <span className="text-h3 font-black text-ink">Rs. {cartTotal}</span>
                                        </div>
                                    </div>
                                    <Button
                                        block
                                        variant="primary"
                                        icon={submitting ? Loader2 : ShoppingCart}
                                        loading={submitting}
                                        onClick={() => setShowConfirmDialog(true)}
                                        className="py-3 font-bold"
                                    >
                                        Place Order &amp; Print
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Mobile Floating Cart Summary Bar */}
                {!loading && !orderConfirmation && cart.length > 0 && (
                    <div className="md:hidden p-4 border-t border-hairline bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.05)] flex items-center justify-between gap-4 shrink-0">
                        <button
                            onClick={() => setShowMobileCart(true)}
                            className="flex items-center gap-2.5 text-ink hover:opacity-90 active:scale-[0.98] transition text-left cursor-pointer"
                        >
                            <div className="relative w-11 h-11 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500 shrink-0">
                                <ShoppingCart size={20} />
                                <span className="absolute -top-1.5 -right-1.5 bg-brand-500 text-white rounded-full text-[10px] font-black w-5 h-5 flex items-center justify-center shadow-md animate-scale-in">
                                    {cart.reduce((sum, item) => sum + item.quantity, 0)}
                                </span>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider block">Basket Total</span>
                                <span className="text-body font-black text-ink">Rs. {cartTotal}</span>
                            </div>
                        </button>
                        <Button
                            variant="primary"
                            icon={submitting ? Loader2 : ShoppingCart}
                            loading={submitting}
                            onClick={() => setShowConfirmDialog(true)}
                            className="py-3 px-6 font-bold flex-1 max-w-[160px]"
                        >
                            Place Order
                        </Button>
                    </div>
                )}
        </Modal>

            {/* Customization Sub-Modal (Variation & Modifiers Selection) */}
            <Modal
                open={!!configuringItem}
                onClose={() => setConfiguringItem(null)}
                size="md"
                layer="top"
                backdropClassName="!z-[999999]"
                ariaLabel={configuringItem?.name ?? 'Customize item'}
                className="flex flex-col overflow-hidden max-h-[80vh]"
            >
                {configuringItem && (
                    <>
                        <div className="px-5 py-3 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h4 className="text-body font-black text-ink">{configuringItem.name}</h4>
                                <p className="text-[10px] text-ink-subtle">Customize this item</p>
                            </div>
                            <button 
                                onClick={() => setConfiguringItem(null)}
                                className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-4 flex-1">
                            {/* Variations (Sizes) */}
                            {configuringItem.variations && configuringItem.variations.length > 0 && (
                                <div className="space-y-2">
                                    <label className="text-caption font-bold text-ink-subtle uppercase tracking-wider">Select Size</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {configuringItem.variations.map(v => (
                                            <button
                                                key={v.id}
                                                type="button"
                                                onClick={() => setSelectedVariation(v)}
                                                className={`p-3 text-left rounded-xl border text-label transition-all ${
                                                    selectedVariation?.id === v.id
                                                        ? 'border-brand-500 bg-brand-500/5 font-bold text-brand-500'
                                                        : 'border-hairline hover:bg-surface-muted text-ink'
                                                }`}
                                            >
                                                <div className="truncate">{v.name}</div>
                                                <div className="text-[10px] text-ink-subtle mt-0.5">Rs. {v.price}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Modifier Groups */}
                            {configuringItem.modifier_groups && configuringItem.modifier_groups.map(group => {
                                const selected = selectedModifiers[group.id] || []
                                return (
                                    <div key={group.id} className="space-y-2">
                                        <div className="flex justify-between items-baseline">
                                            <label className="text-caption font-bold text-ink-subtle uppercase tracking-wider">
                                                {group.name}
                                            </label>
                                            <span className="text-[10px] text-ink-subtle font-semibold">
                                                {group.min_selection > 0 ? `Required (Min ${group.min_selection})` : 'Optional'}
                                            </span>
                                        </div>
                                        <div className="space-y-1">
                                            {group.modifiers.map(m => {
                                                const isSelected = !!selected.find(x => x.id === m.id)
                                                return (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => toggleModifier(group, m)}
                                                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-label transition-all ${
                                                            isSelected
                                                                ? 'border-brand-500 bg-brand-500/5 font-bold text-brand-500'
                                                                : 'border-hairline hover:bg-surface-muted text-ink'
                                                        }`}
                                                    >
                                                        <span>{m.name}</span>
                                                        <span className="text-[10px] text-ink-subtle">
                                                            {m.price_adjustment > 0 ? `+ Rs. ${m.price_adjustment}` : 'Free'}
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}

                            {/* Item Notes */}
                            <div className="space-y-2">
                                <label className="text-caption font-bold text-ink-subtle uppercase tracking-wider">Special Requests</label>
                                <input
                                    type="text"
                                    value={specialRequestInput}
                                    onChange={e => setSpecialRequestInput(e.target.value)}
                                    placeholder="e.g. Extra spicy, no onions..."
                                    className="w-full px-3 py-2 text-label rounded-xl border border-hairline bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                            </div>
                        </div>

                        <div className="p-4 border-t border-hairline bg-surface-muted/20 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setConfiguringItem(null)}
                                className="flex-1 py-2.5 rounded-xl border border-hairline bg-surface hover:bg-surface-muted text-ink text-label font-bold transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleAddConfiguredItem}
                                className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-label font-bold transition shadow-sm"
                            >
                                Add to Cart
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            {/* Pre-submission confirmation — stops a misclick on "Place Order" from
                sending a wrong order straight to the kitchen. */}
            <Modal
                open={showConfirmDialog}
                onClose={() => setShowConfirmDialog(false)}
                size="md"
                layer="top"
                backdropClassName="!z-[9999999]"
                ariaLabel="Confirm order"
                className="flex flex-col overflow-hidden max-h-[80vh]"
            >
                <div className="px-5 py-4 border-b border-hairline bg-surface-muted/50">
                    <h4 className="text-body font-black text-ink">Confirm order</h4>
                    <p className="text-[10px] text-ink-subtle mt-0.5">
                        Sends to the kitchen and adds to {bookingId ? 'the room bill' : `Table ${selectedSession?.label ?? ''}`}.
                    </p>
                </div>

                <div className="p-5 overflow-y-auto space-y-1.5 flex-1">
                    {cart.map(item => (
                        <div key={item.id} className="flex justify-between text-caption text-ink-muted">
                            <span>{item.name} <span className="text-brand-500 font-bold">×{item.quantity}</span></span>
                            <span className="font-semibold tabular-nums">
                                Rs. {(item.price + item.modifiers.reduce((s, m) => s + m.priceAdjustment, 0)) * item.quantity}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="px-5 py-3 border-t border-hairline flex justify-between items-center bg-surface-muted/20">
                    <span className="text-caption font-bold text-ink-subtle uppercase">Total</span>
                    <span className="text-h3 font-black text-ink">Rs. {cartTotal}</span>
                </div>

                <div className="p-4 border-t border-hairline bg-surface-muted/20 flex gap-2">
                    <button
                        type="button"
                        onClick={() => setShowConfirmDialog(false)}
                        className="flex-1 py-2.5 rounded-xl border border-hairline bg-surface hover:bg-surface-muted text-ink text-label font-bold transition"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handlePlaceOrder}
                        disabled={submitting}
                        className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-label font-bold transition shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                        {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                        Confirm &amp; Place Order
                    </button>
                </div>
            </Modal>
        </>
    )
}

// Internal Button sub-component to prevent importing issues
function Button({
    children,
    variant = 'primary',
    block = false,
    loading = false,
    disabled = false,
    icon: Icon,
    className = '',
    onClick,
    ...props
}: {
    children: React.ReactNode
    variant?: 'primary' | 'secondary'
    block?: boolean
    loading?: boolean
    disabled?: boolean
    icon?: any
    className?: string
    onClick?: () => void
    [key: string]: any
}) {
    const baseClass = "relative flex items-center justify-center gap-2 text-label font-black rounded-xl transition-all select-none active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
    const variantClass = variant === 'primary' 
        ? "bg-brand-500 hover:bg-brand-600 text-white shadow-md shadow-brand-500/20" 
        : "bg-surface hover:bg-surface-muted border border-hairline text-ink-subtle hover:text-ink"
    const sizeClass = "px-4 py-2.5"
    const widthClass = block ? "w-full" : ""

    return (
        <button
            disabled={disabled || loading}
            onClick={onClick}
            className={`${baseClass} ${variantClass} ${sizeClass} ${widthClass} ${className}`}
            {...props}
        >
            {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
            {children}
        </button>
    )
}
