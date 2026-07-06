'use client'

import { useState } from 'react'
import { CreditCard, ChevronDown, ChevronUp } from 'lucide-react'
import NepalPaymentPanel from './NepalPaymentPanel'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { PaymentStatus } from '@/types/database'

interface OrderPaymentSectionProps {
    orderId: string
    restaurantId: string
    totalAmount: number
    paymentStatus: PaymentStatus
    paymentQrUrl: string | null
    paymentQrLabel: string | null
}

/**
 * "Pay Now" section on the order tracking page.
 * Step 8 of Golden Path: Customer finishes eating, taps "Pay Now".
 *
 * Shows the Nepal QR payment panel (eSewa/Khalti/Fonepay)
 * with the restaurant's payment QR code and amount.
 */
export default function OrderPaymentSection({
    orderId,
    restaurantId,
    totalAmount,
    paymentStatus,
    paymentQrUrl,
    paymentQrLabel,
}: OrderPaymentSectionProps) {
    const [isExpanded, setIsExpanded] = useState(paymentStatus === 'unpaid')
    const money = useCurrency()

    if (paymentStatus === 'paid') {
        return (
            <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-green-700 font-semibold">✅ Payment Received</p>
                <p className="text-green-600 text-sm mt-1">Thank you for your payment!</p>
            </div>
        )
    }

    if (paymentStatus === 'pending') {
        return (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                <p className="text-amber-700 font-semibold">⏳ Payment Being Verified</p>
                <p className="text-amber-600 text-sm mt-1">
                    Your payment claim has been submitted. Staff will verify it shortly.
                </p>
            </div>
        )
    }

    return (
        <div className="mt-6 bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-4 flex items-center justify-between bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100"
            >
                <div className="flex items-center gap-2">
                    <CreditCard size={20} className="text-green-600" />
                    <span className="font-semibold text-ink">Pay Now</span>
                    <span className="text-sm text-green-600 font-medium">
                        {money(totalAmount)}
                    </span>
                </div>
                {isExpanded ? (
                    <ChevronUp size={18} className="text-ink-subtle" />
                ) : (
                    <ChevronDown size={18} className="text-ink-subtle" />
                )}
            </button>

            {isExpanded && (
                <div className="p-4">
                    <NepalPaymentPanel
                        restaurantId={restaurantId}
                        totalAmount={totalAmount}
                        qrUrl={paymentQrUrl}
                        provider={paymentQrLabel}
                        orderId={orderId}
                    />
                </div>
            )}
        </div>
    )
}
