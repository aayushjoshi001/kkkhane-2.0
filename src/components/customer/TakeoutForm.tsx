'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createTakeoutOrder, createDeliveryOrder } from '@/app/api/takeout/actions'
import { useCartStore, getCartItemKey } from '@/lib/stores/cart'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import PromoCodeInput from '@/components/customer/PromoCodeInput'
import StickyBottomBar from '@/components/customer/StickyBottomBar'
import type { PromoCode } from '@/types/database'
import { ArrowLeft, Clock, Loader2, ShoppingBag, MapPin } from 'lucide-react'
import { toast } from 'react-hot-toast'
import dynamic from 'next/dynamic'
import 'leaflet/dist/leaflet.css'
import { fixLeafletDefaultIcon } from '@/lib/leafletIcons'

// Dynamically import Map to prevent SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
const MapController = dynamic(() => import('@/components/shared/MapController'), { ssr: false })

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

    const [customerName, setCustomerName] = useState('')
    const [customerPhone, setCustomerPhone] = useState('')
    const [customerEmail, setCustomerEmail] = useState('')
    const [orderType, setOrderType] = useState<'takeout' | 'delivery'>('takeout')
    const [deliveryAddress, setDeliveryAddress] = useState('')
    const [extraDetails, setExtraDetails] = useState('')
    const [pickupTime, setPickupTime] = useState('')
    const [note, setNote] = useState('')
    const [promo, setPromo] = useState<PromoCode | null>(null)
    const [promoDiscount, setPromoDiscount] = useState(0)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const router = useRouter()

    const [latitude, setLatitude] = useState<number | null>(null)
    const [longitude, setLongitude] = useState<number | null>(null)
    const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const [mounted, setMounted] = useState(false)

    // A logged-in staff member ringing up a walk-in counter takeaway usually
    // doesn't have the guest's name/phone or a scheduled pickup slot. When /api/me
    // confirms a staff session we relax those requirements; the public customer
    // form stays strict. Detected client-side so this page keeps its ISR cache.
    const [isStaff, setIsStaff] = useState(false)
    useEffect(() => {
        let active = true
        const STAFF_ROLES = ['cashier', 'waiter', 'manager', 'admin', 'super_admin']
        fetch('/api/me', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (active && d?.authenticated && STAFF_ROLES.includes(d.role)) setIsStaff(true)
            })
            .catch(() => {})
        return () => {
            active = false
        }
    }, [])

    useEffect(() => {
        setMounted(true)
        fixLeafletDefaultIcon()
    }, [])

    const handleGeolocate = () => {
        if (!navigator.geolocation) {
            setGeoStatus('error')
            toast.error('Geolocation is not supported by your browser')
            return
        }
        setGeoStatus('loading')
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords
                setLatitude(lat)
                setLongitude(lng)
                // Reverse geocode via OpenStreetMap Nominatim
                try {
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
                        { headers: { 'Accept-Language': 'en' } }
                    )
                    const json = await res.json()
                    const display = json.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                    setDeliveryAddress(display)
                } catch {
                    setDeliveryAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
                }
                setGeoStatus('done')
            },
            () => {
                setGeoStatus('error')
                toast.error('Failed to get your location. Please check location permissions.')
            },
            { timeout: 10000, maximumAge: 60000 }
        )
    }

    const handleLocationSelect = async (lat: number, lng: number) => {
        setLatitude(lat)
        setLongitude(lng)
        setGeoStatus('loading')
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
                { headers: { 'Accept-Language': 'en' } }
            )
            const json = await res.json()
            const display = json.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
            setDeliveryAddress(display)
            setGeoStatus('done')
        } catch {
            setDeliveryAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
            setGeoStatus('error')
        }
    }

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
        // Staff walk-in takeaways don't require name/phone/pickup; the public
        // customer form still enforces them.
        if (!isStaff && (!customerName.trim() || !customerPhone.trim() || !pickupTime)) {
            toast.error('Please fill in all required fields.')
            return
        }
        if (orderType === 'delivery' && !deliveryAddress.trim()) {
            toast.error('Please enter a delivery address.')
            return
        }
        if (!items || items.length === 0) {
            toast.error('Your cart is empty.')
            return
        }

        setIsSubmitting(true)

        let result
        // 'asap' (or blank, for staff) means "as soon as possible" — send now.
        const resolvedPickup = pickupTime && pickupTime !== 'asap' ? pickupTime : new Date().toISOString()
        const commonInput = {
            restaurantId,
            customerName: customerName.trim() || (isStaff ? 'Walk-in' : ''),
            customerPhone: customerPhone.trim(),
            customerEmail: customerEmail.trim() || undefined,
            items,
            customerNote: note || undefined,
            promoCode: promo?.code || undefined,
        }

        if (orderType === 'delivery') {
            result = await createDeliveryOrder({
                ...commonInput,
                deliveryAddress: extraDetails.trim()
                    ? `${deliveryAddress.trim()} (${extraDetails.trim()})`
                    : deliveryAddress.trim(),
            })
        } else {
            result = await createTakeoutOrder({
                ...commonInput,
                pickupTime: resolvedPickup,
            })
        }

        if (result.error) {
            toast.error(result.error)
            setIsSubmitting(false)
        } else if (result.orderId) {
            toast.success(orderType === 'delivery' ? 'Delivery order placed!' : 'Takeout order placed!')
            useActiveOrders.getState().addActiveOrder({ id: result.orderId, type: 'takeout', slug: restaurantSlug })
            clearCart()
            // Redirect to order tracking page
            router.push(`/takeout/${restaurantSlug}/order/${result.orderId}`)
        }
    }

    if (!items || items.length === 0) {
        return (
            <div className="min-h-screen bg-surface-muted flex items-center justify-center p-4">
                <div className="text-center">
                    <ShoppingBag className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-xl font-medium text-ink mb-2">Your cart is empty</h2>
                    <p className="text-ink-subtle">Add some items before placing a takeout order.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-surface-muted pb-32">
            <header className="bg-surface px-4 py-4 shadow-sm sticky top-0 z-20 flex items-center gap-3">
                <button onClick={() => router.back()} className="p-2 -ml-2 text-ink-muted rounded-full active:bg-surface-muted">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-xl font-semibold text-ink">
                        {orderType === 'delivery' ? 'Delivery Order' : 'Takeaway Order'}
                    </h1>
                    <p className="text-xs text-ink-subtle">{restaurantName}</p>
                </div>
            </header>

            <form onSubmit={handleSubmit} className="max-w-xl mx-auto px-4 mt-6 space-y-6">
                {/* Order Type Selector */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4">
                    <h2 className="font-semibold text-ink-muted mb-3 text-sm">Select Service Type</h2>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setOrderType('takeout')}
                            className={`flex-1 py-3 rounded-lg font-bold text-sm border flex items-center justify-center gap-2 transition cursor-pointer ${
                                orderType === 'takeout'
                                    ? 'bg-ink text-white border-gray-900'
                                    : 'bg-surface text-ink-muted border-hairline-strong hover:border-gray-400'
                            }`}
                        >
                            Takeaway
                        </button>
                        <button
                            type="button"
                            onClick={() => setOrderType('delivery')}
                            className={`flex-1 py-3 rounded-lg font-bold text-sm border flex items-center justify-center gap-2 transition cursor-pointer ${
                                orderType === 'delivery'
                                    ? 'bg-ink text-white border-gray-900'
                                    : 'bg-surface text-ink-muted border-hairline-strong hover:border-gray-400'
                            }`}
                        >
                            Online Delivery
                        </button>
                    </div>
                </div>

                {/* Order items summary */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4">
                    <h2 className="font-semibold text-ink-muted mb-3">
                        Your Items ({items.reduce((t, i) => t + i.quantity, 0)})
                    </h2>
                    <ul className="divide-y divide-gray-100">
                        {items.map((item) => {
                            const cartKey = getCartItemKey(item)
                            const modifierTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.priceAdjustment, 0)
                            const unitPrice = item.price + modifierTotal
                            const lineTotal = unitPrice * item.quantity
                            const modifierNames = (item.modifiers || []).map(m => m.name).join(', ')
                            return (
                                <li key={cartKey} className="py-3 flex justify-between text-sm">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <span className="text-ink font-medium">
                                            {item.quantity}× {item.name}
                                            {item.variationName && (
                                                <span className="text-ink-muted font-normal"> ({item.variationName})</span>
                                            )}
                                        </span>
                                        {modifierNames && (
                                            <p className="text-xs text-ink-subtle mt-0.5 ml-4">{modifierNames}</p>
                                        )}
                                        {item.specialRequest && (
                                            <p className="text-xs text-ink-subtle italic mt-0.5 ml-4">Note: {item.specialRequest}</p>
                                        )}
                                    </div>
                                    <span className="font-semibold text-ink shrink-0">
                                        {money(lineTotal)}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                </div>

                {/* Customer Info */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4 space-y-4">
                    <h2 className="font-semibold text-ink-muted">Your Details</h2>
                    <div>
                        <label className="block text-sm font-medium text-ink-muted mb-1">Name {isStaff ? <span className="text-ink-subtle font-normal">(optional)</span> : '*'}</label>
                        <input
                            type="text"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            required={!isStaff}
                            placeholder={isStaff ? 'Walk-in' : undefined}
                            className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-ink-muted mb-1">Phone {isStaff ? <span className="text-ink-subtle font-normal">(optional)</span> : '*'}</label>
                        <input
                            type="tel"
                            value={customerPhone}
                            onChange={(e) => setCustomerPhone(e.target.value)}
                            required={!isStaff}
                            className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                    {orderType === 'delivery' && (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1">Delivery Address *</label>
                                <input
                                    type="text"
                                    value={deliveryAddress}
                                    onChange={(e) => setDeliveryAddress(e.target.value)}
                                    required={orderType === 'delivery'}
                                    placeholder="Apartment / street / location..."
                                    className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1">Extra Address Details (Apt, Landmark, etc.)</label>
                                <input
                                    type="text"
                                    value={extraDetails}
                                    onChange={(e) => setExtraDetails(e.target.value)}
                                    placeholder="e.g., Apt 302, 3rd Floor, near Blue Landmark"
                                    className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            {/* Premium Interactive Map Card */}
                            <div className="border border-hairline-strong rounded-xl overflow-hidden bg-surface-muted shadow-sm transition-all duration-300 hover:shadow-md">
                                <div className="p-3 bg-surface border-b border-hairline-strong flex items-center justify-between">
                                    <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
                                        <MapPin size={14} className="text-red-500 animate-bounce" /> Pin Delivery Location
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleGeolocate}
                                        className="text-xs bg-ink text-white px-3 py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                                    >
                                        {geoStatus === 'loading' ? (
                                            <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                            <MapPin size={12} />
                                        )}
                                        Locate Me
                                    </button>
                                </div>
                                <div className="h-56 w-full relative">
                                    {mounted && (
                                        <MapContainer
                                            center={(latitude && longitude) ? [latitude, longitude] : [28.2096, 83.9856]}
                                            zoom={14}
                                            style={{ height: '100%', width: '100%', zIndex: 1 }}
                                            zoomControl={true}
                                        >
                                            <TileLayer
                                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            />
                                            {(latitude && longitude) && <Marker position={[latitude, longitude]} />}
                                            <MapController
                                                onLocationSelect={handleLocationSelect}
                                                center={(latitude && longitude) ? [latitude, longitude] : null}
                                            />
                                        </MapContainer>
                                    )}
                                </div>
                                <div className="p-3 bg-surface-muted/70 text-[11px] text-ink-subtle flex items-center justify-between border-t border-hairline-strong">
                                    <span>Click on the map to pin exact delivery spot.</span>
                                    {latitude && longitude && (
                                        <span className="font-mono text-ink-muted bg-surface px-1.5 py-0.5 rounded border border-hairline-strong">
                                            {latitude.toFixed(5)}, {longitude.toFixed(5)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-ink-muted mb-1">Email (optional)</label>
                        <input
                            type="email"
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                            className="w-full rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                {/* Pickup/Delivery Time */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4">
                    <h2 className="font-semibold text-ink-muted mb-3 flex items-center gap-2">
                        <Clock size={18} className="text-ink-subtle" />
                        {orderType === 'delivery' ? 'Delivery Time Window' : 'Pickup Time'} {isStaff ? '' : '*'}
                    </h2>
                    <div className="grid grid-cols-4 gap-2">
                        {isStaff && (
                            <button
                                type="button"
                                onClick={() => setPickupTime('asap')}
                                className={`px-3 py-2 rounded-lg text-sm font-bold border transition-colors cursor-pointer ${
                                    pickupTime === 'asap' || !pickupTime
                                        ? 'bg-ink text-white border-gray-900'
                                        : 'bg-surface text-ink-muted border-hairline-strong hover:border-gray-400'
                                }`}
                            >
                                ASAP
                            </button>
                        )}
                        {timeSlots.map((slot) => (
                            <button
                                key={slot}
                                type="button"
                                onClick={() => setPickupTime(slot)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                                    pickupTime === slot
                                        ? 'bg-ink text-white border-gray-900'
                                        : 'bg-surface text-ink-muted border-hairline-strong hover:border-gray-400'
                                }`}
                            >
                                {formatTime(slot)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Promo Code */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4">
                    <PromoCodeInput
                        restaurantId={restaurantId}
                        subtotal={totalAmount()}
                        onApply={(p, d) => { setPromo(p); setPromoDiscount(d) }}
                        onRemove={() => { setPromo(null); setPromoDiscount(0) }}
                        appliedPromo={promo}
                    />
                </div>

                {/* Note */}
                <div className="bg-surface rounded-xl shadow-sm border border-hairline p-4">
                    <label className="block font-semibold text-ink-muted mb-2">Special Instructions</label>
                    <textarea
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full border border-hairline-strong rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="E.g. No onions, extra napkins..."
                    />
                </div>
            </form>

            {/* Bottom bar */}
            <StickyBottomBar className="z-50">
                <div className="space-y-1 mb-3">
                    <div className="flex justify-between text-sm text-ink-subtle">
                        <span>Subtotal</span>
                        <span>{money(totalAmount())}</span>
                    </div>
                    {promoDiscount > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                            <span>Discount</span>
                            <span>-{money(promoDiscount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between items-center pt-1 border-t border-hairline">
                        <span className="font-medium text-ink-muted">Total</span>
                        <span className="text-xl font-bold text-ink">{money(finalTotal)}</span>
                    </div>
                </div>
                <button
                    onClick={handleSubmit as unknown as () => void}
                    disabled={isSubmitting}
                    className="w-full bg-ink text-white font-medium rounded-xl py-4 flex items-center justify-center gap-2 disabled:opacity-70 shadow-lg cursor-pointer hover:bg-gray-800"
                >
                    {isSubmitting ? (
                        <><Loader2 className="animate-spin" size={20} /> Placing Order...</>
                    ) : (
                        orderType === 'delivery' ? 'Place Delivery Order' : 'Place Takeaway Order'
                    )}
                </button>
            </StickyBottomBar>
        </div>
    )
}

