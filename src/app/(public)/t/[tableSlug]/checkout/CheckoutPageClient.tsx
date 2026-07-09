'use client'

import { useCartStore, getCartItemKey } from '@/lib/stores/cart'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useRouter } from 'next/navigation'
import { placeOrder } from './actions'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Trash2, Plus, Minus, Loader2 } from 'lucide-react'
import BottomNavbar from '@/components/customer/BottomNavbar'
import PromoCodeInput from '@/components/customer/PromoCodeInput'
import LoyaltyPanel from '@/components/customer/LoyaltyPanel'
import SplitBillModal from '@/components/customer/SplitBillModal'
import { useFeatures, useCurrency } from '@/lib/contexts/FeatureContext'
import { useParams } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { playVoice } from '@/lib/voice'

export default function CheckoutPageClient({ isHotelRoom = true }: { isHotelRoom?: boolean }) {
    const params = useParams<{ tableSlug: string }>()
    const money = useCurrency()
    const features = useFeatures()
    const items = useHydratedStore(useCartStore, (s) => s.items)
    const sessionId = useHydratedStore(useCartStore, (s) => s.sessionId)
    const restaurantSlug = useHydratedStore(useCartStore, (s) => s.restaurantSlug)
    const restaurantId = useHydratedStore(useCartStore, (s) => s.restaurantId)
    const promoCode = useHydratedStore(useCartStore, (s) => s.promoCode)
    const promoDiscount = useHydratedStore(useCartStore, (s) => s.promoDiscount)
    const loyaltyMember = useHydratedStore(useCartStore, (s) => s.loyaltyMember)
    const loyaltyDiscount = useHydratedStore(useCartStore, (s) => s.loyaltyDiscount)
    const removeItem = useCartStore((s) => s.removeItem)
    const updateQuantity = useCartStore((s) => s.updateQuantity)
    const totalAmount = useCartStore((s) => s.totalAmount)
    const totalItems = useCartStore((s) => s.totalItems)
    const finalTotal = useCartStore((s) => s.finalTotal)
    const clearCart = useCartStore((s) => s.clearCart)
    const setPromo = useCartStore((s) => s.setPromo)
    const setLoyaltyMember = useCartStore((s) => s.setLoyaltyMember)
    const setLoyaltyDiscount = useCartStore((s) => s.setLoyaltyDiscount)
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const isSubmittingRef = useRef(false)
    const [showSplit, setShowSplit] = useState(false)
    const router = useRouter()

    const storeIdempotencyKey = useHydratedStore(useCartStore, (s) => s.idempotencyKey)
    const [fallbackKey] = useState(() => `fallback-cr-${Date.now()}`)
    const idempotencyKey = storeIdempotencyKey || fallbackKey

    const [stayBilling, setStayBilling] = useState<any | null>(null)
    // The server already knows whether this table is a hotel room (it queried the
    // same row for the IP check) — only the non-hotel majority case gets to skip
    // this fetch/spinner entirely; a hotel room still needs the full billing detail.
    const [loadingStay, setLoadingStay] = useState(isHotelRoom)
    const [stayBillingFailed, setStayBillingFailed] = useState(false)

    const fetchStayBilling = () => {
        if (!params.tableSlug) return
        fetch(`/api/rooms/stay-billing?tableSlug=${params.tableSlug}`)
            .then(res => res.json())
            .then(data => {
                if (data.isHotelRoom) {
                    setStayBilling(data)
                } else {
                    // The server already told us this is a hotel room — a response
                    // that disagrees means something's wrong server-side, not that
                    // it's actually safe to fall through to online payment.
                    setStayBillingFailed(true)
                }
            })
            .catch(() => setStayBillingFailed(true))
            .finally(() => setLoadingStay(false))
    }

    const retryStayBilling = () => {
        setStayBillingFailed(false)
        setLoadingStay(true)
        fetchStayBilling()
    }

    useEffect(() => {
        if (!isHotelRoom) return
        fetchStayBilling()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHotelRoom, params.tableSlug])

    if (loadingStay) {
        return (
            <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
            </div>
        )
    }

    // A hotel room must never fall through to the normal cart/online-payment
    // checkout below — if the bill failed to load, show a retry state instead
    // of silently exposing payment options this room isn't supposed to have.
    if (isHotelRoom && stayBillingFailed) {
        return (
            <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4">
                <div className="text-center space-y-4 max-w-sm">
                    <p className="text-sm font-semibold text-ink-subtle">
                        Couldn&apos;t load your room bill. Please check your connection and try again.
                    </p>
                    <button
                        onClick={retryStayBilling}
                        className="bg-[var(--color-primary)] text-white font-bold text-xs px-5 py-3 rounded-xl active:scale-95 transition shadow-md"
                    >
                        Retry
                    </button>
                </div>
            </div>
        )
    }

    if (stayBilling) {
        if (stayBilling.hasActiveBooking === false) {
            return (
                <div className="min-h-screen bg-surface-muted pb-32 text-ink font-sans flex flex-col justify-between">
                    <div>
                        {/* Header */}
                        <header className="bg-surface px-4 py-4 shadow-sm sticky top-0 z-20 flex items-center gap-3">
                            <button onClick={() => router.back()} className="p-2 -ml-2 text-ink-muted rounded-full active:bg-surface-muted">
                                <ArrowLeft size={20} />
                            </button>
                            <h1 className="text-xl font-bold text-ink">Room Bill Details</h1>
                        </header>

                        <main className="max-w-xl mx-auto px-4 mt-12 text-center space-y-4">
                            <div className="text-ink-subtle flex justify-center">
                                <ShoppingBagIcon className="w-16 h-16 opacity-50" />
                            </div>
                            <h2 className="text-xl font-black text-ink">No Active Stay</h2>
                            <p className="text-sm font-semibold text-ink-subtle max-w-sm mx-auto">
                                There is no active stay/booking checked in to Room {stayBilling.roomNumber} at the moment.
                            </p>
                            <button
                                onClick={() => router.back()}
                                className="bg-[var(--color-primary)] text-white font-bold text-xs px-5 py-3 rounded-xl active:scale-95 transition shadow-md"
                            >
                                Go Back
                            </button>
                        </main>
                    </div>

                    <BottomNavbar activeTab="pay" />
                </div>
            )
        }

        return (
            <div className="min-h-screen bg-surface-muted pb-64 text-ink font-sans flex flex-col justify-between">
                <div>
                    {/* Header */}
                    <header className="bg-surface px-4 py-4 shadow-sm sticky top-0 z-20 flex items-center gap-3">
                        <button onClick={() => router.back()} className="p-2 -ml-2 text-ink-muted rounded-full active:bg-surface-muted">
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="text-xl font-bold text-ink">Room Bill Details</h1>
                    </header>

                    <main className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                        {/* Guest & Stay Info Card */}
                        <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline p-5">
                            <div className="flex items-center justify-between border-b border-hairline pb-3 mb-4">
                                <div>
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest Name</p>
                                    <p className="text-base font-black text-ink">{stayBilling.guestName}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Room</p>
                                    <p className="text-base font-black text-[var(--color-primary)]">Room {stayBilling.roomNumber}</p>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 text-xs font-semibold text-ink-muted">
                                <div>
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Check In</p>
                                    <p>{new Date(stayBilling.checkIn).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Check Out</p>
                                    <p>{new Date(stayBilling.checkOut).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
                                </div>
                            </div>
                        </div>

                        {/* Stay Billing Breakdown */}
                        <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline overflow-hidden">
                            <div className="p-4 border-b border-hairline bg-surface-muted/50">
                                <h2 className="font-semibold text-ink-muted">Account Statement Summary</h2>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {/* Room Stay Cost */}
                                <div className="p-4 flex justify-between items-center text-sm">
                                    <div>
                                        <p className="font-bold text-ink">Room Stay Cost</p>
                                        <p className="text-[10px] text-ink-subtle font-semibold">
                                            {money(stayBilling.roomBasePrice)} × {stayBilling.nights} night{stayBilling.nights > 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    <span className="font-bold text-ink tabular-nums">{money(stayBilling.stayCost)}</span>
                                </div>

                                {/* Food Orders */}
                                {stayBilling.foodOrders.length > 0 && (
                                    <div className="p-4 space-y-2">
                                        <p className="font-bold text-sm text-indigo-600">Restaurant Orders (QR & Dining)</p>
                                        <div className="space-y-2 pl-3 border-l-2 border-indigo-100">
                                            {stayBilling.foodOrders.map((o: any) => (
                                                <div key={o.id} className="flex justify-between text-xs text-ink-muted">
                                                    <span className="font-medium">Order #{o.id.substring(0, 6).toUpperCase()}</span>
                                                    <span className="tabular-nums font-bold">{money(o.total)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Additional Charges */}
                                {stayBilling.additionalCharges.length > 0 && (
                                    <div className="p-4 space-y-2">
                                        <p className="font-bold text-sm text-amber-600">Extra Room Charges</p>
                                        <div className="space-y-2 pl-3 border-l-2 border-amber-100">
                                            {stayBilling.additionalCharges.map((c: any) => (
                                                <div key={c.id} className="flex justify-between text-xs text-ink-muted">
                                                    <span className="font-medium capitalize">{c.description} ({c.chargeType})</span>
                                                    <span className="tabular-nums font-bold">{money(c.amount)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Statement Information Note */}
                        <div className="bg-orange-50 border border-orange-100 rounded-[var(--border-radius)] p-4 text-xs font-semibold text-orange-800 leading-relaxed">
                            💡 <strong>Information:</strong> This is a statement of your room stay account for review. Direct online payments are disabled here; please settle the final balance at the front desk when checking out.
                        </div>
                    </main>
                </div>

                {/* Persistent Bottom Totals & Balance Bar */}
                <div className="fixed bottom-[88px] left-0 right-0 p-4 z-30 bg-surface border-t border-hairline-strong shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
                    <div className="max-w-xl mx-auto space-y-1.5">
                        <div className="flex justify-between text-xs text-ink-subtle">
                            <span>Subtotal</span>
                            <span className="font-semibold">{money(stayBilling.grandTotal)}</span>
                        </div>
                        {stayBilling.advancePaid > 0 && (
                            <div className="flex justify-between text-xs text-green-600">
                                <span>Advance Paid</span>
                                <span className="font-semibold">-{money(stayBilling.advancePaid)}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-2 border-t border-hairline">
                            <span className="text-ink font-bold">Balance Due</span>
                            <span className="text-2xl font-black text-[var(--color-primary)] tabular-nums">{money(stayBilling.balanceDue)}</span>
                        </div>
                    </div>
                </div>

                <BottomNavbar activeTab="pay" />
            </div>
        )
    }



    if (items.length === 0) {
        return (
            <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4">
                <div className="text-center">
                    <div className="text-ink-subtle mb-4 flex justify-center">
                        <ShoppingBagIcon className="w-16 h-16" />
                    </div>
                    <h2 className="text-xl font-medium text-ink mb-2">Your cart is empty</h2>
                    <button
                        onClick={() => router.back()}
                        className="text-[var(--color-primary)] font-medium"
                    >
                        Go back to menu
                    </button>
                </div>
            </div>
        )
    }

    const handleCheckout = async () => {
        // Re-entrancy guard: the disabled state only applies on the next render,
        // so a rapid double-tap could otherwise fire two orders before then.
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

        const res = await placeOrder(
            sessionId,
            restaurantSlug || params.tableSlug,
            items,
            note,
            promoCode?.code || null,
            loyaltyMember?.id || null,
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
        } else if (res.orderId) {
            toast.success("Order placed successfully!")
            playVoice('customer_order_placed')
            clearCart()
            router.push(`/t/${params.tableSlug}/order/${res.orderId}`)
        }
    }

    return (
        <div className="min-h-screen bg-surface-muted pb-64">
            {/* Header */}
            <header className="bg-surface px-4 py-4 shadow-sm sticky top-0 z-20 flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 -ml-2 text-ink-muted rounded-full active:bg-surface-muted">
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-xl font-semibold text-ink">Checkout</h1>
            </header>

            <main className="max-w-xl mx-auto px-4 mt-6">
                <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline overflow-hidden mb-6">
                    <div className="p-4 border-b border-hairline bg-surface-muted/50">
                        <h2 className="font-semibold text-ink-muted">Order Summary ({totalItems()} items)</h2>
                    </div>

                    <ul className="divide-y divide-gray-100">
                        {items.map((item) => {
                            const key = getCartItemKey(item)
                            const modTotal = (item.modifiers || []).reduce((s, m) => s + m.priceAdjustment, 0)
                            return (
                            <li key={key} className="p-4 flex gap-4 bg-surface">
                                <div className="flex-1">
                                    <h3 className="font-medium text-ink">{item.name}</h3>
                                    {item.modifiers && item.modifiers.length > 0 && (
                                        <p className="text-xs text-ink-subtle mt-0.5">
                                            {item.modifiers.map(m => m.name).join(', ')}
                                        </p>
                                    )}
                                    <div className="text-[var(--color-primary)] font-medium mt-1">
                                        {money((item.price + modTotal) * item.quantity)}
                                    </div>
                                </div>

                                <div className="flex flex-col items-end justify-between">
                                    <div className="flex items-center gap-3 bg-surface-muted rounded-full p-1 border border-hairline-strong">
                                        <button
                                            onClick={() => item.quantity === 1 ? removeItem(key) : updateQuantity(key, item.quantity - 1)}
                                            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface shadow-sm text-ink-muted active:bg-surface-muted"
                                        >
                                            {item.quantity === 1 ? <Trash2 size={16} className="text-red-500" /> : <Minus size={16} />}
                                        </button>
                                        <span className="font-medium w-4 text-center">{item.quantity}</span>
                                        <button
                                            onClick={() => updateQuantity(key, item.quantity + 1)}
                                            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-primary)] shadow-sm text-white"
                                        >
                                            <Plus size={16} />
                                        </button>
                                    </div>
                                </div>
                            </li>
                            )
                        })}
                    </ul>
                </div>

                {/* Note */}
                <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline p-4 mb-6">
                    <label htmlFor="note" className="block font-semibold text-ink-muted mb-2">Add a note to kitchen</label>
                    <textarea
                        id="note"
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full border border-hairline-strong rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent resize-none"
                        placeholder="E.g. No onions, extra spicy..."
                    />
                </div>

                {/* Promo Code — shown when promos OR loyalty is enabled */}
                {restaurantId && (features.promosEnabled !== false) && (
                    <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline p-4 mb-6">
                        <PromoCodeInput
                            restaurantId={restaurantId}
                            subtotal={totalAmount()}
                            onApply={(promo, discount) => setPromo(promo, discount)}
                            onRemove={() => setPromo(null, 0)}
                            appliedPromo={promoCode}
                        />
                    </div>
                )}

                {/* Loyalty — gated by feature flag */}
                {restaurantId && features.loyaltyEnabled && (
                    <div className="bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline p-4 mb-6">
                        <LoyaltyPanel
                            restaurantId={restaurantId}
                            onMemberSet={setLoyaltyMember}
                            onRedeemDiscount={setLoyaltyDiscount}
                            activeMember={loyaltyMember}
                        />
                    </div>
                )}

            </main>

            {/* Persistent Bottom Checkout Bar */}
            <div className="fixed bottom-[88px] left-0 right-0 p-4 z-30 bg-surface border-t border-hairline-strong shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
                <div className="max-w-xl mx-auto">
                    <div className="space-y-1 mb-4">
                        <div className="flex justify-between text-sm text-ink-subtle">
                            <span>Subtotal</span>
                            <span>{money(totalAmount())}</span>
                        </div>
                        {promoDiscount > 0 && (
                            <div className="flex justify-between text-sm text-green-600">
                                <span>Promo ({promoCode?.code})</span>
                                <span>-{money(promoDiscount)}</span>
                            </div>
                        )}
                        {loyaltyDiscount > 0 && (
                            <div className="flex justify-between text-sm text-indigo-600">
                                <span>Loyalty Reward</span>
                                <span>-{money(loyaltyDiscount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-1 border-t border-hairline">
                            <span className="text-ink-muted font-medium">Total to pay</span>
                            <span className="text-2xl font-bold text-ink">{money(finalTotal())}</span>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-3">
                        {features.splitBillingEnabled && (
                            <button
                                onClick={() => setShowSplit(true)}
                                disabled={!sessionId}
                                className="flex-1 border border-hairline-strong text-ink-muted font-medium rounded-xl py-3 text-sm hover:bg-surface-muted disabled:opacity-50"
                            >
                                Split Bill
                            </button>
                        )}
                    </div>

                    <button
                        onClick={handleCheckout}
                        disabled={isSubmitting}
                        className="w-full bg-[var(--color-primary)] text-white font-medium rounded-xl py-4 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-70 disabled:active:scale-100 shadow-lg shadow-[var(--color-primary)]/20"
                    >
                        {isSubmitting ? (
                            <><Loader2 className="animate-spin" size={20} /> Sending to Kitchen...</>
                        ) : (
                            'Place Order'
                        )}
                    </button>
                </div>
            </div>
            {showSplit && sessionId && (
                <SplitBillModal
                    sessionId={sessionId}
                    totalAmount={finalTotal()}
                    onClose={() => setShowSplit(false)}
                />
            )}
            <BottomNavbar activeTab="pay" />
        </div>
    )
}

function ShoppingBagIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
    )
}
