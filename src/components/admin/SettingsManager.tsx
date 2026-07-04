'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Save, Store, Mail, Phone, MapPin, Building, Percent, Check, Loader2, QrCode, Shield, ToggleLeft, ToggleRight, Upload, X, Bell, Play, Clock } from 'lucide-react'
import { updateRestaurantSettingsAction, updateBusinessHoursAction } from '@/app/(admin)/admin/settings/actions'
import { updateFeaturesAction } from '@/lib/features'
import { toast } from 'react-hot-toast'
import type { Settings, BusinessHours, DayHours } from '@/types/database'
import { unlockAudio, setCustomNotificationSound, playNewOrder } from '@/lib/audio'

type RestaurantSettings = {
    id: string
    name: string
    logo_url: string | null
    contact_email: string | null
    contact_phone: string | null
    address: string | null
    tax_rate: number
    currency: string
    currency_symbol: string | null
    pan_number: string | null
    vat_registered: boolean
    payment_qr_url: string | null
    payment_qr_label: string | null
    allowed_ips: string | null
}

type Features = Settings['features_v2']

const WEEKDAYS: { key: string; label: string }[] = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' },
]

const DEFAULT_DAY: DayHours = { open: '09:00', close: '22:00', closed: false }

function buildBusinessHours(initial: BusinessHours | null): BusinessHours {
    return Object.fromEntries(
        WEEKDAYS.map(({ key }) => [key, { ...DEFAULT_DAY, ...(initial?.[key] ?? {}) }])
    )
}

export default function SettingsManager({
    initialRestaurant,
    initialFeatures,
    initialBusinessHours,
    canEdit
}: {
    initialRestaurant: RestaurantSettings
    initialFeatures: Features | null
    initialBusinessHours: BusinessHours | null
    canEdit: boolean
}) {
    const [formData, setFormData] = useState<RestaurantSettings>(initialRestaurant)
    const [features, setFeatures] = useState<Features>(initialFeatures || {
        loyaltyEnabled: false,
        promosEnabled: true,
        takeoutEnabled: false,
        multiLanguageEnabled: false,
        serviceRequestsEnabled: true,
        splitBillingEnabled: true,
        dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false,
        staffShiftsEnabled: false,
        defaultTaxRate: 13.0,
        currency: 'NPR',
        currencySymbol: 'Rs.',
        nepalPayEnabled: false,
        vatEnabled: false,
        phoneOtpEnabled: false,
        bsDateEnabled: false,
        feedbackEnabled: true,
    })
    const [taxRateStr, setTaxRateStr] = useState((initialRestaurant.tax_rate ?? 13).toString())
    const [businessHours, setBusinessHours] = useState<BusinessHours>(() => buildBusinessHours(initialBusinessHours))

    const updateDayHours = (day: string, patch: Partial<DayHours>) => {
        setBusinessHours(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }))
    }
    const [uploadingField, setUploadingField] = useState<'logo_url' | 'payment_qr_url' | 'notification_sound' | null>(null)
    const logoInputRef = useRef<HTMLInputElement>(null)
    const qrInputRef = useRef<HTMLInputElement>(null)
    const soundInputRef = useRef<HTMLInputElement>(null)

    const handleFileUpload = async (file: File, field: 'logo_url' | 'payment_qr_url') => {
        setUploadingField(field)
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', 'image')
        fd.append('folder', 'settings')
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Upload failed')
            } else {
                setFormData(prev => ({ ...prev, [field]: data.url }))
                toast.success(field === 'logo_url' ? 'Logo uploaded' : 'QR uploaded')
            }
        } catch {
            toast.error('Network error during upload')
        } finally {
            setUploadingField(null)
        }
    }

    const handleSoundUpload = async (file: File) => {
        setUploadingField('notification_sound')
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', 'audio')
        fd.append('folder', 'sounds')
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Upload failed')
            } else {
                await updateFeaturesAction(formData.id, { notificationSoundUrl: data.url })
                setFeatures(prev => ({ ...prev, notificationSoundUrl: data.url }))
                toast.success('Notification sound uploaded')
            }
        } catch {
            toast.error('Network error during upload')
        } finally {
            setUploadingField(null)
        }
    }

    const handleRemoveSound = async () => {
        await updateFeaturesAction(formData.id, { notificationSoundUrl: null })
        setFeatures(prev => ({ ...prev, notificationSoundUrl: null }))
        toast.success('Notification sound removed')
    }

    const [testingSound, setTestingSound] = useState(false)
    // Play exactly what kitchen/waiter screens will hear: unlock the audio context
    // (autoplay policy), point the shared player at the chosen sound, then play it.
    // Surfaces failures instead of swallowing them like the old new Audio().catch().
    const handleTestSound = async () => {
        setTestingSound(true)
        try {
            await unlockAudio()
            setCustomNotificationSound(features.notificationSoundUrl ?? null)
            await playNewOrder()
        } catch {
            toast.error('Could not play the sound. Check the file format, or tap the page once and retry.')
        } finally {
            setTimeout(() => setTestingSound(false), 600)
        }
    }
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSavingFeatures, setIsSavingFeatures] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target
        const finalValue = type === 'number' ? parseFloat(value) : value
        setFormData({ ...formData, [name]: finalValue })
    }

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = e.target
        setFormData({ ...formData, [name]: checked })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!canEdit) return

        setIsSubmitting(true)
        setIsSuccess(false)

        const finalTaxRate = taxRateStr === '' ? 0 : Number.parseFloat(taxRateStr)

        // Save restaurant, features and business hours in parallel
        const [resRestaurant, resFeatures, resHours] = await Promise.all([
            updateRestaurantSettingsAction(formData.id, {
                name: formData.name,
                contact_phone: formData.contact_phone,
                contact_email: formData.contact_email,
                address: formData.address,
                logo_url: formData.logo_url,
                pan_number: formData.pan_number,
                vat_registered: formData.vat_registered,
                payment_qr_url: formData.payment_qr_url,
                payment_qr_label: formData.payment_qr_label,
                allowed_ips: formData.allowed_ips,
            }),
            updateFeaturesAction(formData.id, {
                defaultTaxRate: finalTaxRate,
                currency: features.currency,
                currencySymbol: features.currencySymbol,
            }),
            updateBusinessHoursAction(formData.id, businessHours),
        ])

        if (resRestaurant.success && resFeatures.success && resHours.success) {
            setIsSuccess(true)
            toast.success('Settings saved successfully')
            setTimeout(() => setIsSuccess(false), 3000)
        } else {
            toast.error(resRestaurant.error || resFeatures.error || resHours.error || 'Failed to save settings')
        }

        setIsSubmitting(false)
    }

    const toggleFeature = async (key: keyof Features) => {
        if (!canEdit) return
        const newValue = !features[key]
        const updated = { ...features, [key]: newValue }
        setFeatures(updated)

        setIsSavingFeatures(true)
        const res = await updateFeaturesAction(formData.id, { [key]: newValue })
        if (res.error) {
            toast.error('Failed to save feature toggle')
            setFeatures(features) // revert
        }
        setIsSavingFeatures(false)
    }

    // Manager-configurable quick-serve items (water, cold drinks, tissue…).
    const [newQuickItem, setNewQuickItem] = useState('')
    const quickServeItems: string[] = (features as { quickServeItems?: string[] }).quickServeItems ?? []

    const saveQuickItems = async (items: string[]) => {
        if (!canEdit) return
        const prev = features
        const updated = { ...features, quickServeItems: items }
        setFeatures(updated)
        setIsSavingFeatures(true)
        const res = await updateFeaturesAction(formData.id, { quickServeItems: items } as Partial<Features>)
        if (res.error) {
            toast.error('Failed to save quick items')
            setFeatures(prev)
        }
        setIsSavingFeatures(false)
    }

    const addQuickItem = () => {
        const name = newQuickItem.trim()
        if (!name) return
        if (quickServeItems.some(i => i.toLowerCase() === name.toLowerCase())) { setNewQuickItem(''); return }
        saveQuickItems([...quickServeItems, name])
        setNewQuickItem('')
    }

    return (
        <>
        <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            {/* General Information */}
            <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden">
                <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                        <Building size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">General Information</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Your restaurant's brand and physical details</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Store size={14} className="text-brand-500" />
                                Restaurant Name *
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <MapPin size={14} className="text-brand-500" />
                                Physical Address
                            </label>
                            <input
                                type="text"
                                name="address"
                                value={formData.address || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Phone size={14} className="text-brand-500" />
                                Contact Phone
                            </label>
                            <input
                                type="tel"
                                name="contact_phone"
                                value={formData.contact_phone || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50 tabular-nums"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                <Mail size={14} className="text-brand-500" />
                                Contact Email
                            </label>
                            <input
                                type="email"
                                name="contact_email"
                                value={formData.contact_email || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Shield size={14} className="text-brand-500" />
                            Allowed WiFi IP Addresses
                        </label>
                        <input
                            type="text"
                            name="allowed_ips"
                            value={formData.allowed_ips || ''}
                            onChange={handleChange}
                            disabled={!canEdit || isSubmitting}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50 tabular-nums"
                            placeholder="e.g., 103.10.22.45, 103.10.22.46 (comma-separated)"
                        />
                        <p className="mt-2 text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                            Provide a comma-separated list of allowed public IP addresses. Waiters and customers must be connected to this network to access their panels. Leave blank to disable network restriction. Managers can access from anywhere.
                        </p>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Restaurant Logo</label>
                        <div className="flex items-start gap-4">
                            {/* Current logo preview or placeholder */}
                            <div className="w-20 h-20 rounded-[var(--r-md)] border border-hairline bg-surface-muted/50 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                {formData.logo_url
                                    ? <Image src={formData.logo_url} alt="Logo" width={80} height={80} className="w-full h-full object-contain p-1" />
                                    : <Store size={28} className="text-ink-subtle" />
                                }
                            </div>
                            <div className="flex-1 space-y-2">
                                {/* Upload button */}
                                {canEdit && (
                                    <label className={`flex items-center gap-2 px-4 py-2.5 border border-dashed rounded-[var(--r-md)] cursor-pointer transition-all focus-ring ${uploadingField === 'logo_url' ? 'border-brand-500/40 bg-brand-50' : 'border-hairline bg-surface hover:border-brand-500 hover:bg-surface-muted'}`}>
                                        {uploadingField === 'logo_url'
                                            ? <Loader2 size={16} className="animate-spin text-brand-500" />
                                            : <Upload size={16} className="text-ink-subtle" />
                                        }
                                        <span className="text-sm font-bold text-ink">
                                            {uploadingField === 'logo_url' ? 'Uploading…' : 'Upload Logo'}
                                        </span>
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="sr-only"
                                            onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0], 'logo_url') }}
                                        />
                                    </label>
                                )}
                                {/* URL fallback */}
                                <input
                                    type="url"
                                    name="logo_url"
                                    value={formData.logo_url || ''}
                                    onChange={handleChange}
                                    disabled={!canEdit || isSubmitting}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                                    placeholder="or paste image URL…"
                                />
                                {formData.logo_url && canEdit && (
                                    <button type="button" onClick={() => setFormData(p => ({ ...p, logo_url: null }))} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-danger-fg hover:text-danger-fg/80 transition-colors mt-2 focus-ring px-1">
                                        <X size={14} /> Remove logo
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Financial Details */}
            <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden">
                <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/20 shadow-[inset_0_2px_4px_rgba(16,185,129,0.05)]">
                        <Percent size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">Financial Rules</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Taxes, service charges, and currency settings</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Tax Rate (%) *</label>
                            <div className="relative bg-surface border border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus-within:ring-4 focus-within:ring-brand-500/10 focus-within:border-brand-500 transition-all overflow-hidden">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    name="tax_rate"
                                    value={taxRateStr}
                                    onChange={e => {
                                        const value = e.target.value
                                        if (/^(\d+(\.\d*)?)?$/.test(value)) {
                                            setTaxRateStr(value)
                                        }
                                    }}
                                    disabled={!canEdit || isSubmitting}
                                    className="w-full py-2.5 pl-4 pr-10 border-none bg-transparent text-sm font-bold text-ink focus:ring-0 tabular-nums disabled:opacity-50"
                                    placeholder="e.g. 13"
                                    required
                                />
                                <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none pr-4">
                                    <span className="text-ink-subtle text-sm font-bold">%</span>
                                </div>
                            </div>
                            <p className="mt-2 text-[11px] font-bold text-ink-muted uppercase tracking-wider">Applied automatically to all menu item purchases.</p>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Currency Code *</label>
                            <input
                                type="text"
                                name="currency"
                                value={features.currency || ''}
                                onChange={e => {
                                    const value = e.target.value
                                    setFeatures(prev => ({ ...prev, currency: value }))
                                }}
                                disabled={!canEdit || isSubmitting}
                                maxLength={3}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink uppercase focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                                placeholder="USD"
                                required
                            />
                            <p className="mt-2 text-[11px] font-bold text-ink-muted uppercase tracking-wider">Standard 3-letter currency code (e.g., NPR, USD, EUR).</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Currency Symbol</label>
                            <input
                                type="text"
                                name="currency_symbol"
                                value={features.currencySymbol || ''}
                                onChange={e => {
                                    const value = e.target.value
                                    setFeatures(prev => ({ ...prev, currencySymbol: value }))
                                }}
                                disabled={!canEdit || isSubmitting}
                                maxLength={5}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                                placeholder="Rs."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Business Hours */}
            <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6">
                <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                        <Clock size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">Business Hours</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Opening times shown to customers, by day of week</p>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    {WEEKDAYS.map(({ key, label }) => {
                        const day = businessHours[key]
                        return (
                            <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 rounded-[var(--r-md)] border border-hairline bg-surface-muted/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                <span className="w-28 text-sm font-extrabold text-ink shrink-0">{label}</span>
                                {day.closed ? (
                                    <span className="text-sm font-bold text-ink-subtle flex-1">Closed</span>
                                ) : (
                                    <div className="flex items-center gap-3 flex-1">
                                        <input
                                            type="time"
                                            value={day.open}
                                            onChange={e => updateDayHours(key, { open: e.target.value })}
                                            disabled={!canEdit || isSubmitting}
                                            className="bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all p-2 disabled:opacity-50"
                                        />
                                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">to</span>
                                        <input
                                            type="time"
                                            value={day.close}
                                            onChange={e => updateDayHours(key, { close: e.target.value })}
                                            disabled={!canEdit || isSubmitting}
                                            className="bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all p-2 disabled:opacity-50"
                                        />
                                    </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer shrink-0 sm:ml-auto select-none">
                                    <input
                                        type="checkbox"
                                        checked={day.closed}
                                        onChange={e => updateDayHours(key, { closed: e.target.checked })}
                                        disabled={!canEdit || isSubmitting}
                                        className="h-5 w-5 rounded-[4px] border-hairline text-brand-500 focus:ring-brand-500/20 bg-surface shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-colors disabled:opacity-50"
                                    />
                                    <span className="text-[11px] font-bold text-ink uppercase tracking-wider">Closed</span>
                                </label>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Nepal / IRD Compliance */}
            <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6">
                <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">Tax & Compliance (Nepal)</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">PAN/VAT registration and IRD invoice settings</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">PAN Number</label>
                            <input
                                type="text"
                                name="pan_number"
                                value={formData.pan_number || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                maxLength={9}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50 tabular-nums"
                                placeholder="123456789"
                            />
                            <p className="mt-2 text-[11px] font-bold text-ink-muted uppercase tracking-wider">9-digit IRD PAN number for invoicing</p>
                        </div>
                        <div className="flex items-center gap-4 pt-6">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    name="vat_registered"
                                    checked={formData.vat_registered || false}
                                    onChange={handleCheckboxChange}
                                    disabled={!canEdit || isSubmitting}
                                    className="h-5 w-5 rounded-[4px] border-hairline text-brand-500 focus:ring-brand-500/20 bg-surface shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-colors disabled:opacity-50"
                                />
                                <div>
                                    <span className="text-sm font-bold text-ink block">VAT Registered</span>
                                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Enable 13% VAT on invoices</p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* QR Payment Setup */}
            <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6">
                <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                        <QrCode size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">QR Payment</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Upload your eSewa/Khalti/Fonepay QR for customers</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">QR Code Image</label>
                            <div className="space-y-3">
                                {canEdit && (
                                    <label className={`flex items-center gap-2 px-4 py-2.5 border border-dashed rounded-[var(--r-md)] cursor-pointer transition-all focus-ring ${uploadingField === 'payment_qr_url' ? 'border-brand-500/40 bg-brand-50' : 'border-hairline bg-surface hover:border-brand-500 hover:bg-surface-muted'}`}>
                                        {uploadingField === 'payment_qr_url'
                                            ? <Loader2 size={16} className="animate-spin text-brand-500" />
                                            : <Upload size={16} className="text-ink-subtle" />
                                        }
                                        <span className="text-sm font-bold text-ink">
                                            {uploadingField === 'payment_qr_url' ? 'Uploading…' : 'Upload QR Image'}
                                        </span>
                                        <input
                                            ref={qrInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="sr-only"
                                            onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0], 'payment_qr_url') }}
                                        />
                                    </label>
                                )}
                                <input
                                    type="url"
                                    name="payment_qr_url"
                                    value={formData.payment_qr_url || ''}
                                    onChange={handleChange}
                                    disabled={!canEdit || isSubmitting}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                                    placeholder="or paste QR image URL…"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">QR Provider</label>
                            <select
                                name="payment_qr_label"
                                value={formData.payment_qr_label || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-2.5 disabled:opacity-50"
                            >
                                <option value="">Select provider…</option>
                                <option value="esewa">eSewa</option>
                                <option value="khalti">Khalti</option>
                                <option value="fonepay">Fonepay</option>
                                <option value="nepal_pay">Nepal Pay</option>
                                <option value="other">Other</option>
                            </select>

                            {formData.payment_qr_url && (
                                <div className="mt-4 flex items-start gap-4 p-4 rounded-[var(--r-md)] border border-hairline bg-surface-muted/30 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                    <Image src={formData.payment_qr_url} alt="Payment QR" width={96} height={96} className="h-24 w-24 object-contain bg-surface rounded-[var(--r-md)] p-2 border border-hairline shrink-0 shadow-sm" />
                                    {canEdit && (
                                        <button type="button" onClick={() => setFormData(p => ({ ...p, payment_qr_url: null }))} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-danger-fg hover:text-danger-fg/80 transition-colors mt-1 focus-ring px-1">
                                            <X size={14} /> Remove QR
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-4 bg-surface rounded-[var(--r-md)] p-4 border border-hairline mt-6 shadow-[0_4px_12px_rgba(0,0,0,0.02)]">
                {!canEdit && (
                    <div className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-[var(--r-md)] border border-amber-200 px-4 py-3 mr-auto flex-1 text-left uppercase tracking-wider flex items-center gap-2">
                        <Shield size={14} /> You do not have permission to modify system settings.
                    </div>
                )}

                {isSuccess && (
                    <span className="text-[11px] font-bold text-success-fg uppercase tracking-wider flex items-center gap-1.5 animate-in fade-in duration-300 bg-success-bg/20 px-3 py-1.5 rounded-full border border-success-bg">
                        <Check size={14} /> Saved successfully
                    </span>
                )}

                <button
                    type="submit"
                    disabled={!canEdit || isSubmitting}
                    className="flex items-center gap-2 bg-brand-500 text-white px-6 py-3 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 focus-ring"
                >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Save Changes
                </button>
            </div>
        </form>

        {/* Feature Toggles — separate from the form since they save instantly */}
        <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-8 max-w-4xl">
            <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                    {isSavingFeatures ? <Loader2 size={20} className="animate-spin" /> : <ToggleRight size={20} />}
                </div>
                <div>
                    <h3 className="text-h3 font-extrabold text-ink">Feature Flags</h3>
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Enable or disable features for your restaurant — changes apply instantly</p>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {([
                        { key: 'serviceRequestsEnabled' as const, label: 'Service Requests', desc: 'Customers can call waiter, request bill, etc.' },
                        { key: 'waiterSessionEnabled' as const, label: 'Waiter-Managed Sessions', desc: 'Require a waiter to open a table before guests can order. Off = guests scan & order instantly' },
                        { key: 'waiterOrderConfirmation' as const, label: 'Waiter Order Confirmation', desc: 'Orders wait for a waiter to confirm before the kitchen sees them. Off = orders go straight to the kitchen' },
                        { key: 'selfOrderRequestEnabled' as const, label: 'Ring for Service', desc: 'When waiter-managed sessions are on, let customers ring to request the table be opened' },
                        { key: 'splitBillingEnabled' as const, label: 'Split Billing', desc: 'Allow customers to split bills at checkout' },
                        { key: 'promosEnabled' as const, label: 'Promo Codes', desc: 'Allow promo/discount codes at checkout' },
                        { key: 'loyaltyEnabled' as const, label: 'Loyalty Program', desc: 'Points-based loyalty rewards for repeat customers' },
                        { key: 'takeoutEnabled' as const, label: 'Takeout Orders', desc: 'Accept orders for pickup' },
                        { key: 'dynamicPricingEnabled' as const, label: 'Dynamic Pricing', desc: 'Time-based price adjustments' },
                        { key: 'ingredientTrackingEnabled' as const, label: 'Ingredient Tracking', desc: 'Track stock levels for menu items' },
                        { key: 'staffShiftsEnabled' as const, label: 'Staff Shifts', desc: 'Clock in/out for staff members' },
                        { key: 'nepalPayEnabled' as const, label: 'Nepal QR Pay', desc: 'eSewa/Khalti/Fonepay QR payment' },
                        { key: 'vatEnabled' as const, label: 'VAT on Invoices', desc: 'Show 13% VAT on printed invoices' },
                        { key: 'phoneOtpEnabled' as const, label: 'Phone OTP Login', desc: 'Allow phone number login via SMS OTP' },
                        { key: 'multiLanguageEnabled' as const, label: 'Multi-Language', desc: 'Menu in multiple languages' },
                        { key: 'bsDateEnabled' as const, label: 'Bikram Sambat Date', desc: 'Show BS calendar dates' },
                    ]).map(({ key, label, desc }) => (
                        <button
                            key={key}
                            onClick={() => toggleFeature(key)}
                            disabled={!canEdit || isSavingFeatures}
                            className={`flex items-center justify-between p-4 rounded-[var(--r-md)] border transition-all text-left group focus-ring ${
                                features[key]
                                    ? 'bg-brand-50/50 border-brand-500/30 shadow-[inset_0_2px_4px_rgba(251,99,3,0.02)]'
                                    : 'bg-surface border-hairline hover:bg-surface-muted/50 hover:border-ink-subtle/30 shadow-[0_2px_4px_rgba(0,0,0,0.02)]'
                            } disabled:opacity-50`}
                        >
                            <div className="pr-4">
                                <span className={`text-sm font-extrabold ${features[key] ? 'text-brand-700' : 'text-ink'}`}>{label}</span>
                                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1">{desc}</p>
                            </div>
                            {features[key] ? (
                                <ToggleRight size={28} className="text-brand-500 shrink-0 drop-shadow-sm" />
                            ) : (
                                <ToggleLeft size={28} className="text-ink-muted shrink-0 group-hover:text-ink-subtle transition-colors" />
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* Quick-Serve Items — manager-configurable one-tap customer requests */}
        <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6 max-w-4xl">
            <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-500/20 shadow-[inset_0_2px_4px_rgba(99,102,241,0.05)]">
                    <Bell size={20} />
                </div>
                <div>
                    <h3 className="text-h3 font-extrabold text-ink">Quick-Serve Items</h3>
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">One-tap items customers can request (water, cold drinks, tissue…). Each goes to the waiter feed.</p>
                </div>
            </div>
            <div className="p-6">
                <div className="flex flex-wrap gap-2 mb-4">
                    {quickServeItems.length === 0 && (
                        <span className="text-sm font-bold text-ink-subtle italic">No quick items yet — add one below.</span>
                    )}
                    {quickServeItems.map((item) => (
                        <span key={item} className="inline-flex items-center gap-2 bg-indigo-50/50 text-indigo-700 border border-indigo-200/50 rounded-full pl-3 pr-1 py-1 text-[11px] font-bold uppercase tracking-wider shadow-[inset_0_2px_4px_rgba(99,102,241,0.02)]">
                            {item}
                            <button
                                type="button"
                                disabled={!canEdit || isSavingFeatures}
                                onClick={() => saveQuickItems(quickServeItems.filter(i => i !== item))}
                                className="w-6 h-6 rounded-full hover:bg-indigo-100 flex items-center justify-center disabled:opacity-40 transition-colors"
                                aria-label={`Remove ${item}`}
                            >
                                <X size={14} />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-3 max-w-sm">
                    <input
                        type="text"
                        value={newQuickItem}
                        onChange={(e) => setNewQuickItem(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQuickItem() } }}
                        disabled={!canEdit}
                        placeholder="e.g. Cold Drink"
                        className="flex-1 bg-surface border border-hairline rounded-[var(--r-md)] px-4 py-2.5 text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                    />
                    <button
                        type="button"
                        onClick={addQuickItem}
                        disabled={!canEdit || isSavingFeatures || !newQuickItem.trim()}
                        className="px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 rounded-[var(--r-md)] hover:opacity-90 active:scale-95 transition-all disabled:opacity-40 focus-ring shadow-[0_4px_12px_rgba(79,70,229,0.25)] hover:shadow-[0_6px_16px_rgba(79,70,229,0.4)] hover:-translate-y-0.5 active:translate-y-0"
                    >
                        Add
                    </button>
                </div>
            </div>
        </div>

        {/* Notification Sound */}
        <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6 max-w-4xl">
            <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0 border border-amber-500/20 shadow-[inset_0_2px_4px_rgba(245,158,11,0.05)]">
                    <Bell size={20} />
                </div>
                <div>
                    <h3 className="text-h3 font-extrabold text-ink">Notification Sound</h3>
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">Custom sound played on kitchen and waiter screens when a new order arrives</p>
                </div>
            </div>
            <div className="p-6 flex flex-col sm:flex-row items-center gap-4">
                <label className={`flex items-center gap-2 px-5 py-3 border border-dashed rounded-[var(--r-md)] cursor-pointer transition-all focus-ring shrink-0 ${uploadingField === 'notification_sound' ? 'border-amber-400/50 bg-amber-50' : 'border-hairline hover:border-amber-400 hover:bg-surface-muted'} ${!canEdit ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploadingField === 'notification_sound'
                        ? <Loader2 size={16} className="animate-spin text-amber-600" />
                        : <Upload size={16} className="text-amber-600" />}
                    <span className="text-sm font-bold text-ink">
                        {uploadingField === 'notification_sound' ? 'Uploading…' : features.notificationSoundUrl ? 'Replace sound' : 'Upload MP3/WAV'}
                    </span>
                    <input
                        ref={soundInputRef}
                        type="file"
                        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg"
                        className="sr-only"
                        disabled={!canEdit || uploadingField === 'notification_sound'}
                        onChange={(e) => { if (e.target.files?.[0]) handleSoundUpload(e.target.files[0]) }}
                    />
                </label>

                {features.notificationSoundUrl && (
                    <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                        <button
                            type="button"
                            onClick={handleTestSound}
                            disabled={testingSound}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-success-fg uppercase tracking-wider bg-success-bg/20 border border-success-bg px-4 py-2.5 rounded-[var(--r-md)] hover:bg-success-bg/30 transition-colors disabled:opacity-50 focus-ring shrink-0"
                        >
                            {testingSound ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test sound
                        </button>
                        <button
                            type="button"
                            onClick={handleRemoveSound}
                            disabled={!canEdit}
                            className="flex items-center gap-1 text-[11px] font-bold text-danger-fg uppercase tracking-wider hover:text-danger-fg/80 disabled:opacity-50 transition-colors focus-ring px-2 py-2 shrink-0"
                        >
                            <X size={14} /> Remove
                        </button>
                        <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider truncate" title={features.notificationSoundUrl.split('/').pop()}>{features.notificationSoundUrl.split('/').pop()}</span>
                    </div>
                )}

                {!features.notificationSoundUrl && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={handleTestSound}
                            disabled={testingSound}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-success-fg uppercase tracking-wider bg-success-bg/20 border border-success-bg px-4 py-2.5 rounded-[var(--r-md)] hover:bg-success-bg/30 transition-colors disabled:opacity-50 focus-ring shrink-0"
                        >
                            {testingSound ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Test default tone
                        </button>
                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">No custom sound — default pip-pip tone will play</span>
                    </div>
                )}
            </div>
        </div>
        </>
    )
}
