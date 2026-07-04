'use client'

import { useState } from 'react'
import { RotateCcw, Loader2 } from 'lucide-react'
import { refundOrderAction } from './actions'
import { toast } from 'react-hot-toast'
import { useCurrency } from '@/lib/contexts/FeatureContext'

export default function RefundOrderButton({
    orderId,
    paymentStatus,
    totalAmount,
    refundedAmount = 0,
}: {
    orderId: string
    paymentStatus: string
    totalAmount: number
    refundedAmount?: number
}) {
    const [open, setOpen] = useState(false)
    const money = useCurrency()
    const [reason, setReason] = useState('')
    const [loading, setLoading] = useState(false)
    const [amountStr, setAmountStr] = useState('')

    const maxRefundable = totalAmount - refundedAmount
    const isVoid = paymentStatus !== 'paid'
    const label = isVoid ? 'Void' : 'Refund'

    // For voids (unpaid), full amount only. For paid, allow partial.
    const parsedAmount = amountStr ? parseFloat(amountStr) : maxRefundable
    const amountValid = parsedAmount > 0 && parsedAmount <= maxRefundable

    async function handleSubmit() {
        if (!reason.trim()) { toast.error('Please enter a reason.'); return }
        if (!amountValid) { toast.error(`Enter an amount between 1 and ${maxRefundable}.`); return }
        setLoading(true)
        const res = await refundOrderAction(orderId, reason, parsedAmount)
        setLoading(false)
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(res.partial ? `Partial refund of ${money(parsedAmount)} recorded` : `Order ${label.toLowerCase()}ed`)
            setOpen(false)
            setReason('')
            setAmountStr('')
        }
    }

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="text-xs text-danger-fg border border-danger-bg/50 rounded-[var(--r-md)] px-3 py-1.5 hover:bg-danger-bg/20 transition-colors font-bold tracking-wide focus-ring"
            >
                {label}
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-surface rounded-card shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-hairline w-full max-w-sm p-6 space-y-5 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-2">
                            <RotateCcw size={18} className="text-danger-fg" />
                            <h2 className="text-h3 text-ink">{label} Order</h2>
                        </div>

                        {refundedAmount > 0 && (
                            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-[var(--r-md)] px-3 py-2 font-medium">
                                {money(refundedAmount)} already refunded. Remaining: {money(maxRefundable)}
                            </p>
                        )}

                        {paymentStatus === 'paid' && (
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">
                                    Refund amount <span className="text-ink-subtle/70 font-normal">(max {money(maxRefundable)})</span>
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max={maxRefundable}
                                    step="0.01"
                                    value={amountStr}
                                    onChange={(e) => setAmountStr(e.target.value)}
                                    placeholder={`${maxRefundable} (full refund)`}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Reason</label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g. wrong item delivered, customer complaint…"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all resize-none"
                                rows={3}
                                maxLength={200}
                            />
                        </div>

                        <div className="flex gap-3 justify-end pt-2 border-t border-hairline mt-2">
                            <button
                                onClick={() => { setOpen(false); setReason(''); setAmountStr('') }}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring"
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={loading || !reason.trim()}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-danger-fg rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(239,68,68,0.25)] hover:shadow-[0_6px_16px_rgba(239,68,68,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 focus-ring"
                            >
                                {loading && <Loader2 size={16} className="animate-spin" />}
                                Confirm {parsedAmount < maxRefundable && parsedAmount > 0 ? `Partial ${label}` : label}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
