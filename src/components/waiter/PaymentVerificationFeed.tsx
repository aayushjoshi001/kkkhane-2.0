'use client'

import { useEffect, useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { CheckCircle, XCircle, Smartphone, DoorClosed } from 'lucide-react'
import { verifyPayment, verifyPaymentAndCloseTable } from './payment-verification-actions'
import { timeAgo } from '@/lib/utils'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import FeedSection from '@/components/ui/FeedSection'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'

export interface PaymentClaim {
    id: string
    order_id: string | null
    restaurant_id: string
    amount: number
    payment_method: string
    reference_code: string | null
    staff_verified: boolean
    staff_rejected: boolean
    staff_verified_by: string | null
    staff_verified_at: string | null
    rejection_reason: string | null
    created_at: string
}

function claimStatus(c: PaymentClaim): 'pending' | 'verified' | 'rejected' {
    if (c.staff_verified) return 'verified'
    if (c.staff_rejected) return 'rejected'
    return 'pending'
}

export default function PaymentVerificationFeed({
    initialClaims,
    restaurantId,
    userId,
    onPendingCountChange,
}: {
    initialClaims: PaymentClaim[]
    restaurantId: string
    userId: string
    /** Reports the live count of pending claims so a parent can adjust its own empty state. */
    onPendingCountChange?: (count: number) => void
}) {
    const [claims, setClaims] = useState<PaymentClaim[]>(initialClaims)
    const money = useCurrency()
    const [loading, setLoading] = useState<string | null>(null)

    useRestaurantTable(restaurantId, 'payment_verifications', (payload) => {
        if (payload.eventType === 'INSERT') {
            setClaims((prev) => [payload.new as PaymentClaim, ...prev])
        } else if (payload.eventType === 'UPDATE') {
            setClaims((prev) => prev.map((c) => (c.id === (payload.new as PaymentClaim).id ? (payload.new as PaymentClaim) : c)))
        }
    })

    const handleVerify = async (claimId: string, action: 'verified' | 'rejected') => {
        setLoading(claimId)
        const res = await verifyPayment(claimId, action)
        if (!res.error) {
            setClaims((prev) => prev.map((c) => c.id === claimId
                ? { ...c, staff_verified: action === 'verified', staff_rejected: action === 'rejected', staff_verified_by: userId }
                : c
            ))
        }
        setLoading(null)
    }

    const handleVerifyAndClose = async (claimId: string) => {
        setLoading(claimId)
        const res = await verifyPaymentAndCloseTable(claimId)
        if (res.error) {
            toast.error(res.error)
        } else {
            setClaims((prev) => prev.map((c) => c.id === claimId
                ? { ...c, staff_verified: true, staff_rejected: false, staff_verified_by: userId }
                : c
            ))
            toast.success(res.tableClosed ? 'Payment verified & table closed ✅' : 'Payment verified.')
        }
        setLoading(null)
    }

    const pendingClaims = claims.filter((c) => claimStatus(c) === 'pending')
    const resolvedClaims = claims.filter((c) => claimStatus(c) !== 'pending')

    useEffect(() => {
        onPendingCountChange?.(pendingClaims.length)
    }, [pendingClaims.length, onPendingCountChange])

    if (claims.length === 0) return null

    return (
        <FeedSection
            icon={Smartphone}
            title="Payment Verifications"
            count={pendingClaims.length || undefined}
            tone="warning"
        >
            {pendingClaims.map((claim) => (
                <Card key={claim.id} padding={false} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <StatusBadge status="pending" />
                        <span className="text-caption text-ink-subtle">{timeAgo(claim.created_at)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-small">
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-caption text-ink-subtle">Amount</span>
                            <span className="font-bold text-ink tabular">{money(claim.amount)}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-caption text-ink-subtle">Via</span>
                            <span className="font-medium text-ink capitalize">{claim.payment_method}</span>
                        </div>
                        {claim.reference_code && (
                            <div className="flex items-baseline gap-1.5 col-span-2">
                                <span className="text-caption text-ink-subtle">Ref</span>
                                <span className="font-mono text-caption font-medium text-ink">{claim.reference_code}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        {claim.order_id && (
                            <Button
                                block
                                icon={DoorClosed}
                                loading={loading === claim.id}
                                onClick={() => handleVerifyAndClose(claim.id)}
                            >
                                Verify &amp; Close Table
                            </Button>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                variant="success"
                                icon={CheckCircle}
                                loading={loading === claim.id}
                                onClick={() => handleVerify(claim.id, 'verified')}
                            >
                                Approve
                            </Button>
                            <Button
                                variant="secondary"
                                icon={XCircle}
                                disabled={loading === claim.id}
                                onClick={() => handleVerify(claim.id, 'rejected')}
                                className="text-danger-fg border-danger/30 hover:bg-danger-bg"
                            >
                                Reject
                            </Button>
                        </div>
                    </div>
                </Card>
            ))}

            {resolvedClaims.length > 0 && (
                <details className="group">
                    <summary className="py-2 text-caption font-medium text-ink-subtle cursor-pointer hover:text-ink list-none flex items-center justify-between">
                        {resolvedClaims.length} resolved claim{resolvedClaims.length > 1 ? 's' : ''}
                        <span className="group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <div className="pt-2 space-y-2">
                        {resolvedClaims.map((claim) => {
                            const status = claimStatus(claim)
                            return (
                                <div key={claim.id} className="rounded-[var(--r-md)] border border-hairline bg-surface-muted/50 px-3 py-2.5 flex items-center justify-between text-small">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-ink tabular">{money(claim.amount)}</span>
                                        {claim.reference_code && <span className="text-caption text-ink-subtle">· {claim.reference_code}</span>}
                                    </div>
                                    <StatusBadge status={status} dot={false} />
                                </div>
                            )
                        })}
                    </div>
                </details>
            )}
        </FeedSection>
    )
}
