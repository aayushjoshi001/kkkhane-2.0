'use client'

import { useState } from 'react'
import { validatePromoCode } from '@/app/api/loyalty/actions'
import type { PromoCode } from '@/types/database'
import { toast } from 'react-hot-toast'

interface PromoCodeInputProps {
    restaurantId: string
    subtotal: number
    onApply: (promo: PromoCode, discount: number) => void
    onRemove: () => void
    appliedPromo?: PromoCode | null
}

export default function PromoCodeInput({
    restaurantId,
    subtotal,
    onApply,
    onRemove,
    appliedPromo,
}: PromoCodeInputProps) {
    const [code, setCode] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleApply() {
        if (!code.trim()) return
        setLoading(true)

        const result = await validatePromoCode(code, restaurantId, subtotal)
        setLoading(false)

        if (!result.valid || !result.promo) {
            toast.error(result.error || 'Invalid code.')
            return
        }

        onApply(result.promo, result.discountPreview || 0)
        setCode('')
    }

    if (appliedPromo) {
        return (
            <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                <div className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                        <p className="text-sm font-medium text-green-800">
                            {appliedPromo.code}
                        </p>
                        <p className="text-xs text-green-600">
                            {appliedPromo.promo_type === 'percentage_off'
                                ? `${appliedPromo.value}% off`
                                : appliedPromo.promo_type === 'amount_off'
                                ? `Rs. ${appliedPromo.value.toFixed(2)} off`
                                : appliedPromo.promo_type === 'bogo'
                                ? 'Buy One Get One'
                                : 'Free item included'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onRemove}
                    className="text-sm text-red-600 hover:text-red-800"
                >
                    Remove
                </button>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <label className="text-sm font-medium text-ink-muted">Promo Code</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value.toUpperCase())
                    }}
                    placeholder="Enter code"
                    className="flex-1 rounded-lg border border-hairline-strong px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    disabled={loading}
                />
                <button
                    onClick={handleApply}
                    disabled={loading || !code.trim()}
                    className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                    {loading ? '...' : 'Apply'}
                </button>
            </div>
        </div>
    )
}
