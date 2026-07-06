'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import PhysicalMenuGallery from '@/components/customer/PhysicalMenuGallery'
import { UtensilsCrossed, ArrowRight, Loader2, ShoppingBag, User } from 'lucide-react'
import Link from 'next/link'

interface RestaurantMainClientProps {
    restaurant: {
        id: string
        name: string
        logo_url: string | null
        physical_menu_urls: string[] | null
    }
    tables: {
        id: string
        label: string
        qr_token: string
    }[]
    restaurantSlug: string
    dineInEnabled: boolean
}

export default function RestaurantMainClient({ restaurant, tables, restaurantSlug, dineInEnabled }: RestaurantMainClientProps) {
    const [selectedTableId, setSelectedTableId] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleStartOrdering = () => {
        if (!selectedTableId) return

        const table = tables.find(t => t.id === selectedTableId)
        if (!table) return

        setLoading(true)
        // The table page handles session start for both modes: self-service auto-opens
        // a session on load, and waiter-managed mode shows the "waiting for waiter" gate.
        router.push(`/t/${table.qr_token}`)
    }

    return (
        <div className="min-h-screen bg-surface-muted flex flex-col items-center pt-12 px-4 pb-24">
            {/* Branding */}
            <div className="flex flex-col items-center text-center mb-8">
                {restaurant.logo_url ? (
                    <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-surface shadow-sm mb-4 border border-hairline">
                        <Image src={restaurant.logo_url} alt={restaurant.name} fill className="object-cover" />
                    </div>
                ) : (
                    <div className="w-24 h-24 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-4 text-[var(--color-primary)]">
                        <UtensilsCrossed size={40} />
                    </div>
                )}
                <h1 className="text-2xl font-bold text-ink">{restaurant.name}</h1>
                <p className="text-ink-subtle mt-2 text-sm max-w-sm">
                    {dineInEnabled && tables.length > 0
                        ? 'Welcome! Please select your table to start ordering, or browse our menu below.'
                        : 'Welcome! Order online for pickup or delivery.'}
                </p>
            </div>

            <div className="w-full max-w-md space-y-4">
                {/* Delivery-only/counter-service restaurants: pickup is the primary CTA */}
                {!dineInEnabled && (
                    <button
                        onClick={() => router.push(`/takeout/${restaurantSlug}`)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl font-semibold hover:opacity-90 transition"
                    >
                        <ShoppingBag size={18} />
                        Order for Pickup
                    </button>
                )}

                {/* Session Request Card */}
                {dineInEnabled && tables.length > 0 && (
                    <div className="bg-surface p-6 rounded-2xl shadow-sm border border-hairline-strong">
                        <h2 className="text-lg font-semibold text-ink mb-4">Are you seated here?</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1.5">Select your Table</label>
                                <select
                                    value={selectedTableId}
                                    onChange={(e) => setSelectedTableId(e.target.value)}
                                    className="w-full px-4 py-3 border border-hairline-strong rounded-xl bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                                >
                                    <option value="" disabled>Choose table number...</option>
                                    {tables.map(t => (
                                        <option key={t.id} value={t.id}>Table {t.label}</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                onClick={handleStartOrdering}
                                disabled={!selectedTableId || loading}
                                className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-xl font-semibold hover:opacity-90 transition disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                                {loading ? 'Opening menu...' : 'Start Ordering'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Physical Menu Gallery */}
                {restaurant.physical_menu_urls && restaurant.physical_menu_urls.length > 0 && (
                    <PhysicalMenuGallery images={restaurant.physical_menu_urls} restaurantName={restaurant.name} />
                )}

                {/* Takeout / pickup self-order entry point (secondary when dine-in is available) */}
                {dineInEnabled && (
                    <button
                        onClick={() => router.push(`/takeout/${restaurantSlug}`)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-surface border border-hairline-strong text-ink rounded-xl font-semibold shadow-sm hover:bg-surface-muted transition"
                    >
                        <ShoppingBag size={18} />
                        Order for Pickup
                    </button>
                )}

                {/* Profile Link */}
                <Link
                    href={`/r/${restaurantSlug}/profile`}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-ink text-white rounded-xl font-semibold shadow-sm hover:bg-black transition"
                >
                    <User size={18} />
                    My Profile & Loyalty Points
                </Link>
            </div>
        </div>
    )
}
