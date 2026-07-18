'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import PhysicalMenuGallery from '@/components/customer/PhysicalMenuGallery'
import { 
    UtensilsCrossed, ArrowRight, Loader2, ShoppingBag, User, 
    Phone, Key, ShieldCheck, Check, Lock, BookOpen, Bell, ArrowLeft 
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'react-hot-toast'

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
    receptionPhone?: string | null
}

export default function RestaurantMainClient({ restaurant, tables, restaurantSlug, dineInEnabled, receptionPhone }: RestaurantMainClientProps) {
    const [selectedTableId, setSelectedTableId] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const searchParams = useSearchParams()

    // Room QR gate states
    const roomParam = searchParams.get('room')
    const [phoneNumber, setPhoneNumber] = useState('')
    const [verifying, setVerifying] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [verifiedData, setVerifiedData] = useState<{ guestName: string; qrToken: string; tableLabel: string } | null>(null)
    const [checkingStorage, setCheckingStorage] = useState(true)
    const [showServiceMessage, setShowServiceMessage] = useState(false)

    useEffect(() => {
        if (!roomParam) {
            setCheckingStorage(false)
            return
        }
        
        const checkStoredAccess = async () => {
            const key = `room_access_${restaurantSlug}_${roomParam}`
            try {
                const stored = localStorage.getItem(key)
                if (stored) {
                    const parsed = JSON.parse(stored)
                    if (parsed.phoneNumber) {
                        // Silent verification check to verify if the booking has changed or expired
                        const res = await fetch('/api/rooms/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                restaurantSlug,
                                roomNumber: roomParam,
                                phoneNumber: parsed.phoneNumber
                            })
                        })
                        if (res.ok) {
                            setVerifiedData(parsed)
                        } else {
                            // Booking changed or checked out — clean up storage
                            localStorage.removeItem(key)
                        }
                    } else {
                        // Legacy storage format without phone number — clear it
                        localStorage.removeItem(key)
                    }
                }
            } catch (e) {
                console.error(e)
            } finally {
                setCheckingStorage(false)
            }
        }

        checkStoredAccess()
    }, [roomParam, restaurantSlug])

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!phoneNumber.trim()) return

        setVerifying(true)
        setError(null)

        try {
            const res = await fetch('/api/rooms/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    restaurantSlug,
                    roomNumber: roomParam,
                    phoneNumber: phoneNumber.trim()
                })
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error || 'Verification failed')
            }

            const verified = {
                guestName: data.guestName,
                qrToken: data.qrToken,
                tableLabel: data.tableLabel,
                phoneNumber: phoneNumber.trim() // Save phone number to re-verify later!
            }

            const key = `room_access_${restaurantSlug}_${roomParam}`
            localStorage.setItem(key, JSON.stringify(verified))
            setVerifiedData(verified)
            toast.success(`Welcome, ${data.guestName}!`)
        } catch (e: any) {
            setError(e.message || 'An error occurred during verification')
        } finally {
            setVerifying(false)
        }
    }

    const handleLogout = () => {
        if (!roomParam) return
        const key = `room_access_${restaurantSlug}_${roomParam}`
        localStorage.removeItem(key)
        setVerifiedData(null)
        setPhoneNumber('')
        setError(null)
    }

    const handleMenuClick = () => {
        if (!verifiedData?.qrToken) return
        setLoading(true)
        router.push(`/t/${verifiedData.qrToken}`)
    }

    const handleStartOrdering = () => {
        if (!selectedTableId) return

        const table = tables.find(t => t.id === selectedTableId)
        if (!table) return

        setLoading(true)
        // The table page handles session start for both modes: self-service auto-opens
        // a session on load, and waiter-managed mode shows the "waiting for waiter" gate.
        router.push(`/t/${table.qr_token}`)
    }

    // RENDER ROOM SERVICE ACCESS FLOW
    if (roomParam) {
        if (checkingStorage) {
            return (
                <div className="min-h-screen bg-surface-muted flex flex-col items-center justify-center p-4">
                    <Loader2 className="animate-spin text-brand-500" size={32} />
                </div>
            )
        }

        return (
            <div className="min-h-screen bg-surface-muted flex flex-col items-center pt-12 px-4 pb-24">
                {/* Branding */}
                <div className="flex flex-col items-center text-center mb-8">
                    {restaurant.logo_url ? (
                        <div className="relative w-20 h-20 rounded-2xl overflow-hidden bg-surface shadow-sm mb-4 border border-hairline">
                            <Image src={restaurant.logo_url} alt={restaurant.name} fill className="object-cover" />
                        </div>
                    ) : (
                        <div className="w-20 h-20 rounded-2xl bg-brand-500/10 flex items-center justify-center mb-4 text-brand-500">
                            <UtensilsCrossed size={32} />
                        </div>
                    )}
                    <h1 className="text-xl font-bold text-ink">{restaurant.name}</h1>
                    <p className="text-ink-subtle text-xs mt-1 uppercase font-bold tracking-wider">Hotel Room Service</p>
                </div>

                <div className="w-full max-w-md">
                    {!verifiedData ? (
                        /* Verification Screen */
                        <div className="bg-surface p-6 rounded-2xl shadow-sm border border-hairline-strong">
                            <div className="flex items-center gap-2 mb-4 text-brand-500">
                                <Lock size={20} />
                                <h2 className="text-lg font-bold text-ink">Room Service Access</h2>
                            </div>
                            
                            <div className="mb-6 p-4 bg-brand-50/50 rounded-xl border border-brand-100 flex items-center gap-3">
                                <div className="bg-brand-500 text-white font-black text-sm px-3 py-1.5 rounded-lg shrink-0">
                                    Room {roomParam}
                                </div>
                                <div className="text-xs text-ink-subtle leading-normal font-semibold">
                                    Please verify your stay details to browse the menu and place room service orders.
                                </div>
                            </div>

                            <form onSubmit={handleVerify} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Booked Phone Number</label>
                                    <div className="relative">
                                        <input
                                            type="tel"
                                            value={phoneNumber}
                                            onChange={e => setPhoneNumber(e.target.value)}
                                            placeholder="Enter phone number used at check-in"
                                            className="w-full pl-10 pr-4 py-3 bg-surface border border-hairline rounded-xl text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition outline-none"
                                            required
                                            disabled={verifying}
                                        />
                                        <Phone className="absolute left-3.5 top-3.5 text-ink-subtle" size={16} />
                                    </div>
                                </div>

                                {error && (
                                    <div className="p-3 bg-danger-bg/10 border border-danger-bg/25 text-danger-fg text-xs font-semibold rounded-xl leading-relaxed animate-in fade-in duration-200">
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={!phoneNumber.trim() || verifying}
                                    className="w-full flex items-center justify-center gap-2 py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-xl font-bold transition focus-ring shadow-sm"
                                >
                                    {verifying ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                                    {verifying ? 'Verifying stay...' : 'Verify & Enter'}
                                </button>
                            </form>
                        </div>
                    ) : (
                        /* Portal / Dashboard Screen */
                        <div className="space-y-4">
                            <div className="bg-surface p-6 rounded-2xl shadow-sm border border-hairline-strong text-center">
                                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3 border border-emerald-100">
                                    <ShieldCheck size={24} />
                                </div>
                                <span className="text-[10px] text-emerald-600 font-extrabold uppercase bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100/50 tracking-wider">
                                    Verified Stay • Room {roomParam}
                                </span>
                                <h2 className="text-xl font-black text-ink mt-3">Welcome, {verifiedData.guestName}!</h2>
                                <p className="text-xs text-ink-subtle font-medium mt-1">Enjoy digital room service orders charged directly to your folio.</p>
                            </div>

                            {/* Service and Menu Selection Cards */}
                            <div className="grid grid-cols-1 gap-4">
                                {/* Call for Service Card */}
                                {receptionPhone ? (
                                    <a
                                        href={`tel:${receptionPhone}`}
                                        className="w-full bg-surface p-5 rounded-2xl border border-hairline hover:border-brand-500/50 hover:shadow-md transition text-left flex items-start gap-4 focus-ring shadow-sm select-none group"
                                    >
                                        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 group-hover:scale-105 transition-transform">
                                            <Phone size={22} className="text-brand-600" />
                                        </div>
                                        <div className="flex-1 min-w-0 pr-2">
                                            <h3 className="font-extrabold text-ink text-base">Call for Service</h3>
                                            <p className="text-xs text-ink-subtle font-medium mt-1 leading-normal">
                                                Call reception at {receptionPhone} for immediate assistance.
                                            </p>
                                        </div>
                                        <ArrowRight size={18} className="text-ink-subtle shrink-0 mt-3 group-hover:translate-x-0.5 transition-transform" />
                                    </a>
                                ) : (
                                    <button
                                        onClick={() => setShowServiceMessage(true)}
                                        className="w-full bg-surface p-5 rounded-2xl border border-hairline hover:border-brand-500/50 hover:shadow-md transition text-left flex items-start gap-4 focus-ring shadow-sm select-none group"
                                    >
                                        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 group-hover:scale-105 transition-transform">
                                            <Phone size={22} className="text-brand-600" />
                                        </div>
                                        <div className="flex-1 min-w-0 pr-2">
                                            <h3 className="font-extrabold text-ink text-base">Call for Service</h3>
                                            <p className="text-xs text-ink-subtle font-medium mt-1 leading-normal">
                                                Call reception for room service, toiletries, or assistance.
                                            </p>
                                        </div>
                                        <ArrowRight size={18} className="text-ink-subtle shrink-0 mt-3 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                )}

                                {/* Menu Card */}
                                <button
                                    onClick={handleMenuClick}
                                    disabled={loading}
                                    className="w-full bg-surface p-5 rounded-2xl border border-hairline hover:border-brand-500/50 hover:shadow-md transition text-left flex items-start gap-4 focus-ring shadow-sm select-none group"
                                >
                                    <div className="w-12 h-12 rounded-xl bg-brand-500/10 text-brand-500 flex items-center justify-center shrink-0 border border-brand-500/20 group-hover:scale-105 transition-transform">
                                        <UtensilsCrossed size={22} />
                                    </div>
                                    <div className="flex-1 min-w-0 pr-2">
                                        <h3 className="font-extrabold text-ink text-base">Order Food & Drinks</h3>
                                        <p className="text-xs text-ink-subtle font-medium mt-1 leading-normal">
                                            Browse our in-room dining menu and place orders directly.
                                        </p>
                                    </div>
                                    {loading ? (
                                        <Loader2 size={18} className="animate-spin text-brand-500 shrink-0 mt-3" />
                                    ) : (
                                        <ArrowRight size={18} className="text-ink-subtle shrink-0 mt-3 group-hover:translate-x-0.5 transition-transform" />
                                    )}
                                </button>
                            </div>

                            <button
                                onClick={handleLogout}
                                className="w-full py-3 bg-surface border border-hairline text-ink rounded-xl text-xs font-bold shadow-sm hover:bg-surface-muted transition flex items-center justify-center gap-2"
                            >
                                <ArrowLeft size={14} />
                                Change Phone Number / Sign Out
                            </button>
                        </div>
                    )}
                </div>

                {/* Service Message Modal */}
                {showServiceMessage && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-surface rounded-2xl shadow-xl border border-hairline p-6 max-w-sm w-full text-center animate-in fade-in zoom-in-95 duration-200">
                            <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4 border border-brand-100">
                                <Bell size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-ink mb-2">Service Requests</h3>
                            <p className="text-xs text-ink-subtle mb-6 leading-relaxed font-semibold">
                                Room service requests (housekeeping, toiletries, laundry, etc.) are currently being integrated. 
                                <br /><br />
                                For immediate assistance, please call the front desk.
                            </p>
                            <button 
                                onClick={() => setShowServiceMessage(false)}
                                className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-bold transition focus-ring"
                            >
                                Understood
                            </button>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // ORIGINAL RESTAURANT MAIN RENDER (FOR TABLE OR DEFAULT DINE-IN FLOW)
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
