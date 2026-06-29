'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createTakeoutOrder, createDeliveryOrder } from '@/app/api/takeout/actions'
import { useCartStore } from '@/lib/stores/cart'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import PromoCodeInput from '@/components/customer/PromoCodeInput'
import type { PromoCode } from '@/types/database'
import { ArrowLeft, Clock, Loader2, ShoppingBag } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface TakeoutFormProps {
    restaurantId: string
    restaurantName: string
    restaurantSlug: string
}

export default function TakeoutForm({ restaurantId, restaurantName, restaurantSlug }: TakeoutFormProps) {
    const items = useHydratedStore(useCartStore, (s) => s.items)
    const money = useCurrency()
    const totalAmount = useCartStore((s) => s.totalAmount)
    const clearCart = useCartStore((s) => s.clearCart)

    const [orderMode, setOrderMode] = useState<'takeaway' | 'delivery'>('takeaway')
    const [customerName, setCustomerName] = useState('')
    const [customerPhone, setCustomerPhone] = useState('')
    const [customerEmail, setCustomerEmail] = useState('')
    const [deliveryAddress, setDeliveryAddress] = useState('')
    const [pickupTime, setPickupTime] = useState('')
    const [note, setNote] = useState('')
    const [promo, setPromo] = useState<PromoCode | null>(null)
    const [promoDiscount, setPromoDiscount] = useState(0)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const router = useRouter()

    // Generate time slots (every 15 min for next 4 hours)
    const timeSlots: string[] = []
    const now = new Date()
    const start = new Date(now.getTime() + 30 * 60 * 1000) // 30 min from now
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0)
    for (let i = 0; i < 16; i++) {
        const slot = new Date(start.getTime() + i * 15 * 60 * 1000)
        timeSlots.push(slot.toISOString())
    }

    function formatTime(iso: string) {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    const finalTotal = Math.max(0, totalAmount() - promoDiscount)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!customerName.trim() || !customerPhone.trim()) {
            toast.error('Please fill in all required fields.')
            return
        }
        if (orderMode === 'takeaway' && !pickupTime) {
            toast.error('Please choose a pickup time.')
            return
        }
        if (orderMode === 'delivery' && !deliveryAddress.trim()) {
            toast.error('Please enter your delivery address.')
            return
        }
        if (!items || items.length === 0) {
            toast.error('Your cart is empty.')
            return
        }

        setIsSubmitting(true)

        const result = orderMode === 'delivery'
            ? await createDeliveryOrder({
                restaurantId,
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                deliveryAddress: deliveryAddress.trim(),
                customerEmail: customerEmail.trim() || undefined,
                items,
                customerNote: note || undefined,
                promoCode: promo?.code || undefined,
            })
            : await createTakeoutOrder({
                restaurantId,
                customerName: customerName.trim(),
                customerPhone: customerPhone.trim(),
                customerEmail: customerEmail.trim() || undefined,
                pickupTime,
                items,
                customerNote: note || undefined,
                promoCode: promo?.code || undefined,
            })

        if (result.error) {
            toast.error(result.error)
            setIsSubmitting(false)
        } else if (result.orderId) {
            toast.success(orderMode === 'delivery' ? 'Delivery order placed!' : 'Takeout order placed successfully!')
            useActiveOrders.getState().addActiveOrder({ id: result.orderId, type: 'takeout', slug: restaurantSlug })
            clearCart()
            router.push(`/takeout/${restaurantSlug}/order/${result.orderId}`)
        }
    }

    if (!items || items.length === 0) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="text-center">
                    <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-xl font-medium text-gray-900 mb-2">Your cart is empty</h2>
                    <p className="text-gray-500">Add some items before placing a takeout order.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 pb-32">
            <header className="bg-white px-4 py-4 shadow-sm sticky top-0 z-20 flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 -ml-2 text-gray-600 rounded-full active:bg-gray-100">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">{orderMode === 'delivery' ? 'Delivery Order' : 'Takeout Order'}</h1>
                    <p className="text-xs text-gray-500">{restaurantName}</p>
                </div>
            </header>

            <form onSubmit={handleSubmit} className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                {/* Order type toggle */}
                <div className="grid grid-cols-2 gap-2 bg-white rounded-xl shadow-sm border border-gray-100 p-1.5">
                    {([['takeaway', 'Takeaway'], ['delivery', 'Delivery']] as const).map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => setOrderMode(mode)}
                            className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                                orderMode === mode ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Order items summary */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <h2 className="font-semibold text-gray-700 mb-3">
                        Your Items ({items.reduce((t, i) => t + i.quantity, 0)})
                    </h2>
                    <ul className="divide-y divide-gray-100">
                        {items.map((item) => (
                            <li key={item.menuItemId} className="py-2 flex justify-between text-sm">
                                <span className="text-gray-700">
                                    {item.quantity}× {item.name}
                                </span>
                                <span className="font-medium">
                                    {money(item.price * item.quantity)}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Customer Info */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
                    <h2 className="font-semibold text-gray-700">Your Details</h2>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Name *</label>
                        <input
                            type="text"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            required
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Phone *</label>
                        <input
                            type="tel"
                            value={customerPhone}
                            onChange={(e) => setCustomerPhone(e.target.value)}
                            required
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Email (optional)</label>
                        <input
                            type="email"
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* Delivery address (delivery mode) */}
                {orderMode === 'delivery' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                        <label className="block text-sm font-medium text-gray-600 mb-1">Delivery Address *</label>
                        <textarea
                            rows={2}
                            value={deliveryAddress}
                            onChange={(e) => setDeliveryAddress(e.target.value)}
                            required
                            placeholder="House no, street, area, landmark…"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                        />
                    </div>
                )}

                {/* Pickup Time (takeaway mode) */}
                {orderMode === 'takeaway' && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                            <Clock size={18} className="text-gray-500" />
                            Pickup Time *
                        </h2>
                        <div className="grid grid-cols-4 gap-2">
                            {timeSlots.map((slot) => (
                                <button
                                    key={slot}
                                    type="button"
                                    onClick={() => setPickupTime(slot)}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                        pickupTime === slot
                                            ? 'bg-gray-900 text-white border-gray-900'
                                            : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                                    }`}
                                >
                                    {formatTime(slot)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Promo Code */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <PromoCodeInput
                        restaurantId={restaurantId}
                        subtotal={totalAmount()}
                        onApply={(p, d) => { setPromo(p); setPromoDiscount(d) }}
                        onRemove={() => { setPromo(null); setPromoDiscount(0) }}
                        appliedPromo={promo}
                    />
                </div>

                {/* Note */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <label className="block font-semibold text-gray-700 mb-2">Special Instructions</label>
                    <textarea
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="E.g. No onions, extra napkins..."
                    />
                </div>
            </form>

            {/* Bottom bar */}
            <div className="fixed bottom-0 left-0 right-0 p-4 z-50 bg-white border-t border-gray-200">
                <div className="max-w-xl mx-auto">
                    <div className="space-y-1 mb-3">
                        <div className="flex justify-between text-sm text-gray-500">
                            <span>Subtotal</span>
                            <span>{money(totalAmount())}</span>
                        </div>
                        {promoDiscount > 0 && (
                            <div className="flex justify-between text-sm text-green-600">
                                <span>Discount</span>
                                <span>-{money(promoDiscount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                            <span className="font-medium text-gray-700">Total</span>
                            <span className="text-xl font-bold text-gray-900">{money(finalTotal)}</span>
                        </div>
                    </div>
                    <button
                        onClick={handleSubmit as unknown as () => void}
                        disabled={isSubmitting}
                        className="w-full bg-gray-900 text-white font-medium rounded-xl py-4 flex items-center justify-center gap-2 disabled:opacity-70 shadow-lg"
                    >
                        {isSubmitting ? (
                            <><Loader2 className="animate-spin" size={20} /> Placing Order...</>
                        ) : (
                            orderMode === 'delivery' ? 'Place Delivery Order' : 'Place Takeout Order'
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
