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

    return (
        <>
        <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            {/* General Information */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                        <Building size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800">General Information</h3>
                        <p className="text-sm text-gray-500">Your restaurant&apos;s brand and physical details</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <Store size={14} className="text-gray-400" />
                                Restaurant Name *
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <MapPin size={14} className="text-gray-400" />
                                Physical Address
                            </label>
                            <input
                                type="text"
                                name="address"
                                value={formData.address || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <Phone size={14} className="text-gray-400" />
                                Contact Phone
                            </label>
                            <input
                                type="tel"
                                name="contact_phone"
                                value={formData.contact_phone || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                <Mail size={14} className="text-gray-400" />
                                Contact Email
                            </label>
                            <input
                                type="email"
                                name="contact_email"
                                value={formData.contact_email || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                            <Shield size={14} className="text-gray-400" />
                            Allowed WiFi IP Addresses
                        </label>
                        <input
                            type="text"
                            name="allowed_ips"
                            value={formData.allowed_ips || ''}
                            onChange={handleChange}
                            disabled={!canEdit || isSubmitting}
                            className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                            placeholder="e.g., 103.10.22.45, 103.10.22.46 (comma-separated)"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                            Provide a comma-separated list of allowed public IP addresses. Waiters and customers must be connected to this network to access their panels. Leave blank to disable network restriction. Managers can access from anywhere.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Restaurant Logo</label>
                        <div className="flex items-start gap-4">
                            {/* Current logo preview or placeholder */}
                            <div className="w-20 h-20 rounded-xl border-2 border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                                {formData.logo_url
                                    ? <Image src={formData.logo_url} alt="Logo" width={80} height={80} className="w-full h-full object-contain p-1" />
                                    : <Store size={28} className="text-gray-300" />
                                }
                            </div>
                            <div className="flex-1 space-y-2">
                                {/* Upload button */}
                                {canEdit && (
                                    <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-lg cursor-pointer transition ${uploadingField === 'logo_url' ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5' : 'border-gray-300 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5'}`}>
                                        {uploadingField === 'logo_url'
                                            ? <Loader2 size={15} className="animate-spin text-[var(--color-primary)]" />
                                            : <Upload size={15} className="text-gray-500" />
                                        }
                                        <span className="text-sm font-medium text-gray-600">
                                            {uploadingField === 'logo_url' ? 'Uploading…' : 'Upload Logo'}
                                        </span>
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
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
                                    className="w-full border-gray-300 rounded-lg shadow-sm sm:text-sm p-2 border disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="or paste image URL…"
                                />
                                {formData.logo_url && canEdit && (
                                    <button type="button" onClick={() => setFormData(p => ({ ...p, logo_url: null }))} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
                                        <X size={12} /> Remove logo
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Financial Details */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                        <Percent size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800">Financial Rules</h3>
                        <p className="text-sm text-gray-500">Taxes, service charges, and currency settings</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%) *</label>
                            <div className="relative border-gray-300 focus-within:ring-1 focus-within:ring-[var(--color-primary)] focus-within:border-[var(--color-primary)] rounded-lg shadow-sm border bg-white overflow-hidden">
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
                                    className="w-full py-2.5 pl-3 pr-10 border-0 focus:ring-0 sm:text-sm disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="e.g. 13"
                                    required
                                />
                                <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none pr-3">
                                    <span className="text-gray-500 sm:text-sm">%</span>
                                </div>
                            </div>
                            <p className="mt-1.5 text-xs text-gray-500">Applied automatically to all menu item purchases.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Currency Code *</label>
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
                                className="w-full border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2.5 border uppercase disabled:bg-gray-50 disabled:text-gray-500"
                                placeholder="USD"
                                required
                            />
                            <p className="mt-1.5 text-xs text-gray-500">Standard 3-letter currency code (e.g., NPR, USD, EUR).</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                Currency Symbol
                            </label>
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
                                className="w-full border-gray-300 rounded-lg shadow-sm sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                                placeholder="Rs."
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Business Hours */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <div className="p-2 bg-sky-100 text-sky-600 rounded-lg">
                        <Clock size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800">Business Hours</h3>
                        <p className="text-sm text-gray-500">Opening times shown to customers, by day of week</p>
                    </div>
                </div>

                <div className="p-6 space-y-3">
                    {WEEKDAYS.map(({ key, label }) => {
                        const day = businessHours[key]
                        return (
                            <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                                <span className="w-28 text-sm font-medium text-gray-700 shrink-0">{label}</span>
                                {day.closed ? (
                                    <span className="text-sm text-gray-400 flex-1">Closed</span>
                                ) : (
                                    <div className="flex items-center gap-2 flex-1">
                                        <input
                                            type="time"
                                            value={day.open}
                                            onChange={e => updateDayHours(key, { open: e.target.value })}
                                            disabled={!canEdit || isSubmitting}
                                            className="border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2 border disabled:bg-gray-50 disabled:text-gray-500"
                                        />
                                        <span className="text-gray-400 text-sm">to</span>
                                        <input
                                            type="time"
                                            value={day.close}
                                            onChange={e => updateDayHours(key, { close: e.target.value })}
                                            disabled={!canEdit || isSubmitting}
                                            className="border-gray-300 rounded-lg shadow-sm focus:border-[var(--color-primary)] focus:ring-[var(--color-primary)] sm:text-sm p-2 border disabled:bg-gray-50 disabled:text-gray-500"
                                        />
                                    </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer shrink-0 sm:ml-auto">
                                    <input
                                        type="checkbox"
                                        checked={day.closed}
                                        onChange={e => updateDayHours(key, { closed: e.target.checked })}
                                        disabled={!canEdit || isSubmitting}
                                        className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                    />
                                    <span className="text-sm text-gray-600">Closed</span>
                                </label>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Nepal / IRD Compliance */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800">Tax & Compliance (Nepal)</h3>
                        <p className="text-sm text-gray-500">PAN/VAT registration and IRD invoice settings</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-1">PAN Number</label>
                            <input
                                type="text"
                                name="pan_number"
                                value={formData.pan_number || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                maxLength={9}
                                className="w-full border-gray-300 rounded-lg shadow-sm sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                                placeholder="123456789"
                            />
                            <p className="mt-1.5 text-xs text-gray-500">9-digit IRD PAN number for invoicing</p>
                        </div>
                        <div className="flex items-center gap-4 pt-6">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    name="vat_registered"
                                    checked={formData.vat_registered || false}
                                    onChange={handleCheckboxChange}
                                    disabled={!canEdit || isSubmitting}
                                    className="h-5 w-5 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                />
                                <div>
                                    <span className="text-sm font-medium text-gray-700">VAT Registered</span>
                                    <p className="text-xs text-gray-500">Enable 13% VAT on invoices</p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* QR Payment Setup */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                        <QrCode size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800">QR Payment</h3>
                        <p className="text-sm text-gray-500">Upload your eSewa/Khalti/Fonepay QR for customers</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">QR Code Image</label>
                            <div className="space-y-2">
                                {canEdit && (
                                    <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-lg cursor-pointer transition ${uploadingField === 'payment_qr_url' ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5' : 'border-gray-300 hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5'}`}>
                                        {uploadingField === 'payment_qr_url'
                                            ? <Loader2 size={15} className="animate-spin text-[var(--color-primary)]" />
                                            : <Upload size={15} className="text-gray-500" />
                                        }
                                        <span className="text-sm font-medium text-gray-600">
                                            {uploadingField === 'payment_qr_url' ? 'Uploading…' : 'Upload QR Image'}
                                        </span>
                                        <input
                                            ref={qrInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
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
                                    className="w-full border-gray-300 rounded-lg shadow-sm sm:text-sm p-2 border disabled:bg-gray-50 disabled:text-gray-500"
                                    placeholder="or paste QR image URL…"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700 mb-2 block">QR Provider</label>
                            <select
                                name="payment_qr_label"
                                value={formData.payment_qr_label || ''}
                                onChange={handleChange}
                                disabled={!canEdit || isSubmitting}
                                className="w-full border-gray-300 rounded-lg shadow-sm sm:text-sm p-2.5 border disabled:bg-gray-50 disabled:text-gray-500"
                            >
                                <option value="">Select provider…</option>
                                <option value="esewa">eSewa</option>
                                <option value="khalti">Khalti</option>
                                <option value="fonepay">Fonepay</option>
                                <option value="nepal_pay">Nepal Pay</option>
                                <option value="other">Other</option>
                            </select>

                            {formData.payment_qr_url && (
                                <div className="mt-4 flex items-start gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                                    <Image src={formData.payment_qr_url} alt="Payment QR" width={96} height={96} className="h-24 w-24 object-contain bg-white rounded-lg p-1 border border-gray-200 shrink-0" />
                                    {canEdit && (
                                        <button type="button" onClick={() => setFormData(p => ({ ...p, payment_qr_url: null }))} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 mt-1">
                                            <X size={12} /> Remove QR
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-4 bg-gray-50 rounded-2xl p-4 border border-gray-200">
                {!canEdit && (
                    <span className="text-sm text-amber-600 font-medium px-4 py-2 bg-amber-50 rounded-lg border border-amber-200 mr-auto flex-1 text-left">
                        You do not have permission to modify system settings.
                    </span>
                )}

                {isSuccess && (
                    <span className="text-sm text-green-600 font-medium flex items-center gap-1.5 animate-in fade-in duration-300">
                        <Check size={16} /> Saved successfully
                    </span>
                )}

                <button
                    type="submit"
                    disabled={!canEdit || isSubmitting}
                    className="flex items-center gap-2 bg-[var(--color-primary)] text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    Save Changes
                </button>
            </div>
        </form>

        {/* Feature Toggles — separate from the form since they save instantly */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-6 max-w-4xl">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                <div className="p-2 bg-[var(--color-primary)]/10 text-[var(--color-primary)] rounded-lg">
                    {isSavingFeatures ? <Loader2 size={20} className="animate-spin" /> : <ToggleRight size={20} />}
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Feature Flags</h3>
                    <p className="text-sm text-gray-500">Enable or disable features for your restaurant — changes apply instantly</p>
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
                            className={`flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                                features[key]
                                    ? 'bg-[var(--color-primary)]/8 border-[var(--color-primary)]/20'
                                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <div>
                                <span className="text-sm font-semibold text-gray-800">{label}</span>
                                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                            </div>
                            {features[key] ? (
                                <ToggleRight size={28} className="text-[var(--color-primary)] shrink-0" />
                            ) : (
                                <ToggleLeft size={28} className="text-gray-400 shrink-0" />
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* Notification Sound */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-6 max-w-4xl">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                    <Bell size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Notification Sound</h3>
                    <p className="text-sm text-gray-500">Custom sound played on kitchen and waiter screens when a new order arrives</p>
                </div>
            </div>
            <div className="p-6 flex flex-col sm:flex-row items-start gap-4">
                <label className={`flex items-center gap-2 px-4 py-2.5 border-2 border-dashed rounded-lg cursor-pointer transition ${uploadingField === 'notification_sound' ? 'border-amber-300 bg-amber-50' : 'border-gray-300 hover:border-amber-400 hover:bg-amber-50'} ${!canEdit ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploadingField === 'notification_sound'
                        ? <Loader2 size={16} className="animate-spin text-amber-600" />
                        : <Upload size={16} className="text-amber-600" />}
                    <span className="text-sm font-medium text-gray-700">
                        {uploadingField === 'notification_sound' ? 'Uploading…' : features.notificationSoundUrl ? 'Replace sound' : 'Upload MP3/WAV'}
                    </span>
                    <input
                        ref={soundInputRef}
                        type="file"
                        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg"
                        className="hidden"
                        disabled={!canEdit || uploadingField === 'notification_sound'}
                        onChange={(e) => { if (e.target.files?.[0]) handleSoundUpload(e.target.files[0]) }}
                    />
                </label>

                {features.notificationSoundUrl && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={handleTestSound}
                            disabled={testingSound}
                            className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg hover:bg-green-100 transition disabled:opacity-60"
                        >
                            {testingSound ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Test sound
                        </button>
                        <button
                            type="button"
                            onClick={handleRemoveSound}
                            disabled={!canEdit}
                            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                            <X size={12} /> Remove
                        </button>
                        <span className="text-xs text-gray-400 max-w-xs truncate">{features.notificationSoundUrl.split('/').pop()}</span>
                    </div>
                )}

                {!features.notificationSoundUrl && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <button
                            type="button"
                            onClick={handleTestSound}
                            disabled={testingSound}
                            className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg hover:bg-green-100 transition disabled:opacity-60"
                        >
                            {testingSound ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Test default tone
                        </button>
                        <span className="text-sm text-gray-400">No custom sound — default pip-pip tone will play</span>
                    </div>
                )}
            </div>
        </div>
        </>
    )
}
