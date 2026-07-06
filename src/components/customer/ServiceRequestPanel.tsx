'use client'

import { useState } from 'react'
import { Bell, Droplets, Receipt, Sparkles, UtensilsCrossed, X, Loader2, Check, GlassWater } from 'lucide-react'
import { createServiceRequest } from '@/app/api/service-requests/actions'
import { useCartStore } from '@/lib/stores/cart'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import type { ServiceRequestType } from '@/types/database'
import { toast } from 'react-hot-toast'
import { playVoice } from '@/lib/voice'

type RequestOption = {
    id: string            // unique key (may differ from DB type for presets that use 'other')
    type: ServiceRequestType
    label: string
    icon: typeof Bell
    color: string
    message?: string      // fixed message for presets that use 'other' type
}

// Always-available core requests.
const CORE_OPTIONS: RequestOption[] = [
        { id: 'call_waiter', type: 'call_waiter', label: 'Call Waiter', icon: Bell, color: 'bg-blue-500' },
        { id: 'request_bill', type: 'request_bill', label: 'Request Bill', icon: Receipt, color: 'bg-green-500' },
        { id: 'clean_table', type: 'clean_table', label: 'Clean Table', icon: Sparkles, color: 'bg-amber-500' },
    ]

// Shown when the manager hasn't configured any quick-serve items.
const DEFAULT_QUICK_OPTIONS: RequestOption[] = [
        { id: 'need_water', type: 'need_water', label: 'Need Water', icon: Droplets, color: 'bg-cyan-500' },
        { id: 'need_silverware', type: 'other', label: 'Need Silverware', icon: UtensilsCrossed, color: 'bg-brand-500', message: 'Need Silverware' },
    ]

export default function ServiceRequestPanel({
    sessionId,
    restaurantId,
    quickItems = [],
    isOpen,
    onClose,
}: {
    sessionId: string
    restaurantId: string
    quickItems?: string[]
    isOpen: boolean
    onClose: () => void
}) {
    // Manager-configured quick-serve items (water, cold drinks, tissue…) become
    // one-tap requests. Fall back to sensible defaults if none are configured.
    const quickOptions: RequestOption[] = quickItems.length > 0
        ? quickItems.map((name, i) => ({
            id: `qi-${i}`,
            type: 'other' as ServiceRequestType,
            label: name,
            icon: GlassWater,
            color: 'bg-purple-500',
            message: name,
        }))
        : DEFAULT_QUICK_OPTIONS
    const REQUEST_OPTIONS = [...CORE_OPTIONS, ...quickOptions]
    const [loading, setLoading] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [customMessage, setCustomMessage] = useState('')

    const totalItems = useHydratedStore(useCartStore, (s) => s.totalItems)
    const cartCount = totalItems ? totalItems() : 0
    // Shift FAB above CartSummary (~80px tall) when cart bar is visible
    const fabBottom = cartCount > 0 ? 'bottom-28' : 'bottom-6'

    const handlePreset = async (option: RequestOption) => {
        setLoading(option.id)

        const res = await createServiceRequest(
            sessionId,
            restaurantId,
            option.type,
            option.message || undefined
        )

        setLoading(null)

        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`${option.label} requested!`)
            playVoice('customer_service_notified')
            setSuccess(option.id)
            setTimeout(() => setSuccess(null), 3000)
        }
    }

    const handleCustom = async () => {
        setLoading('custom')

        const res = await createServiceRequest(
            sessionId,
            restaurantId,
            'other',
            customMessage
        )

        setLoading(null)

        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success("Request sent!")
            playVoice('customer_service_notified')
            setSuccess('custom')
            setCustomMessage('')
            setTimeout(() => setSuccess(null), 3000)
        }
    }

    if (!isOpen) return null

    return (
        <div className={`fixed ${fabBottom} right-4 z-60 w-72 bg-surface rounded-2xl shadow-2xl border border-hairline overflow-hidden`}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-hairline bg-surface-muted">
                <h3 className="font-semibold text-ink text-sm">Need Help?</h3>
                <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
                    <X size={18} />
                </button>
            </div>

            {/* Options */}
            <div className="p-3 grid grid-cols-2 gap-2">
                {REQUEST_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                        <button
                            key={option.id}
                            onClick={() => handlePreset(option)}
                            disabled={loading !== null}
                            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-hairline hover:bg-surface-muted active:scale-95 transition-all disabled:opacity-50"
                        >
                            <div className={`${option.color} text-white p-2 rounded-lg`}>
                                {loading === option.id ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : success === option.id ? (
                                    <Check size={18} />
                                ) : (
                                    <Icon size={18} />
                                )}
                            </div>
                            <span className="text-xs font-medium text-ink-muted">{option.label}</span>
                        </button>
                    )
                })}
            </div>

            {/* Custom message for "other" */}
            <div className="px-3 pb-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={customMessage}
                        onChange={(e) => setCustomMessage(e.target.value)}
                        placeholder="Other request..."
                        className="flex-1 text-sm border border-hairline-strong rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <button
                        onClick={handleCustom}
                        disabled={!customMessage.trim() || loading !== null}
                        className="bg-gray-800 text-white text-sm px-3 rounded-lg disabled:opacity-40"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    )
}
