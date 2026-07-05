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
}

export default function RestaurantMainClient({ restaurant, tables, restaurantSlug }: RestaurantMainClientProps) {
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
        <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-12 px-4 pb-24">
            {/* Branding */}
            <div className="flex flex-col items-center text-center mb-8">
                {restaurant.logo_url ? (
                    <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-white shadow-sm mb-4 border border-gray-100">
                        <Image src={restaurant.logo_url} alt={restaurant.name} fill className="object-cover" />
                    </div>
                ) : (
                    <div className="w-24 h-24 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-4 text-[var(--color-primary)]">
                        <UtensilsCrossed size={40} />
                    </div>
                )}
                <h1 className="text-2xl font-bold text-gray-900">{restaurant.name}</h1>
                <p className="text-gray-500 mt-2 text-sm max-w-sm">
                    Welcome! Please select your table to start ordering, or browse our menu below.
                </p>
            </div>

            <div className="w-full max-w-md space-y-4">
                {/* Session Request Card */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Are you seated here?</h2>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">Select your Table</label>
                            <select
                                value={selectedTableId}
                                onChange={(e) => setSelectedTableId(e.target.value)}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
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

                {/* Physical Menu Gallery */}
                {restaurant.physical_menu_urls && restaurant.physical_menu_urls.length > 0 && (
                    <PhysicalMenuGallery images={restaurant.physical_menu_urls} restaurantName={restaurant.name} />
                )}

                {/* Takeout / pickup self-order entry point */}
                <button
                    onClick={() => router.push(`/takeout/${restaurantSlug}`)}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold shadow-sm hover:bg-gray-50 transition"
                >
                    <ShoppingBag size={18} />
                    Order for Pickup
                </button>

                {/* Profile Link */}
                <Link
                    href={`/r/${restaurantSlug}/profile`}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white rounded-xl font-semibold shadow-sm hover:bg-black transition"
                >
                    <User size={18} />
                    My Profile & Loyalty Points
                </Link>
            </div>
        </div>
    )
}
