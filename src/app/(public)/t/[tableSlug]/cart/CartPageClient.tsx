'use client'

import { useCartStore, getCartItemKey } from '@/lib/stores/cart'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { ChevronLeft, Plus, Minus, Pencil } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { placeOrder } from '@/app/(public)/t/[tableSlug]/checkout/actions'
import { toast } from 'react-hot-toast'
import { playVoice } from '@/lib/voice'
import OrderConfirmModal from '@/components/customer/OrderConfirmModal'
import ItemDetailView from '@/components/customer/ItemDetailView'
import { getMenuItemsForCart } from './actions'
import type { MenuItem, CartItemModifier } from '@/types/database'
import BottomNavbar from '@/components/customer/BottomNavbar'

export default function CartPageClient({ params }: { params: { tableSlug: string } }) {
    const router = useRouter()
    const money = useCurrency()
    const items = useHydratedStore(useCartStore, (s) => s.items) || []
    const sessionId = useHydratedStore(useCartStore, (s) => s.sessionId)
    const storeSlug = useHydratedStore(useCartStore, (s) => s.restaurantSlug)
    const restaurantId = useHydratedStore(useCartStore, (s) => s.restaurantId)
    const updateQuantity = useCartStore((s) => s.updateQuantity)
    const removeItem = useCartStore((s) => s.removeItem)
    const addItem = useCartStore((s) => s.addItem)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [showNoteModal, setShowNoteModal] = useState(false)
    const [globalNote, setGlobalNote] = useState('')
    const isSubmittingRef = useRef(false)

    // Load full menu items to allow editing via bottom sheet
    const [menuItems, setMenuItems] = useState<MenuItem[]>([])
    const [activeEditItem, setActiveEditItem] = useState<MenuItem | null>(null)
    const [activeEditCartKey, setActiveEditCartKey] = useState<string | null>(null)

    useEffect(() => {
        if (!restaurantId) return
        getMenuItemsForCart(restaurantId)
            .then(setMenuItems)
            .catch((err) => console.error('Failed to load menu for cart editing:', err))
    }, [restaurantId])

    const storeIdempotencyKey = useHydratedStore(useCartStore, (s) => s.idempotencyKey)
    const [fallbackKey] = useState(() => `fallback-cart-${Date.now()}`)
    const idempotencyKey = storeIdempotencyKey || fallbackKey

    const count = items.reduce((acc, item) => acc + item.quantity, 0)
    const totalAmount = items.reduce((total, item) => {
        const modifierTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.priceAdjustment, 0)
        return total + (item.price + modifierTotal) * item.quantity
    }, 0)

    const slug = storeSlug || params.tableSlug || 'menu'

    const handleIncrement = (cartKey: string, currentQty: number) => {
        updateQuantity(cartKey, currentQty + 1)
    }

    const handleDecrement = (cartKey: string, currentQty: number) => {
        if (currentQty > 1) {
            updateQuantity(cartKey, currentQty - 1)
        } else {
            removeItem(cartKey)
        }
    }

    const handleEditCartItem = (cartItem: any) => {
        const matchedItem = menuItems.find(m => m.id === cartItem.menuItemId)
        if (matchedItem) {
            setActiveEditItem(matchedItem)
            setActiveEditCartKey(getCartItemKey(cartItem))
        } else {
            toast.error("Unable to edit this item right now.")
        }
    }

    const handleSaveEdit = (newModifiers: CartItemModifier[], newQty: number, newRequest: string) => {
        if (!activeEditCartKey || !activeEditItem) return

        const oldKey = activeEditCartKey
        const newKey = getCartItemKey({ menuItemId: activeEditItem.id, modifiers: newModifiers })

        if (oldKey === newKey) {
            // Options are the same, just update quantity and special request note
            updateQuantity(oldKey, newQty)
            useCartStore.getState().updateSpecialRequest(oldKey, newRequest)
        } else {
            // Options changed: remove old item, add new item
            removeItem(oldKey)
            const existing = items.find(i => getCartItemKey(i) === newKey)
            addItem({
                menuItemId: activeEditItem.id,
                name: activeEditItem.name,
                price: activeEditItem.price,
                imageUrl: activeEditItem.image_url || undefined,
                modifiers: newModifiers,
            })
            updateQuantity(newKey, existing ? existing.quantity + newQty : newQty)
            useCartStore.getState().updateSpecialRequest(newKey, newRequest)
        }

        setActiveEditItem(null)
        setActiveEditCartKey(null)
    }

    const handlePlaceOrder = async () => {
        if (isSubmittingRef.current) {
            toast.error("Hold tight! We are already sending your order to the kitchen.")
            return
        }

        if (!sessionId) {
            toast.error("No active session found. Please scan the QR code again.")
            return
        }

        isSubmittingRef.current = true
        setIsSubmitting(true)

        const cartItems = useCartStore.getState().items
        const clearCart = useCartStore.getState().clearCart

        const res = await placeOrder(
            sessionId,
            slug,
            cartItems,
            globalNote.trim() || undefined,
            undefined,
            undefined,
            idempotencyKey
        )

        if (res.error) {
            if (res.error.includes('OUT_OF_STOCK')) {
                toast.error("Sorry, an item just went out of stock while you were ordering!", { duration: 5000 })
            } else {
                toast.error(res.error)
            }
            isSubmittingRef.current = false
            setIsSubmitting(false)
            setShowConfirm(false)
        } else if (res.orderId) {
            toast.success("Order placed successfully!")
            playVoice('customer_order_placed')
            useActiveOrders.getState().addActiveOrder({ id: res.orderId, type: 'dine_in', slug, sessionToken: sessionId || undefined })
            clearCart()
            router.push(`/t/${slug}/order/${res.orderId}`)
        }
    }

    // Empty cart state
    if (count === 0) {
        return (
            <div className="min-h-screen bg-surface-muted flex flex-col font-sans pb-36">
                <header className="bg-surface border-b border-hairline sticky top-0 z-20 px-4 py-3.5">
                    <div className="max-w-2xl mx-auto flex items-center gap-3">
                        <button
                            onClick={() => router.back()}
                            className="w-9 h-9 rounded-full bg-surface border border-hairline-strong flex items-center justify-center active:scale-95 transition shadow-sm"
                        >
                            <ChevronLeft size={18} className="text-ink-muted" />
                        </button>
                        <h1 className="text-base font-bold text-ink">Your Cart</h1>
                    </div>
                </header>

                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-surface-muted flex items-center justify-center mb-4">
                        <span className="text-2xl">🛒</span>
                    </div>
                    <h2 className="text-base font-bold text-ink mb-1">Your cart is empty</h2>
                    <p className="text-xs text-ink-subtle font-semibold mb-6">
                        Browse the menu and add some delicious items!
                    </p>
                    <button
                        onClick={() => router.back()}
                        className="bg-[var(--color-primary)] text-white font-bold text-xs px-5 py-3 rounded-xl active:scale-95 transition shadow-md shadow-orange-600/10"
                    >
                        Browse Menu
                    </button>
                </div>
                <BottomNavbar activeTab="cart" />
            </div>
        )
    }

    const editTargetItem = activeEditCartKey ? items.find(i => getCartItemKey(i) === activeEditCartKey) : null

    return (
        <div className="min-h-screen bg-surface-muted pb-64 text-ink font-sans flex flex-col justify-between">
            <div>
                {/* Header */}
                <header className="bg-surface border-b border-hairline sticky top-0 z-20 px-4 py-3">
                    <div className="max-w-2xl mx-auto flex items-center gap-3">
                        <button
                            onClick={() => router.back()}
                            className="w-9 h-9 rounded-full bg-surface border border-hairline-strong flex items-center justify-center active:scale-95 transition shadow-sm"
                        >
                            <ChevronLeft size={18} className="text-ink-muted" />
                        </button>
                        <div>
                            <h1 className="text-base font-bold text-ink leading-none">Your Cart</h1>
                            <p className="text-[11px] text-ink-subtle font-semibold mt-0.5">
                                Review and confirm your order
                            </p>
                        </div>
                    </div>
                </header>

                {/* Cart Items */}
                <div className="max-w-2xl mx-auto px-4 pt-4">
                    <div className="space-y-3">
                        {items.map((item) => {
                            const cartKey = getCartItemKey(item)
                            const modifierTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.priceAdjustment, 0)
                            const unitPrice = item.price + modifierTotal
                            const lineTotal = unitPrice * item.quantity

                            // Build options descriptive label (e.g. "2 Small Chicken Pizza")
                            const modifierNames = (item.modifiers || []).map(m => m.name).join(', ')
                            const varLabel = item.variationName || ''
                            const parts = [item.quantity.toString(), varLabel, modifierNames, item.name].filter(Boolean)
                            const optionsLabel = parts.join(' ')

                            return (
                                <div
                                    key={cartKey}
                                    className="bg-surface rounded-2xl border border-hairline-strong p-4 flex gap-4 items-start shadow-sm"
                                >
                                    {/* Product Image */}
                                    <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-surface-muted shrink-0">
                                        {item.imageUrl ? (
                                            <Image
                                                src={item.imageUrl}
                                                alt={item.name}
                                                fill
                                                className="object-cover"
                                                sizes="64px"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <span className="text-xl">🍽️</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Info Panel */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-[15px] font-bold text-ink leading-tight">
                                            {item.name}{item.variationName ? ` – ${item.variationName}` : ''}
                                        </h3>
                                        {(modifierNames || varLabel) && (
                                            <p className="text-xs text-ink-subtle font-medium mt-1 leading-snug line-clamp-2">
                                                {[varLabel, modifierNames].filter(Boolean).join(' · ')}
                                            </p>
                                        )}
                                        <button
                                            onClick={() => handleEditCartItem(item)}
                                            className="text-[var(--color-primary)] hover:opacity-80 font-bold text-xs flex items-center gap-1.5 mt-2.5 transition active:scale-95"
                                        >
                                            <Pencil size={12} /> Edit
                                        </button>
                                    </div>

                                    {/* Controls & Price */}
                                    <div className="flex flex-col items-end justify-between min-h-[72px] shrink-0">
                                        {/* Quantity control */}
                                        <div className="flex items-center gap-3 rounded-full px-2.5 py-1.5 text-[var(--color-primary)] bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/20 shrink-0">
                                            <button
                                                onClick={() => handleDecrement(cartKey, item.quantity)}
                                                aria-label="Decrease quantity"
                                                className="active:scale-90 transition hover:opacity-70"
                                            >
                                                <Minus size={13} strokeWidth={3} />
                                            </button>
                                            <span className="min-w-[14px] text-center tabular-nums text-sm font-black text-ink">
                                                {item.quantity}
                                            </span>
                                            <button
                                                onClick={() => handleIncrement(cartKey, item.quantity)}
                                                aria-label="Increase quantity"
                                                className="active:scale-90 transition hover:opacity-70"
                                            >
                                                <Plus size={13} strokeWidth={3} />
                                            </button>
                                        </div>

                                        {/* Price */}
                                        <span className="text-sm font-black text-ink mt-2 tabular-nums">
                                            {money(lineTotal)}
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Action Buttons below list */}
                    <div className="flex gap-3 mt-5">
                        <button
                            onClick={() => router.back()}
                            className="flex-1 border border-hairline-strong bg-surface text-ink-muted hover:bg-surface-muted font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-xs transition active:scale-95"
                        >
                            <Plus size={13} className="stroke-[3px]" /> Add Items
                        </button>
                        <button
                            onClick={() => setShowNoteModal(true)}
                            className="flex-1 border border-hairline-strong bg-surface text-ink-muted hover:bg-surface-muted font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 text-xs transition active:scale-95"
                        >
                            ✍️ Cooking Requests
                        </button>
                    </div>

                    {/* Order Summary */}
                    <div className="bg-surface rounded-2xl border border-hairline-strong shadow-sm mt-6 p-4 space-y-2.5">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-ink-subtle font-medium">Subtotal · {count} item{count !== 1 ? 's' : ''}</span>
                            <span className="text-ink font-bold tabular-nums">{money(totalAmount)}</span>
                        </div>
                        <div className="flex justify-between items-center pt-2.5 border-t border-hairline">
                            <span className="text-base font-bold text-ink">Total</span>
                            <span className="text-lg font-black text-ink tabular-nums">{money(totalAmount)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sticky Footer PLACE ORDER Bar — shows the amount inline */}
            <div
                className="fixed bottom-[88px] left-0 right-0 z-30 bg-surface/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(0,0,0,0.06)] px-4 py-4 border-t border-hairline"
            >
                <div className="max-w-2xl mx-auto">
                    <button
                        onClick={() => setShowConfirm(true)}
                        disabled={isSubmitting || !sessionId}
                        className="w-full bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-60 text-white font-bold py-4 rounded-2xl flex items-center justify-between px-5 text-sm shadow-md shadow-[var(--color-primary)]/20 active:scale-[0.98] transition-all"
                    >
                        <span className="flex items-center gap-2">
                            <span className="bg-surface/20 rounded-full px-2 py-0.5 text-xs tabular-nums">{count}</span>
                            Place Order
                        </span>
                        <span className="text-base font-black tabular-nums">{money(totalAmount)}</span>
                    </button>
                    {!sessionId && (
                        <p className="text-[11px] text-amber-600 font-semibold text-center mt-2">
                            No active session — scan the table QR again to order.
                        </p>
                    )}
                </div>
            </div>

            {/* Global Cooking Note Modal */}
            {showNoteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
                    <div className="bg-surface rounded-2xl max-w-sm w-full p-5 border border-hairline shadow-xl flex flex-col gap-4 animate-scale-in">
                        <div>
                            <h3 className="text-sm font-bold text-ink">Add Cooking Requests</h3>
                            <p className="text-[11px] text-ink-subtle font-semibold mt-0.5">
                                Specify instructions for the chef (applies to the whole order)
                            </p>
                        </div>
                        <textarea
                            value={globalNote}
                            onChange={(e) => setGlobalNote(e.target.value)}
                            placeholder="e.g. Make it extra spicy, bring together with drinks..."
                            className="w-full text-xs border border-hairline-strong rounded-xl p-3 focus:outline-none focus:border-[var(--color-primary)] min-h-[90px] resize-none"
                        />
                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setShowNoteModal(false)}
                                className="flex-1 py-2.5 rounded-xl border border-hairline-strong text-ink-subtle font-bold text-xs active:scale-95 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => setShowNoteModal(false)}
                                className="flex-1 py-2.5 rounded-xl bg-[var(--color-primary)] text-white font-bold text-xs active:scale-95 transition"
                            >
                                Save Request
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {showConfirm && (
                <OrderConfirmModal
                    itemCount={count}
                    totalAmount={totalAmount}
                    isPlacing={isSubmitting}
                    onConfirm={handlePlaceOrder}
                    onCancel={() => setShowConfirm(false)}
                />
            )}

            {/* Item Edit sheet */}
            {activeEditItem && editTargetItem && (
                <ItemDetailView
                    item={activeEditItem}
                    comboItems={[]}
                    menuItems={menuItems}
                    sessionId={sessionId || undefined}
                    restaurantSlug={slug}
                    restaurantId={restaurantId || undefined}
                    onClose={() => {
                        setActiveEditItem(null)
                        setActiveEditCartKey(null)
                    }}
                    initialQuantity={editTargetItem.quantity}
                    initialCookingRequest={editTargetItem.specialRequest}
                    initialModifiers={editTargetItem.modifiers}
                    onSaveEdit={handleSaveEdit}
                />
            )}
            <BottomNavbar activeTab="cart" />
        </div>
    )
}
