'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, MapPin } from 'lucide-react'
import { createOnboardingRestaurant } from './actions'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import 'leaflet/dist/leaflet.css'

// Dynamically import Map to prevent SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
// useMapEvents is a hook — it can't be dynamic()-wrapped. The component that
// uses it is dynamically imported (ssr: false) from its own client module.
const MapClickHandler = dynamic(() => import('@/components/shared/MapClickHandler'), { ssr: false })

// Fix for default marker icons in leaflet
const iconFix = () => {
    import('leaflet').then(L => {
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
        })
    })
}

const TYPES = ['FastFood', 'Resort', 'Hotel', 'Bakery', 'Cloud Kitchen', 'Bar', 'Cafe', 'Restaurant']

export default function OnboardingCreateClient() {
    const router = useRouter()
    const supabase = createClient()
    const [isLoading, setIsLoading] = useState(false)
    const [isContinuing, setIsContinuing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedType, setSelectedType] = useState('Restaurant')
    const [address, setAddress] = useState('')
    
    // Modals
    const [isMapModalOpen, setIsMapModalOpen] = useState(false)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    
    // Map State
    const [position, setPosition] = useState<{lat: number, lng: number} | null>(null)
    
    useEffect(() => {
        iconFix()
    }, [])

    const handleCurrentLocation = () => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => console.error(err)
            )
        }
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsLoading(true)
        setError(null)
        
        const formData = new FormData(e.currentTarget)
        formData.append('type', selectedType)
        if (position) {
            formData.append('latitude', position.lat.toString())
            formData.append('longitude', position.lng.toString())
        }

        try {
            const result = await createOnboardingRestaurant(formData)
            if (result.error) {
                setError(result.error)
            } else if (result.success) {
                setIsSuccessModalOpen(true)
            }
        } catch (err) {
            setError('An unexpected error occurred')
        } finally {
            setIsLoading(false)
        }
    }

    const handleContinue = async () => {
        setIsContinuing(true)
        // The session's JWT was minted before this restaurant existed, so it
        // still carries the "unauthenticated" claim sentinel. Re-mint it now
        // so proxy.ts's role check (and any RLS-gated client query) sees the
        // restaurant/role that provisioning just committed — otherwise the
        // soft nav below bounces through a stale-claims redirect loop.
        await supabase.auth.refreshSession()
        router.refresh()
        router.push('/admin/dashboard')
    }

    return (
        <>
            <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-8 sm:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-gray-100">
                <div className="flex items-center gap-4 mb-10">
                    <button 
                        type="button"
                        onClick={() => router.push('/onboarding')}
                        className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-red-500 hover:bg-gray-50 transition-colors shrink-0"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">Create New Restaurant</h2>
                </div>

                {error && (
                    <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 font-medium">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-8">
                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">Restaurant Name <span className="text-red-500">*</span></label>
                        <input 
                            name="restaurantName"
                            required
                            placeholder="e.g, Ameci Cafe & Restaurant"
                            className="w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl focus:border-gray-400 focus:ring-0 outline-none transition-all text-sm placeholder:text-gray-400"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">Restaurant Number <span className="text-red-500">*</span></label>
                        <div className="flex h-[52px] w-full rounded-xl border border-gray-200 overflow-hidden bg-white focus-within:border-gray-400 transition-all">
                            <div className="flex items-center gap-2 px-4 bg-white border-r border-gray-200 cursor-pointer">
                                <span className="text-lg leading-none">🇳🇵</span>
                                <span className="text-gray-400 text-xs">▼</span>
                            </div>
                            <div className="flex items-center px-4 text-gray-900 text-sm">
                                +977
                            </div>
                            <input
                                name="contactPhone"
                                type="tel"
                                required
                                className="flex-1 px-2 text-sm outline-none text-gray-900 w-full"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-3">Type <span className="text-red-500">*</span></label>
                        <div className="flex flex-wrap gap-3">
                            {TYPES.map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setSelectedType(type)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                                        selectedType === type
                                        ? 'bg-gray-100 text-gray-900'
                                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                                    }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-900 mb-2">Address <span className="text-red-500">*</span></label>
                        <div className="flex gap-3">
                            <input 
                                name="address"
                                required
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Search Location"
                                className="flex-1 px-4 py-3.5 bg-white border border-gray-200 rounded-xl focus:border-gray-400 focus:ring-0 outline-none transition-all text-sm placeholder:text-gray-400"
                            />
                            <button
                                type="button"
                                onClick={() => setIsMapModalOpen(true)}
                                className="w-[52px] h-[52px] flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors shrink-0"
                            >
                                <MapPin size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 pt-4">
                        <button 
                            type="reset"
                            onClick={() => {
                                setAddress('')
                                setPosition(null)
                                setSelectedType('Restaurant')
                            }}
                            className="flex-1 bg-white border border-gray-200 text-gray-600 font-semibold py-4 rounded-full hover:bg-gray-50 transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white font-bold py-4 rounded-full shadow-lg shadow-[var(--color-primary)]/20 disabled:opacity-50 transition-all hover:scale-[1.02]"
                        >
                            {isLoading ? 'Saving...' : 'Save Restaurant'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Map Modal */}
            {isMapModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-5xl h-[80vh] rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
                        
                        {/* Map Header Overlay */}
                        <div className="absolute top-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-[1000] flex gap-3">
                            <div className="flex-1 bg-white rounded-xl shadow-lg flex items-center px-4 border border-gray-100">
                                <span className="text-gray-400 mr-2 text-sm">🔍</span>
                                <input 
                                    type="text" 
                                    placeholder="Search for a place..."
                                    className="w-full py-3.5 outline-none text-sm text-gray-700"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                />
                            </div>
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="w-12 h-[52px] bg-white rounded-xl shadow-lg border border-gray-100 flex items-center justify-center text-red-500 hover:bg-gray-50 transition-colors shrink-0"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Current Location Overlay Button */}
                        <div className="absolute bottom-24 right-10 z-[1000]">
                            <button 
                                onClick={handleCurrentLocation}
                                className="bg-white text-red-500 font-semibold text-sm px-6 py-3 rounded-xl shadow-lg border border-gray-100 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                            >
                                <MapPin size={16} /> Use current location
                            </button>
                        </div>

                        {/* Map Footer Overlay Buttons */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-[1000] flex gap-4">
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="flex-1 bg-white text-gray-700 font-semibold py-3.5 rounded-xl shadow-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="flex-1 bg-[#8FBFA0] text-white font-semibold py-3.5 rounded-xl shadow-lg hover:bg-[#7eac8f] transition-colors flex items-center justify-center gap-2"
                            >
                                ✓ Save location
                            </button>
                        </div>

                        <div className="flex-1 w-full bg-gray-100">
                            {typeof window !== 'undefined' && (
                                <MapContainer 
                                    center={position || [28.2096, 83.9856]} 
                                    zoom={13} 
                                    style={{ height: '100%', width: '100%' }}
                                    zoomControl={false}
                                >
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    />
                                    {position && <Marker position={position} />}
                                    <MapClickHandler onLocationSelect={(lat, lng) => setPosition({lat, lng})} />
                                </MapContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {isSuccessModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-xl rounded-3xl p-10 text-center shadow-2xl relative overflow-hidden">
                        
                        {/* Gradient Mesh Background Effect */}
                        <div className="absolute -top-40 -right-40 w-80 h-80 bg-red-100 rounded-full blur-[80px] opacity-50 pointer-events-none"></div>
                        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-100 rounded-full blur-[80px] opacity-50 pointer-events-none"></div>

                        <div className="relative z-10">
                            <h3 className="text-sm font-bold text-gray-900 mb-2">Hello, Welcome!</h3>
                            <h2 className="text-3xl font-extrabold text-gray-900 mb-4 tracking-tight">Welcome to RestroX</h2>
                            <p className="text-sm text-gray-500 font-medium leading-relaxed mb-8 max-w-sm mx-auto">
                                Your restaurant has been successfully created. Take a quick tour to see how easy it is to manage your menu, tables, and team.
                            </p>

                            <button
                                onClick={handleContinue}
                                disabled={isContinuing}
                                className="bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white font-bold py-3.5 px-8 rounded-full shadow-lg shadow-[var(--color-primary)]/20 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                            >
                                {isContinuing ? 'Loading...' : "Let's Continue"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
