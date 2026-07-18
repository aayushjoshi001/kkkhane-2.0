'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, CheckCircle, Loader2, Banknote, ScanLine, Camera, X } from 'lucide-react'
import { submitPaymentClaim } from '@/app/(public)/t/[tableSlug]/checkout/nepal-payment-actions'
import Image from 'next/image'
import { toast } from 'react-hot-toast'
import { useCurrency, useFeatures } from '@/lib/contexts/FeatureContext'

interface NepalPaymentPanelProps {
    restaurantId: string
    totalAmount: number
    qrUrl?: string | null
    provider?: string | null
    orderId?: string | null
}

type PaymentMode = 'qr' | 'cash'

const PROVIDER_LABELS: Record<string, string> = {
    esewa: 'eSewa',
    khalti: 'Khalti',
    fonepay: 'Fonepay',
    nepal_pay: 'Nepal Pay',
}

const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    esewa:     { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200' },
    khalti:    { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    fonepay:   { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
    nepal_pay: { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
}

export default function NepalPaymentPanel({
    restaurantId,
    totalAmount,
    qrUrl,
    provider,
    orderId,
}: NepalPaymentPanelProps) {
    const features = useFeatures()
    const irdSyncEnabled = features?.irdSyncEnabled ?? false
    const [mode, setMode] = useState<PaymentMode>('qr')

    useEffect(() => {
        if (!irdSyncEnabled) {
            setMode('cash')
        }
    }, [irdSyncEnabled])

    const money = useCurrency()
    const [phone, setPhone] = useState('')
    const [screenshot, setScreenshot] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    // Revoke any live preview blob URL when the panel unmounts.
    const previewUrlRef = useRef<string | null>(null)
    useEffect(() => { previewUrlRef.current = previewUrl }, [previewUrl])
    useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current) }, [])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)

    const providerKey = provider?.toLowerCase() ?? ''
    const providerLabel = PROVIDER_LABELS[providerKey] ?? provider ?? 'QR'
    const providerColor = PROVIDER_COLORS[providerKey] ?? { bg: 'bg-surface-muted', text: 'text-ink-muted', border: 'border-hairline-strong' }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setScreenshot(file)
        setPreviewUrl(URL.createObjectURL(file))
    }

    const removeScreenshot = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl)
        setScreenshot(null)
        setPreviewUrl(null)
    }

    const handleSubmit = async () => {
        if (mode === 'qr') {
            if (!phone || phone.replace(/\D/g, '').length < 10) {
                toast.error('Enter your registered phone number (10 digits)')
                return
            }
            if (!screenshot) {
                toast.error('Please upload your payment screenshot to confirm')
                return
            }
        }

        setIsSubmitting(true)

        const formData = new FormData()
        formData.append('restaurantId', restaurantId)
        formData.append('amount', totalAmount.toString())
        formData.append('paymentMethod', mode === 'qr' ? 'qr_scan' : 'cash')
        if (phone) formData.append('phone', phone)
        if (orderId) formData.append('orderId', orderId)
        if (screenshot) formData.append('screenshot', screenshot)

        const res = await submitPaymentClaim(formData)

        if (res.error) {
            toast.error(res.error)
        } else {
            setSubmitted(true)
        }
        setIsSubmitting(false)
    }

    if (submitted) {
        return (
            <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                    <CheckCircle size={32} className="text-green-600" />
                </div>
                <h3 className="font-semibold text-ink text-lg">
                    {mode === 'cash' ? 'Waiter Notified!' : 'Payment Submitted!'}
                </h3>
                <p className="text-ink-subtle text-sm mt-2 max-w-xs mx-auto">
                    {mode === 'cash'
                        ? 'Your waiter will come to collect payment shortly.'
                        : 'Staff will verify your payment and confirm shortly.'}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Mode selector */}
            {irdSyncEnabled && (
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => { setMode('qr') }}
                        className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-colors ${
                            mode === 'qr'
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                                : 'border-hairline-strong text-ink-subtle hover:border-hairline-strong'
                        }`}
                    >
                        <ScanLine size={16} />
                        {providerLabel} QR
                    </button>
                    <button
                        onClick={() => { setMode('cash') }}
                        className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 text-sm font-medium transition-colors ${
                            mode === 'cash'
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]'
                                : 'border-hairline-strong text-ink-subtle hover:border-hairline-strong'
                        }`}
                    >
                        <Banknote size={16} />
                        Cash
                    </button>
                </div>
            )}

            {mode === 'qr' && (
                <div className="space-y-4">
                    {/* QR Code */}
                    {qrUrl ? (
                        <div className={`rounded-xl p-4 flex flex-col items-center border ${providerColor.bg} ${providerColor.border}`}>
                            <p className={`text-sm font-semibold mb-1 ${providerColor.text}`}>
                                Scan &amp; Pay with {providerLabel}
                            </p>
                            <p className="text-2xl font-bold text-ink mb-3">
                                {money(totalAmount)}
                            </p>
                            <div className="bg-surface p-3 rounded-xl border border-hairline-strong shadow-sm">
                                <Image
                                    src={qrUrl}
                                    alt={`${providerLabel} Payment QR Code`}
                                    width={200}
                                    height={200}
                                    className="w-48 h-48 object-contain"
                                />
                            </div>
                            <p className="text-xs text-ink-subtle mt-2 text-center">
                                Open {providerLabel} app → Scan QR → Enter exact amount → Pay
                            </p>
                        </div>
                    ) : (
                        <div className="bg-surface-muted rounded-xl p-6 flex flex-col items-center text-center border border-hairline-strong">
                            <ScanLine size={40} className="text-gray-300 mb-2" />
                            <p className="text-sm text-ink-subtle">
                                QR code not set up yet. Ask staff for payment details.
                            </p>
                        </div>
                    )}

                    {/* After-payment confirmation */}
                    <div className="space-y-3">
                        <p className="text-sm font-semibold text-ink-muted">After paying, confirm below:</p>

                        {/* Phone */}
                        <div>
                            <label className="block text-xs font-medium text-ink-muted mb-1">
                                Registered phone number <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="98XXXXXXXX"
                                className="w-full border border-hairline-strong rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                            />
                        </div>

                        {/* Screenshot — required for QR */}
                        <div>
                            <label className="block text-xs font-medium text-ink-muted mb-1">
                                Payment screenshot <span className="text-red-500">*</span>
                            </label>
                            {previewUrl ? (
                                <div className="relative inline-block">
                                    <Image
                                        src={previewUrl}
                                        alt="Payment screenshot"
                                        width={150}
                                        height={112}
                                        className="h-28 w-auto rounded-lg object-cover border border-hairline-strong"
                                    />
                                    <button
                                        type="button"
                                        onClick={removeScreenshot}
                                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <label className="flex items-center gap-2 border border-dashed border-hairline-strong rounded-lg p-3 cursor-pointer hover:bg-surface-muted transition">
                                    <Camera size={18} className="text-ink-subtle" />
                                    <span className="text-sm text-ink-subtle">Tap to upload screenshot</span>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        onChange={handleFileChange}
                                        className="sr-only"
                                    />
                                </label>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {mode === 'cash' && (
                <div className="space-y-4">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                        <Banknote size={36} className="text-amber-500 mx-auto mb-2" />
                        <p className="text-base font-bold text-amber-900">
                            {money(totalAmount)}
                        </p>
                        <p className="text-sm text-amber-700 mt-1">
                            Pay in cash — your waiter will collect at the table.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-ink-muted mb-1">
                            Upload receipt <span className="text-ink-subtle">(optional)</span>
                        </label>
                        {previewUrl ? (
                            <div className="relative inline-block">
                                <Image
                                    src={previewUrl}
                                    alt="Receipt"
                                    width={150}
                                    height={112}
                                    className="h-28 w-auto rounded-lg object-cover border border-hairline-strong"
                                />
                                <button
                                    type="button"
                                    onClick={removeScreenshot}
                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 shadow"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <label className="flex items-center gap-2 border border-dashed border-hairline-strong rounded-lg p-3 cursor-pointer hover:bg-surface-muted transition">
                                <Upload size={18} className="text-ink-subtle" />
                                <span className="text-sm text-ink-subtle">Tap to upload proof</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="sr-only"
                                />
                            </label>
                        )}
                    </div>
                </div>
            )}

            <button
                onClick={handleSubmit}
                disabled={isSubmitting || (mode === 'qr' && (!phone || !screenshot))}
                className="w-full bg-[var(--color-primary)] text-white font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
                {isSubmitting ? (
                    <><Loader2 className="animate-spin" size={18} /> Submitting…</>
                ) : mode === 'cash' ? (
                    <><Banknote size={18} /> Notify Waiter — Pay Cash</>
                ) : (
                    <><CheckCircle size={18} /> Confirm Payment — {money(totalAmount)}</>
                )}
            </button>
        </div>
    )
}
