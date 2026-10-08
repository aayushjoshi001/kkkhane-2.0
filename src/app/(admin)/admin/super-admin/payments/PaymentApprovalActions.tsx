'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import { CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { approveSubscriptionPaymentAction, rejectSubscriptionPaymentAction } from '../actions'

interface Props {
    paymentId: string
    status: string
}

export default function PaymentApprovalActions({ paymentId, status }: Props) {
    const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
    const [done, setDone] = useState(false)

    if (status === 'approved' || done) {
        return <span className="text-xs font-semibold text-green-600 bg-green-50 px-3 py-1 rounded-full">Approved</span>
    }
    if (status === 'rejected') {
        return <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1 rounded-full">Rejected</span>
    }

    async function handleApprove() {
        setLoading('approve')
        try {
            const res = await approveSubscriptionPaymentAction(paymentId)
            if (res.error) throw new Error(res.error)
            toast.success(`Plan activated — expires ${res.tier ? `(${res.tier})` : ''} ${res.newExpiry ? new Date(res.newExpiry).toLocaleDateString() : ''}`)
            setDone(true)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Approval failed')
        } finally {
            setLoading(null)
        }
    }

    async function handleReject() {
        const reason = window.prompt('Rejection reason (shown to customer):') ?? ''
        if (reason === null) return // cancelled
        setLoading('reject')
        try {
            const res = await rejectSubscriptionPaymentAction(paymentId, reason)
            if (res.error) throw new Error(res.error)
            toast.success('Payment rejected')
            setDone(true)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Rejection failed')
        } finally {
            setLoading(null)
        }
    }

    return (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                variant="primary"
                loading={loading === 'approve'}
                onClick={handleApprove}
                icon={CheckCircle}
                className="bg-green-600 hover:bg-green-700 text-white text-xs"
            >
                Approve
            </Button>
            <Button
                size="sm"
                variant="secondary"
                loading={loading === 'reject'}
                onClick={handleReject}
                icon={XCircle}
                className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
            >
                Reject
            </Button>
        </div>
    )
}
