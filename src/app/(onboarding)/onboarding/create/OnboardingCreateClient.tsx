'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, MapPin, Store, Globe, FileText, Phone } from 'lucide-react'
import { createOnboardingRestaurant } from './actions'
import { createClient } from '@/lib/supabase/client'
import dynamic from 'next/dynamic'
import 'leaflet/dist/leaflet.css'

// Dynamically import Map to prevent SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
const MapClickHandler = dynamic(() => import('@/components/shared/MapClickHandler'), { ssr: false })
const MapUpdater = dynamic(() => import('@/components/shared/MapUpdater'), { ssr: false })

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

const TYPES = ['FastFood', 'Fine Dining', 'Cafe', 'Bar', 'Cloud Kitchen', 'Resort/Hotel', 'Bakery', 'Restaurant']

export default function OnboardingCreateClient() {
    const router = useRouter()
    const supabase = createClient()
    const [isLoading, setIsLoading] = useState(false)
    const [isContinuing, setIsContinuing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    
    // Form State
    const [restaurantName, setRestaurantName] = useState('')
    const [slug, setSlug] = useState('')
    const [isSlugEdited, setIsSlugEdited] = useState(false)
    const [selectedType, setSelectedType] = useState('Restaurant')
    const [address, setAddress] = useState('')
    const [vatRegistered, setVatRegistered] = useState(false)
    
    // Modals
    const [isMapModalOpen, setIsMapModalOpen] = useState(false)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    
    // Map State
    const [position, setPosition] = useState<{lat: number, lng: number} | null>(null)
    
    useEffect(() => {
        iconFix()
    }, [])

    // Auto-generate slug from name if not manually edited
    useEffect(() => {
        if (!isSlugEdited && restaurantName) {
            setSlug(restaurantName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
        }
    }, [restaurantName, isSlugEdited])

    const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSlug(e.target.value)
        setIsSlugEdited(true)
    }

    const updatePositionAndAddress = async (lat: number, lng: number) => {
        setPosition({ lat, lng })
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
            const data = await res.json()
            if (data && data.display_name) {
                setAddress(data.display_name)
            }
        } catch (error) {
            console.error("Failed to reverse geocode", error)
        }
    }

    const handleSearchLocation = async () => {
        if (!address) return
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`)
            const data = await res.json()
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat)
                const lng = parseFloat(data[0].lon)
                setPosition({ lat, lng })
                setAddress(data[0].display_name)
            }
        } catch (error) {
            console.error("Failed to geocode", error)
        }
    }

    const handleCurrentLocation = () => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (pos) => updatePositionAndAddress(pos.coords.latitude, pos.coords.longitude),
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
        formData.append('vatRegistered', vatRegistered.toString())
        if (position) {
            formData.append('latitude', position.lat.toString())
            formData.append('longitude', position.lng.toString())
        }

        const countryCode = formData.get('countryCode') as string
        const contactPhoneRaw = formData.get('contactPhoneRaw') as string
        if (countryCode && contactPhoneRaw) {
            formData.set('contactPhone', `${countryCode} ${contactPhoneRaw}`)
        }

        try {
            const result = await createOnboardingRestaurant(formData)
            if (result.error) {
                setError(result.error)
                // Scroll to top to see error
                window.scrollTo({ top: 0, behavior: 'smooth' })
            } else if (result.success) {
                setIsSuccessModalOpen(true)
            }
        } catch (err) {
            setError('An unexpected error occurred')
            window.scrollTo({ top: 0, behavior: 'smooth' })
        } finally {
            setIsLoading(false)
        }
    }

    const handleContinue = async () => {
        setIsContinuing(true)
        await supabase.auth.refreshSession()
        router.refresh()
        router.push('/admin/dashboard')
    }

    const inputClasses = "w-full px-4 py-3.5 bg-white border border-gray-200 rounded-xl focus:border-[#ff5a00] focus:ring-1 focus:ring-[#ff5a00] outline-none transition-all text-sm placeholder:text-gray-400 text-gray-900"
    const labelClasses = "block text-sm font-semibold text-gray-900 mb-2"

    return (
        <>
            <div className="w-full max-w-3xl mx-auto bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] p-6 sm:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-gray-100 mb-10">
                <div className="flex items-center gap-4 mb-8">
                    <button 
                        type="button"
                        onClick={() => router.push('/onboarding')}
                        className="w-10 h-10 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors shrink-0"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">Configure Your Setup</h2>
                        <p className="text-sm text-gray-500">Provide details to bring your restaurant online.</p>
                    </div>
                </div>

                {error && (
                    <div className="mb-8 p-4 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 font-medium flex items-start gap-3">
                        <div className="mt-0.5">⚠️</div>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-10">
                    
                    {/* Section 1: Basic Details */}
                    <section>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Store size={20} className="text-[#ff5a00]" /> General Information
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="sm:col-span-2">
                                <label className={labelClasses}>Restaurant Name <span className="text-red-500">*</span></label>
                                <input 
                                    name="restaurantName"
                                    value={restaurantName}
                                    onChange={(e) => setRestaurantName(e.target.value)}
                                    required
                                    placeholder="e.g. Himalayan Kitchen"
                                    className={inputClasses}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={labelClasses}>Slogan / Tagline <span className="text-gray-400 font-normal">(optional)</span></label>
                                <input 
                                    name="slogan"
                                    placeholder="e.g. Taste of the Himalayas"
                                    className={inputClasses}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={labelClasses}>Business Type <span className="text-red-500">*</span></label>
                                <div className="flex flex-wrap gap-2.5">
                                    {TYPES.map(type => (
                                        <button
                                            key={type}
                                            type="button"
                                            onClick={() => setSelectedType(type)}
                                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                                                selectedType === type
                                                ? 'bg-[#ff5a00] border-[#ff5a00] text-white shadow-md'
                                                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                        >
                                            {type}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Section 2: Digital Identity */}
                    <section>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Globe size={20} className="text-[#ff5a00]" /> Digital Identity
                        </h3>
                        <div>
                            <label className={labelClasses}>Custom URL Slug <span className="text-red-500">*</span></label>
                            <div className="flex h-[52px] rounded-xl overflow-hidden border border-gray-200 focus-within:ring-1 focus-within:ring-[#ff5a00] focus-within:border-[#ff5a00] transition-all bg-white">
                                <div className="bg-gray-50 px-4 flex items-center justify-center border-r border-gray-200 text-gray-500 text-sm select-none">
                                    kkkhane.com/t/
                                </div>
                                <input 
                                    name="restaurantSlug" 
                                    value={slug} 
                                    onChange={handleSlugChange} 
                                    required
                                    placeholder="himalayan-kitchen" 
                                    className="flex-1 px-3 outline-none text-sm text-gray-900 placeholder:text-gray-400" 
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-2">Customers will scan QR codes leading to this URL to view your menu.</p>
                        </div>
                    </section>

                    {/* Section 3: Contact & Location */}
                    <section>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                            <Phone size={20} className="text-[#ff5a00]" /> Contact & Location
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                                <label className={labelClasses}>Primary Phone <span className="text-red-500">*</span></label>
                                <div className="flex h-[52px] w-full rounded-xl border border-gray-200 overflow-hidden bg-white focus-within:border-[#ff5a00] focus-within:ring-1 focus-within:ring-[#ff5a00] transition-all">
                                    <div className="flex items-center bg-gray-50 border-r border-gray-200">
                                        <select 
                                            name="countryCode"
                                            className="h-full px-3 outline-none bg-transparent text-sm text-gray-900 cursor-pointer appearance-none"
                                        >
                                            <option value="+977">🇳🇵 +977</option>
                                            <option value="+1">🇺🇸 +1</option>
                                            <option value="+44">🇬🇧 +44</option>
                                            <option value="+61">🇦🇺 +61</option>
                                            <option value="+91">🇮🇳 +91</option>
                                        </select>
                                    </div>
                                    <input
                                        name="contactPhoneRaw"
                                        type="tel"
                                        required
                                        placeholder="98XXXXXXX"
                                        className="flex-1 px-3 text-sm outline-none text-gray-900 w-full placeholder:text-gray-400"
                                    />
                                </div>
                            </div>
                            <div className="sm:col-span-2">
                                <label className={labelClasses}>Address & Map Location <span className="text-red-500">*</span></label>
                                <div className="flex gap-3">
                                    <input 
                                        name="address"
                                        required
                                        value={address}
                                        onChange={(e) => setAddress(e.target.value)}
                                        placeholder="Search or enter physical location"
                                        className={inputClasses}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setIsMapModalOpen(true)}
                                        className="w-[52px] h-[52px] flex items-center justify-center rounded-xl border border-gray-200 text-[#ff5a00] bg-orange-50 hover:bg-orange-100 transition-colors shrink-0 shadow-sm"
                                        title="Pin on Map"
                                    >
                                        <MapPin size={20} />
                                    </button>
                                </div>
                                {!position && <p className="text-xs text-orange-600 mt-2">Please pin your exact location on the map for delivery/customer accuracy.</p>}
                                {position && <p className="text-xs text-green-600 mt-2 font-medium">✓ Location pinned successfully.</p>}
                            </div>
                        </div>
                    </section>

                    {/* Section 4: Legal & Tax */}
                    <section>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 border-b border-gray-100 pb-2">
                            <FileText size={20} className="text-[#ff5a00]" /> Legal & Tax
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div>
                                <label className={labelClasses}>PAN Number <span className="text-gray-400 font-normal">(optional)</span></label>
                                <input 
                                    name="panNumber"
                                    placeholder="Enter 9-digit PAN"
                                    className={inputClasses}
                                />
                            </div>
                            <div className="flex flex-col justify-center pt-6">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        checked={vatRegistered}
                                        onChange={(e) => setVatRegistered(e.target.checked)}
                                        className="w-5 h-5 rounded border-gray-300 text-[#ff5a00] focus:ring-[#ff5a00]"
                                    />
                                    <span className="text-sm font-semibold text-gray-900">This business is VAT Registered (13%)</span>
                                </label>
                            </div>
                        </div>
                    </section>

                    <div className="pt-6 border-t border-gray-100 flex items-center gap-4">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#ff5a00]/25 disabled:opacity-50 transition-all hover:scale-[1.01] text-lg flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                'Provision Restaurant'
                            )}
                        </button>
                    </div>
                </form>
            </div>

            {/* Map Modal */}
            {isMapModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/50 backdrop-blur-sm animate-in fade-in">
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
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            handleSearchLocation()
                                        }
                                    }}
                                />
                                <button type="button" onClick={handleSearchLocation} className="text-[#ff5a00] font-semibold text-sm px-2 hover:text-[#ff4500]">Search</button>
                            </div>
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="w-12 h-[52px] bg-white rounded-xl shadow-lg border border-gray-100 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors shrink-0"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Current Location Overlay Button */}
                        <div className="absolute bottom-24 right-4 sm:right-10 z-[1000]">
                            <button 
                                onClick={handleCurrentLocation}
                                className="bg-white text-[#ff5a00] font-semibold text-sm px-4 py-3 rounded-xl shadow-lg border border-gray-100 flex items-center gap-2 hover:bg-orange-50 transition-colors"
                            >
                                <MapPin size={16} /> <span className="hidden sm:inline">Use current location</span>
                            </button>
                        </div>

                        {/* Map Footer Overlay Buttons */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-[1000] flex gap-4">
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="flex-1 bg-white text-gray-700 font-bold py-3.5 rounded-xl shadow-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => setIsMapModalOpen(false)}
                                className="flex-1 bg-[#ff5a00] text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-[#ff4500] transition-colors flex items-center justify-center gap-2"
                            >
                                ✓ Save Location
                            </button>
                        </div>

                        <div className="flex-1 w-full bg-gray-100">
                            {typeof window !== 'undefined' && (
                                <MapContainer 
                                    center={position || [27.7172, 85.3240]} // Default to Kathmandu, Nepal
                                    zoom={13} 
                                    style={{ height: '100%', width: '100%' }}
                                    zoomControl={false}
                                >
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    />
                                    {position && <Marker position={position} />}
                                    <MapClickHandler onLocationSelect={(lat, lng) => updatePositionAndAddress(lat, lng)} />
                                    <MapUpdater center={position} />
                                </MapContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Success Modal */}
            {isSuccessModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-lg rounded-[2rem] p-10 text-center shadow-2xl relative overflow-hidden">
                        
                        {/* Orange Glow Effect */}
                        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#ff5a00] rounded-full blur-[100px] opacity-20 pointer-events-none"></div>
                        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-[#ff5a00] rounded-full blur-[100px] opacity-20 pointer-events-none"></div>

                        <div className="relative z-10 flex flex-col items-center">
                            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mb-6 text-[#ff5a00]">
                                <Store size={40} />
                            </div>
                            <h2 className="text-3xl font-extrabold text-gray-900 mb-3 tracking-tight">Setup Complete!</h2>
                            <p className="text-[15px] text-gray-500 font-medium leading-relaxed mb-8 max-w-sm mx-auto">
                                Your restaurant is now provisioned and ready for business. Let's head to your management dashboard.
                            </p>

                            <button
                                onClick={handleContinue}
                                disabled={isContinuing}
                                className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-105 disabled:opacity-50 flex items-center justify-center"
                            >
                                {isContinuing ? (
                                    <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    "Go to Dashboard"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
