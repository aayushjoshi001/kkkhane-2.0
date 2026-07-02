'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { signupRestaurant } from './actions'
import {
    ChevronRight, ChevronLeft, Check, Loader2, Building2,
    User, Zap, Crown, Star, Sparkles, MapPin, Phone, Mail,
    FileText, Camera, Navigation, X, AlertTriangle,
} from 'lucide-react'
import Image from 'next/image'
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

type Step = 1 | 2 | 3 | 4

const STEPS: { label: string; icon: React.ReactNode }[] = [
    { label: 'Plan', icon: <Zap size={16} /> },
    { label: 'Restaurant', icon: <Building2 size={16} /> },
    { label: 'Account', icon: <User size={16} /> },
    { label: 'Review', icon: <FileText size={16} /> },
]

const PLANS = [
    {
        id: 'free' as const,
        name: 'Free',
        price: 'रू 0',
        period: '/month',
        icon: <Zap size={20} className="text-gray-500" />,
        color: 'border-gray-200',
        selectedColor: 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 ring-1 ring-[var(--color-primary)]',
        limits: '3 staff · 20 menu items',
        features: ['Menu management', 'QR ordering', 'Cash & QR payments', 'Service requests', 'Split billing'],
    },
    {
        id: 'basic' as const,
        name: 'Basic',
        price: 'रू 1,999',
        period: '/month',
        icon: <Star size={20} className="text-blue-500" />,
        color: 'border-blue-100',
        selectedColor: 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 ring-1 ring-[var(--color-primary)]',
        limits: '10 staff · 100 menu items',
        features: ['Everything in Free', 'Takeout orders', 'Promo codes', 'Advanced analytics'],
    },
    {
        id: 'pro' as const,
        name: 'Pro',
        price: 'रू 4,999',
        period: '/month',
        icon: <Crown size={20} className="text-[var(--color-primary)]" />,
        color: 'border-orange-100',
        selectedColor: 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 ring-1 ring-[var(--color-primary)]',
        limits: '50 staff · 500 menu items',
        features: ['Everything in Basic', 'Loyalty program', 'Dynamic pricing', 'Ingredient tracking', 'Staff shifts'],
        recommended: true,
    },
    {
        id: 'enterprise' as const,
        name: 'Enterprise',
        price: 'Custom',
        period: '',
        icon: <Sparkles size={20} className="text-purple-500" />,
        color: 'border-purple-100',
        selectedColor: 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 ring-1 ring-[var(--color-primary)]',
        limits: 'Unlimited staff & menu',
        features: ['Everything in Pro', 'Multi-language', 'Dedicated support', 'Custom integrations'],
    },
]

function slugify(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const INPUT = 'h-11 w-full px-4 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] transition-all bg-white placeholder:text-gray-400'

export default function SignupForm() {
    const router = useRouter()
    const supabase = createClient()
    const logoInputRef = useRef<HTMLInputElement>(null)

    const [mounted, setMounted] = useState(false)
    const [step, setStep] = useState<Step>(1)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [globalError, setGlobalError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

    // Step 1
    const [plan, setPlan] = useState<'free' | 'basic' | 'pro' | 'enterprise'>('pro')

    // Step 2 — restaurant details
    const [restaurantName, setRestaurantName] = useState('')
    const [restaurantSlug, setRestaurantSlug] = useState('')
    const [slogan, setSlogan] = useState('')
    const [address, setAddress] = useState('')
    const [latitude, setLatitude] = useState<number | null>(null)
    const [longitude, setLongitude] = useState<number | null>(null)
    const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const [phone, setPhone] = useState('')
    const [telephone, setTelephone] = useState('')
    const [restaurantEmail, setRestaurantEmail] = useState('')
    const [panNumber, setPanNumber] = useState('')
    const [vatRegistered, setVatRegistered] = useState(false)
    const [vatNumber, setVatNumber] = useState('')
    const [logoFile, setLogoFile] = useState<File | null>(null)
    const [logoPreview, setLogoPreview] = useState<string | null>(null)
    // Tracks the live object URL so we can revoke the old one before replacing it
    // and on unmount — otherwise each logo pick leaks a blob URL.
    const logoPreviewRef = useRef<string | null>(null)

    // Step 3 — owner
    const [ownerName, setOwnerName] = useState('')
    const [ownerEmail, setOwnerEmail] = useState('')
    const [ownerPassword, setOwnerPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isMapModalOpen, setIsMapModalOpen] = useState(false)

    useEffect(() => { setMounted(true); iconFix() }, [])
    useEffect(() => () => { if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current) }, [])

    // Force map to recalculate bounds when modal opens
    useEffect(() => {
        if (isMapModalOpen) {
            const timer = setTimeout(() => {
                window.dispatchEvent(new Event('resize'))
            }, 150)
            return () => clearTimeout(timer)
        }
    }, [isMapModalOpen])

    const selectedPlan = PLANS.find(p => p.id === plan)!

    const handleNameChange = (value: string) => {
        setRestaurantName(value)
        if (!restaurantSlug || restaurantSlug === slugify(restaurantName)) {
            setRestaurantSlug(slugify(value))
        }
    }

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (file.size > 2 * 1024 * 1024) { setFieldErrors(p => ({ ...p, logo: 'Logo must be under 2 MB' })); return }
        setLogoFile(file)
        if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current)
        const url = URL.createObjectURL(file)
        logoPreviewRef.current = url
        setLogoPreview(url)
        setFieldErrors(p => { const n = { ...p }; delete n.logo; return n })
    }

    const handleGeolocate = () => {
        if (!navigator.geolocation) { setGeoStatus('error'); return }
        setGeoStatus('loading')
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords
                setLatitude(lat)
                setLongitude(lng)
                // Reverse geocode via OpenStreetMap Nominatim (free, no key needed)
                try {
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
                        { headers: { 'Accept-Language': 'en' } }
                    )
                    const json = await res.json()
                    const display = json.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                    setAddress(display)
                } catch {
                    setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
                }
                setGeoStatus('done')
            },
            () => setGeoStatus('error'),
            { timeout: 10000, maximumAge: 60000 }
        )
    }

    const clearGeo = () => {
        setLatitude(null); setLongitude(null); setGeoStatus('idle'); setAddress('')
    }

    const validateStep = (): boolean => {
        const errors: Record<string, string> = {}

        if (step === 2) {
            if (!restaurantName.trim() || restaurantName.trim().length < 2) errors.restaurantName = 'Restaurant name is required (2+ characters)'
            if (!restaurantSlug.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(restaurantSlug)) errors.restaurantSlug = 'Slug must be lowercase letters, numbers, and hyphens only'
            if (panNumber && !/^\d{9}$/.test(panNumber.trim())) errors.panNumber = 'PAN number must be exactly 9 digits'
            if (vatRegistered && vatNumber && !/^\d{9}$/.test(vatNumber.trim())) errors.vatNumber = 'VAT number must be exactly 9 digits'
            if (restaurantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(restaurantEmail)) errors.restaurantEmail = 'Invalid email address'
            if (phone && !/^\+?[\d\s\-()]{7,}$/.test(phone.trim())) errors.phone = 'Invalid phone format (must be at least 7 digits)'
        }

        if (step === 3) {
            if (!ownerName.trim() || ownerName.trim().length < 2) errors.ownerName = 'Full name is required'
            if (!ownerEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) errors.ownerEmail = 'Valid email address is required'
            if (ownerPassword.length < 8) errors.ownerPassword = 'Password must be at least 8 characters'
            if (ownerPassword !== confirmPassword) errors.confirmPassword = 'Passwords do not match'
        }

        setFieldErrors(errors)
        return Object.keys(errors).length === 0
    }

    const handleNext = () => { if (validateStep()) setStep((s) => Math.min(s + 1, 4) as Step) }
    const handleBack = () => { setGlobalError(''); setStep((s) => Math.max(s - 1, 1) as Step) }

    const handleSubmit = async () => {
        setIsSubmitting(true)
        setGlobalError('')

        const result = await signupRestaurant({
            restaurantName,
            restaurantSlug,
            ownerFullName: ownerName,
            ownerEmail,
            ownerPassword,
            contactPhone: phone || undefined,
            address: address || undefined,
            slogan: slogan || undefined,
            telephone: telephone || undefined,
            restaurantEmail: restaurantEmail || undefined,
            panNumber: panNumber || undefined,
            vatRegistered,
            vatNumber: vatNumber || undefined,
            latitude: latitude ?? undefined,
            longitude: longitude ?? undefined,
            subscriptionTier: plan,
        })

        if (result.error) {
            setGlobalError(result.error)
            if (result.field) {
                setFieldErrors({ [result.field]: result.error })
                if (result.field === 'restaurantSlug') setStep(2)
                if (result.field === 'ownerEmail') setStep(3)
            }
            setIsSubmitting(false)
            return
        }

        // Auto sign-in
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: ownerEmail, password: ownerPassword,
        })

        if (!signInError && logoFile) {
            // Upload logo after sign-in so we have auth context
            try {
                const ext = logoFile.name.split('.').pop()
                const path = `logos/${restaurantSlug}-${Date.now()}.${ext}`
                const { error: uploadErr } = await supabase.storage
                    .from('restaurant-assets')
                    .upload(path, logoFile, { upsert: true })
                if (!uploadErr) {
                    const { data: { publicUrl } } = supabase.storage
                        .from('restaurant-assets')
                        .getPublicUrl(path)
                    // Update logo_url on restaurant
                    await supabase
                        .from('restaurants')
                        .update({ logo_url: publicUrl })
                        .eq('slug', restaurantSlug)
                }
            } catch { /* logo upload is optional — don't block */ }
        }

        router.push(signInError ? '/login?registered=1' : '/admin/dashboard')
    }

    return (
        <div className="min-h-screen bg-slate-50 relative flex items-center justify-center p-4">
            {/* Ambient Dot Grid Background */}
            <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-60 pointer-events-none"></div>
            
            <div className="w-full max-w-2xl relative z-10 my-8">
                <div className="text-center mb-10">
                    <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">Create Your Restaurant</h1>
                    <p className="text-gray-500 font-medium mt-3">Get started in minutes. No credit card required.</p>
                </div>

                {mounted && (
                    <div className="mb-10 mt-4 w-full max-w-lg mx-auto px-4">
                        {/* Segmented progress track + counter */}
                        <div className="flex items-center gap-3 mb-6">
                            <div className="flex-1 flex gap-1.5">
                                {STEPS.map((s, i) => (
                                    <div key={s.label} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i + 1 <= step ? 'bg-[var(--color-primary)]' : 'bg-gray-200'}`} />
                                ))}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 bg-white border border-gray-100 rounded-full pl-2 pr-3 py-1 shadow-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
                                <span className="text-xs font-bold text-gray-600">{step} of {STEPS.length}</span>
                            </div>
                        </div>

                        {/* Step nodes with connecting lines */}
                        <div className="flex items-center w-full">
                            {STEPS.map((s, i) => {
                                const num = i + 1
                                const done = num < step
                                const active = num === step
                                return (
                                    <Fragment key={s.label}>
                                        {active ? (
                                            <div className="flex items-center gap-2 pl-1.5 pr-4 h-12 rounded-2xl bg-[var(--color-primary)] text-white shadow-md shadow-[var(--color-primary)]/25 shrink-0 transition-all duration-300">
                                                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                                                    {s.icon}
                                                </div>
                                                <div className="leading-tight whitespace-nowrap">
                                                    <div className="text-[10px] font-medium text-white/80">Step {num}</div>
                                                    <div className="text-xs font-bold">{s.label}</div>
                                                </div>
                                            </div>
                                        ) : done ? (
                                            <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)] text-white flex items-center justify-center shrink-0 shadow-sm transition-all duration-300">
                                                <Check size={16} strokeWidth={3} />
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 rounded-xl border-2 border-gray-200 bg-white text-gray-300 flex items-center justify-center shrink-0 transition-all duration-300">
                                                {s.icon}
                                            </div>
                                        )}
                                        {i < STEPS.length - 1 && (
                                            <div className={`flex-1 h-0.5 min-w-4 mx-1.5 rounded-full transition-colors duration-500 ${num < step ? 'bg-[var(--color-primary)]' : 'bg-gray-200'}`} />
                                        )}
                                    </Fragment>
                                )
                            })}
                        </div>
                    </div>
                )}

                <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-gray-100 overflow-hidden">
                    {/* ── Step 1: Plan ── */}
                    {step === 1 && (
                        <div className="p-6 space-y-4">
                            <h2 className="text-xl font-semibold text-gray-900">Choose your plan</h2>
                            <p className="text-sm text-gray-500">No payment required now. Upgrade anytime.</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {PLANS.map((p) => (
                                    <button key={p.id} onClick={() => setPlan(p.id)}
                                            className={`relative text-left p-5 rounded-2xl border transition-all hover:shadow-lg ${plan === p.id ? p.selectedColor : `${p.color} bg-white hover:border-gray-300`}`}>
                                        {p.recommended && (
                                            <span className="absolute -top-3 left-4 bg-[var(--color-primary)] text-white text-xs font-bold px-3 py-1 rounded-full shadow-sm">Recommended</span>
                                        )}
                                        <div className="flex items-center gap-2 mb-2">
                                            {p.icon}
                                            <span className="font-semibold text-gray-900">{p.name}</span>
                                            {plan === p.id && <Check size={14} className="text-green-600 ml-auto" />}
                                        </div>
                                        <div className="text-lg font-bold text-gray-900">{p.price}<span className="text-sm font-normal text-gray-400">{p.period}</span></div>
                                        <div className="text-xs text-gray-500 mt-1">{p.limits}</div>
                                        <ul className="mt-3 space-y-1">
                                            {p.features.map((f) => (
                                                <li key={f} className="text-xs text-gray-600 flex items-center gap-1.5">
                                                    <Check size={11} className="text-green-500 shrink-0" />{f}
                                                </li>
                                            ))}
                                        </ul>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Step 2: Restaurant Details ── */}
                    {step === 2 && (
                        <div className="p-8 space-y-6">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Building2 size={22} className="text-[var(--color-primary)]" /> Restaurant Details
                            </h2>

                            {/* Logo upload */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Restaurant Logo <span className="text-gray-400 font-normal">(optional)</span></label>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                                        {logoPreview ? (
                                            <Image src={logoPreview} alt="Logo preview" width={80} height={80} className="w-full h-full object-cover" />
                                        ) : (
                                            <Camera size={24} className="text-gray-300" />
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <button type="button" onClick={() => logoInputRef.current?.click()}
                                                className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 transition">
                                            {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                        </button>
                                        {logoPreview && (
                                            <button type="button" onClick={() => { setLogoFile(null); if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current); logoPreviewRef.current = null; setLogoPreview(null) }}
                                                    className="block text-xs text-red-500 hover:underline">Remove</button>
                                        )}
                                        <p className="text-xs text-gray-400">JPG, PNG · Max 2 MB · Can be changed in Settings</p>
                                    </div>
                                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                                </div>
                                {fieldErrors.logo && <p className="text-red-500 text-xs mt-1">{fieldErrors.logo}</p>}
                            </div>

                            {/* Name + Slug */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant Name *</label>
                                    <input type="text" value={restaurantName} onChange={(e) => handleNameChange(e.target.value)}
                                           placeholder="e.g. Himalayan Kitchen"
                                           className={`${INPUT} ${fieldErrors.restaurantName ? 'border-red-400' : 'border-gray-300'}`} />
                                    {fieldErrors.restaurantName && <p className="text-red-500 text-xs mt-1">{fieldErrors.restaurantName}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Slogan <span className="text-gray-400 font-normal">(optional)</span></label>
                                    <input type="text" value={slogan} onChange={(e) => setSlogan(e.target.value)}
                                           placeholder="Taste of the Himalayas"
                                           className={`${INPUT} border-gray-300`} maxLength={120} />
                                </div>
                            </div>

                            {/* Slug */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">URL Slug *</label>
                                <div className="flex h-11 rounded-xl border border-gray-200 overflow-hidden bg-white focus-within:ring-1 focus-within:ring-[var(--color-primary)] focus-within:border-[var(--color-primary)] transition-all">
                                    <span className="bg-gray-50 px-4 flex items-center text-sm text-gray-400 border-r border-gray-200 shrink-0 font-medium">kkkhane.com/t/</span>
                                    <input type="text" value={restaurantSlug} onChange={(e) => setRestaurantSlug(slugify(e.target.value))}
                                           placeholder="himalayan-kitchen"
                                           className={`flex-1 px-3 text-sm focus:outline-none ${fieldErrors.restaurantSlug ? 'border-red-400' : ''}`} />
                                </div>
                                {fieldErrors.restaurantSlug
                                    ? <p className="text-red-500 text-xs mt-1">{fieldErrors.restaurantSlug}</p>
                                    : <p className="text-gray-400 text-xs mt-1">URL your customers will scan on QR codes</p>}
                            </div>

                            {/* Address with live geolocation */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <MapPin size={13} className="inline mr-1 text-gray-400" />Address
                                </label>
                                <div className="flex gap-3">
                                    <input type="text" value={address} onChange={(e) => { setAddress(e.target.value); if (geoStatus === 'done') setGeoStatus('idle') }}
                                           placeholder="Search Location"
                                           className={`${INPUT} border-gray-200 flex-1`} />
                                    <button type="button" onClick={() => setIsMapModalOpen(true)}
                                            title="Open Map"
                                            className="w-[52px] h-[52px] shrink-0 rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition flex items-center justify-center shadow-sm">
                                        <MapPin size={20} />
                                    </button>
                                </div>
                                {geoStatus === 'error' && (
                                    <p className="text-amber-600 text-xs mt-1 flex items-center gap-1">
                                        <AlertTriangle size={11} /> Location access denied. Enter address manually.
                                    </p>
                                )}
                                {geoStatus === 'done' && latitude && (
                                    <p className="text-green-600 text-xs mt-1">
                                        GPS captured: {latitude.toFixed(5)}, {longitude?.toFixed(5)}
                                    </p>
                                )}
                            </div>

                            {/* Phone + Telephone */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        <Phone size={13} className="inline mr-1 text-gray-400" />Mobile Number
                                    </label>
                                    <input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setFieldErrors(p => ({ ...p, phone: '' })) }}
                                           placeholder="+977 98XXXXXXXX"
                                           className={`${INPUT} ${fieldErrors.phone ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200'}`} />
                                    {fieldErrors.phone && <p className="text-red-500 text-xs mt-1">{fieldErrors.phone}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        <Phone size={13} className="inline mr-1 text-gray-400" />Telephone <span className="text-gray-400 font-normal">(landline, optional)</span>
                                    </label>
                                    <input type="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)}
                                           placeholder="01-XXXXXXX"
                                           className={`${INPUT} border-gray-300`} />
                                </div>
                            </div>

                            {/* Restaurant email */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Mail size={13} className="inline mr-1 text-gray-400" />Restaurant Email <span className="text-gray-400 font-normal">(optional, for customers to contact)</span>
                                </label>
                                <input type="email" value={restaurantEmail} onChange={(e) => setRestaurantEmail(e.target.value)}
                                       placeholder="info@himalayankitchen.com"
                                       className={`${INPUT} ${fieldErrors.restaurantEmail ? 'border-red-400' : 'border-gray-300'}`} />
                                {fieldErrors.restaurantEmail && <p className="text-red-500 text-xs mt-1">{fieldErrors.restaurantEmail}</p>}
                            </div>

                            {/* PAN / VAT */}
                            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                                    <FileText size={12} /> Tax Registration
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">PAN Number <span className="text-gray-400 font-normal">(optional)</span></label>
                                        <input type="text" value={panNumber}
                                               onChange={(e) => setPanNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                                               placeholder="9 digits"
                                               className={`${INPUT} ${fieldErrors.panNumber ? 'border-red-400' : 'border-gray-300'}`} />
                                        {fieldErrors.panNumber && <p className="text-red-500 text-xs mt-1">{fieldErrors.panNumber}</p>}
                                    </div>
                                    <div className="flex items-end pb-1">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={vatRegistered} onChange={(e) => setVatRegistered(e.target.checked)}
                                                   className="w-4 h-4 rounded accent-[#FB6303]" />
                                            <span className="text-sm text-gray-700">VAT Registered</span>
                                        </label>
                                    </div>
                                </div>
                                {vatRegistered && (
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number *</label>
                                        <input type="text" value={vatNumber}
                                               onChange={(e) => setVatNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                                               placeholder="9-digit VAT number"
                                               className={`${INPUT} ${fieldErrors.vatNumber ? 'border-red-400' : 'border-gray-300'}`} />
                                        {fieldErrors.vatNumber && <p className="text-red-500 text-xs mt-1">{fieldErrors.vatNumber}</p>}
                                        <p className="text-xs text-blue-600 mt-1">
                                            VAT billing will apply Nepal government VAT rate (13%) on all receipts.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Owner Account ── */}
                    {step === 3 && (
                        <div className="p-8 space-y-6">
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <User size={22} className="text-[var(--color-primary)]" /> Owner Account
                            </h2>
                            <p className="text-sm text-gray-500">This is your personal login — keep it secure.</p>

                            {[
                                { id: 'ownerName', label: 'Full Name *', type: 'text', val: ownerName, set: setOwnerName, ph: 'Ram Prasad Sharma' },
                                { id: 'ownerEmail', label: 'Email Address *', type: 'email', val: ownerEmail, set: setOwnerEmail, ph: 'owner@restaurant.com' },
                                { id: 'ownerPassword', label: 'Password *', type: 'password', val: ownerPassword, set: setOwnerPassword, ph: 'At least 8 characters' },
                                { id: 'confirmPassword', label: 'Confirm Password *', type: 'password', val: confirmPassword, set: setConfirmPassword, ph: 'Re-enter password' },
                            ].map(f => (
                                <div key={f.id}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                                    <input type={f.type} value={f.val} onChange={(e) => f.set(e.target.value)} placeholder={f.ph}
                                           className={`${INPUT} ${fieldErrors[f.id] ? 'border-red-400' : 'border-gray-300'}`} />
                                    {fieldErrors[f.id] && <p className="text-red-500 text-xs mt-1">{fieldErrors[f.id]}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── Step 4: Review ── */}
                    {step === 4 && (
                        <div className="p-8 space-y-6">
                            <h2 className="text-xl font-bold text-gray-900">Review & Create</h2>
                            <div className="bg-gray-50 rounded-2xl border border-gray-100 divide-y divide-gray-100 text-sm overflow-hidden shadow-sm">
                                {[
                                    { label: 'Plan', value: `${selectedPlan.name} — ${selectedPlan.price}${selectedPlan.period}` },
                                    { label: 'Restaurant', value: restaurantName },
                                    slogan ? { label: 'Slogan', value: slogan } : null,
                                    { label: 'URL', value: `/t/${restaurantSlug}` },
                                    address ? { label: 'Address', value: address } : null,
                                    latitude ? { label: 'GPS', value: `${latitude.toFixed(5)}, ${longitude?.toFixed(5)}` } : null,
                                    phone ? { label: 'Mobile', value: phone } : null,
                                    telephone ? { label: 'Telephone', value: telephone } : null,
                                    restaurantEmail ? { label: 'Restaurant Email', value: restaurantEmail } : null,
                                    panNumber ? { label: 'PAN', value: `${panNumber}${vatRegistered ? ' · VAT Registered' : ''}` } : null,
                                    vatRegistered && vatNumber ? { label: 'VAT No.', value: vatNumber } : null,
                                    { label: 'Owner', value: ownerName },
                                    { label: 'Login Email', value: ownerEmail },
                                    logoFile ? { label: 'Logo', value: logoFile.name } : null,
                                ].filter(Boolean).map((row) => (
                                    <div key={row!.label} className="px-4 py-3 flex justify-between gap-4">
                                        <span className="text-gray-500 shrink-0">{row!.label}</span>
                                        <span className="font-medium text-gray-900 text-right break-all">{row!.value}</span>
                                    </div>
                                ))}
                            </div>

                            {globalError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
                                    <X size={15} className="shrink-0 mt-0.5" />{globalError}
                                </div>
                            )}
                            <p className="text-xs text-gray-400 text-center">
                                By creating an account you agree to our Terms of Service and Privacy Policy.
                            </p>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className={`px-8 py-5 bg-gray-50 border-t border-gray-100 flex ${step > 1 ? 'justify-between' : 'justify-end'}`}>
                        {step > 1 && (
                            <button onClick={handleBack} disabled={isSubmitting}
                                    className="flex items-center gap-2 px-5 py-2.5 h-11 text-sm font-bold text-gray-600 hover:text-gray-900 border border-gray-200 bg-white rounded-xl hover:bg-gray-100 transition disabled:opacity-50">
                                <ChevronLeft size={16} /> Back
                            </button>
                        )}
                        {step < 4 ? (
                            <button onClick={handleNext}
                                    className="flex items-center gap-2 px-8 h-11 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 shadow-md shadow-gray-900/20 transition">
                                Continue <ChevronRight size={16} />
                            </button>
                        ) : (
                            <button onClick={handleSubmit} disabled={isSubmitting}
                                    className="flex items-center gap-2 px-8 h-11 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white text-sm font-bold rounded-xl shadow-lg shadow-[var(--color-primary)]/20 transition disabled:opacity-60">
                                {isSubmitting
                                    ? <><Loader2 size={16} className="animate-spin" /> Creating...</>
                                    : <><Check size={16} /> Create My Restaurant</>}
                            </button>
                        )}
                    </div>
                </div>

                <p className="text-center text-sm text-gray-500 mt-6 font-medium">
                    Already have an account?{' '}
                    <a href="/login" className="font-bold text-[var(--color-primary)] hover:underline">Sign in</a>
                </p>
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
                                onClick={handleGeolocate}
                                className="bg-white text-red-500 font-bold text-sm px-6 py-3 rounded-xl shadow-lg border border-gray-100 flex items-center gap-2 hover:bg-gray-50 transition-colors"
                            >
                                {geoStatus === 'loading' ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />} 
                                Use current location
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
                                className="flex-1 bg-[#8FBFA0] text-white font-bold py-3.5 rounded-xl shadow-lg hover:bg-[#7eac8f] transition-colors flex items-center justify-center gap-2"
                            >
                                ✓ Save location
                            </button>
                        </div>

                        <div className="flex-1 w-full bg-gray-100">
                            {typeof window !== 'undefined' && (
                                <MapContainer 
                                    center={(latitude && longitude) ? [latitude, longitude] : [28.2096, 83.9856]} 
                                    zoom={13} 
                                    style={{ height: '100%', width: '100%' }}
                                    zoomControl={false}
                                >
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    />
                                    {(latitude && longitude) && <Marker position={[latitude, longitude]} />}
                                    <MapClickHandler onLocationSelect={(lat, lng) => { setLatitude(lat); setLongitude(lng); }} />
                                </MapContainer>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
