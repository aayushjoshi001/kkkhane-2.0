'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { CheckCircle, XCircle, Clock, Banknote, ScanLine, Loader2, ExternalLink, Search } from 'lucide-react'
import { verifyPayment, verifyPaymentAndCloseTable } from '@/components/waiter/payment-verification-actions'
import { toast } from 'react-hot-toast'
import { useCurrency } from '@/lib/contexts/FeatureContext'

interface PaymentClaim {
    id: string
    order_id: string | null
    restaurant_id: string
    amount: number
    payment_method: string
    reference_code: string | null
    screenshot_url: string | null
    staff_verified: boolean
    staff_rejected: boolean
    staff_verified_by: string | null
    staff_verified_at: string | null
    created_at: string
}

function claimStatus(c: PaymentClaim): 'pending' | 'verified' | 'rejected' {
    if (c.staff_verified) return 'verified'
    if (c.staff_rejected) return 'rejected'
    return 'pending'
}

function methodLabel(method: string) {
    switch (method) {
        case 'cash': return { label: 'Cash', icon: <Banknote size={14} className="text-amber-600" />, bg: 'bg-amber-50 text-amber-700' }
        case 'qr_scan': return { label: 'QR Scan', icon: <ScanLine size={14} className="text-blue-600" />, bg: 'bg-blue-50 text-blue-700' }
        case 'esewa': return { label: 'eSewa', icon: <ScanLine size={14} className="text-green-600" />, bg: 'bg-green-50 text-green-700' }
        case 'khalti': return { label: 'Khalti', icon: <ScanLine size={14} className="text-purple-600" />, bg: 'bg-purple-50 text-purple-700' }
        case 'fonepay': return { label: 'FonePay', icon: <ScanLine size={14} className="text-red-600" />, bg: 'bg-red-50 text-red-700' }
        default: return { label: method, icon: null, bg: 'bg-surface-muted text-ink-muted' }
    }
}

export default function PaymentVerificationPanel({
    initialClaims,
    restaurantId,
    userId,
}: {
    initialClaims: PaymentClaim[]
    restaurantId: string
    userId: string
}) {
    const [claims, setClaims] = useState<PaymentClaim[]>(initialClaims)
    const money = useCurrency()
    const [loading, setLoading] = useState<string | null>(null)
    const [filter, setFilter] = useState<'pending' | 'verified' | 'rejected' | 'all'>('pending')
    const [searchQuery, setSearchQuery] = useState('')

    useRestaurantTable(restaurantId, 'payment_verifications', (payload) => {
        if (payload.eventType === 'INSERT') {
            setClaims((prev) => [payload.new as PaymentClaim, ...prev])
            toast('New payment claim received', { icon: '💳' })
        } else if (payload.eventType === 'UPDATE') {
            setClaims((prev) =>
                prev.map((c) => (c.id === (payload.new as PaymentClaim).id ? (payload.new as PaymentClaim) : c))
            )
        }
    })

    const handleVerify = async (claimId: string, action: 'verified' | 'rejected') => {
        setLoading(claimId)
        const res = await verifyPayment(claimId, action)
        if (res.error) {
            toast.error(res.error)
        } else {
            setClaims((prev) =>
                prev.map((c) =>
                    c.id === claimId
                        ? { ...c, staff_verified: action === 'verified', staff_rejected: action === 'rejected', staff_verified_by: userId }
                        : c
                )
            )
            toast.success(action === 'verified' ? 'Payment approved' : 'Payment rejected')
        }
        setLoading(null)
    }

    const handleVerifyAndClose = async (claimId: string) => {
        setLoading(claimId)
        const res = await verifyPaymentAndCloseTable(claimId)
        if (res.error) {
            toast.error(res.error)
        } else {
            setClaims((prev) =>
                prev.map((c) =>
                    c.id === claimId
                        ? { ...c, staff_verified: true, staff_rejected: false, staff_verified_by: userId }
                        : c
                )
            )
            toast.success(res.tableClosed ? 'Payment verified & table closed ✅' : 'Payment verified. Other orders still unpaid.')
        }
        setLoading(null)
    }

    const filtered = claims.filter((c) => {
        const matchesStatus = filter === 'all' ? true : claimStatus(c) === filter
        const matchesSearch = c.reference_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                              c.amount.toString().includes(searchQuery.toLowerCase())
        return matchesStatus && matchesSearch
    })
    const pendingCount = claims.filter((c) => claimStatus(c) === 'pending').length

    return (
        <div className="space-y-6">
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
                {(['pending', 'verified', 'rejected', 'all'] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-2 rounded-full text-sm font-bold tracking-wide capitalize transition-all focus-ring ${
                            filter === f
                                ? 'bg-ink text-surface shadow-md'
                                : 'bg-surface text-ink-subtle border border-hairline hover:bg-surface-muted hover:text-ink'
                        }`}
                    >
                        {f} {f === 'pending' && pendingCount > 0 && (
                            <span className="ml-1.5 bg-danger-fg text-white text-[10px] rounded-full px-2 py-0.5 shadow-sm">{pendingCount}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* Search Bar */}
            <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input
                    type="text"
                    placeholder="Search by amount or reference..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-card border border-hairline text-sm bg-surface outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                />
            </div>

            {filtered.length === 0 && (
                <div className="bg-surface rounded-card border border-hairline p-10 text-center shadow-sm">
                    <Clock size={36} className="mx-auto text-ink-subtle/40 mb-3" />
                    <p className="text-ink-subtle font-bold">No {filter === 'all' ? '' : filter} payment claims</p>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((claim) => {
                const status = claimStatus(claim)
                const method = methodLabel(claim.payment_method)
                const isLoading = loading === claim.id

                return (
                    <div key={claim.id} className={`bg-surface rounded-card border shadow-sm p-5 space-y-4 transition-all ${
                        status === 'pending' ? 'border-amber-200 shadow-[0_4px_12px_rgba(0,0,0,0.05)]' : 'border-hairline opacity-70 hover:opacity-100'
                    }`}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-col gap-1.5">
                                <span className={`inline-flex items-center w-max gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border border-transparent ${method.bg} shadow-sm`}>
                                    {method.icon} {method.label}
                                </span>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-h3 font-extrabold text-ink tabular-nums">{money(claim.amount)}</span>
                                </div>
                                {claim.reference_code && (
                                    <span className="text-[11px] font-medium text-ink-subtle font-mono mt-0.5">Ref: {claim.reference_code}</span>
                                )}
                            </div>
                            <div className="shrink-0">
                                {status === 'pending' && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold uppercase tracking-wide">
                                        <Clock size={11} /> Pending
                                    </span>
                                )}
                                {status === 'verified' && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success-bg/30 text-success-fg border border-success-bg text-[10px] font-bold uppercase tracking-wide">
                                        <CheckCircle size={11} /> Verified
                                    </span>
                                )}
                                {status === 'rejected' && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-danger-bg/30 text-danger-fg border border-danger-bg text-[10px] font-bold uppercase tracking-wide">
                                        <XCircle size={11} /> Rejected
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Screenshot thumbnail — routed through auth-gated proxy */}
                        {claim.screenshot_url && (
                            <div className="flex items-center gap-3 bg-surface-muted/30 p-2.5 rounded-[var(--r-md)] border border-hairline">
                                <Image
                                    src={`/api/payment-proof?claim=${claim.id}`}
                                    alt="Payment proof"
                                    width={64}
                                    height={64}
                                    unoptimized
                                    className="w-16 h-16 rounded-lg object-cover border border-hairline shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity"
                                    onClick={() => window.open(`/api/payment-proof?claim=${claim.id}`, '_blank')}
                                />
                                <a
                                    href={`/api/payment-proof?claim=${claim.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-bold text-brand-600 flex items-center gap-1 hover:text-brand-700 transition-colors"
                                >
                                    View full image <ExternalLink size={12} />
                                </a>
                            </div>
                        )}

                        <div className="text-[11px] text-ink-subtle font-medium border-t border-hairline pt-3 mt-1 flex justify-between">
                            {claim.order_id ? <span className="font-mono">Order: #{claim.order_id.substring(0, 8).toUpperCase()}</span> : <span></span>}
                            <span className="tabular-nums">{new Date(claim.created_at).toLocaleTimeString('en-NP', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {status === 'pending' && (
                            <div className="flex flex-col gap-2 pt-1">
                                {claim.order_id && (
                                    <button
                                        onClick={() => handleVerifyAndClose(claim.id)}
                                        disabled={isLoading}
                                        className="w-full bg-brand-500 text-white text-sm font-bold rounded-[var(--r-md)] py-3 flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none focus-ring"
                                    >
                                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                        Approve & Close Table
                                    </button>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleVerify(claim.id, 'verified')}
                                        disabled={isLoading}
                                        className={`${claim.order_id ? 'flex-1' : 'w-full'} bg-surface border-2 border-brand-500 text-brand-600 text-sm font-bold rounded-[var(--r-md)] px-3 py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand-50 transition-colors focus-ring`}
                                    >
                                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                        {claim.order_id ? 'Approve Only' : 'Approve'}
                                    </button>
                                    <button
                                        onClick={() => handleVerify(claim.id, 'rejected')}
                                        disabled={isLoading}
                                        className="flex-1 bg-surface border border-danger-bg text-danger-fg text-sm font-bold rounded-[var(--r-md)] px-3 py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-danger-bg/20 transition-colors focus-ring"
                                    >
                                        <XCircle size={15} />
                                        Reject
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
            </div>
        </div>
    )
}
