'use client'

import { X, ShoppingBag, Loader2 } from 'lucide-react'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import Modal from '@/components/ui/Modal'

interface OrderConfirmModalProps {
    itemCount: number
    totalAmount: number
    isPlacing: boolean
    onConfirm: () => void
    onCancel: () => void
}

export default function OrderConfirmModal({
    itemCount,
    totalAmount,
    isPlacing,
    onConfirm,
    onCancel,
}: OrderConfirmModalProps) {
    const money = useCurrency()
    return (
        <Modal
            open
            onClose={onCancel}
            size="sm"
            ariaLabel="Confirm your order"
            closeOnBackdrop={!isPlacing}
            closeOnEscape={!isPlacing}
            className="overflow-hidden"
        >
                {/* Header */}
                <div className="bg-gradient-to-br from-[#FB6303] to-[#D14E00] px-6 pt-6 pb-8 text-center text-white relative">
                    {!isPlacing && (
                        <button
                            onClick={onCancel}
                            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-surface/15 flex items-center justify-center active:scale-90 transition"
                        >
                            <X size={16} />
                        </button>
                    )}
                    <div className="w-14 h-14 rounded-2xl bg-surface/15 flex items-center justify-center mx-auto mb-3">
                        <ShoppingBag size={28} />
                    </div>
                    <h2 className="text-xl font-black">Confirm Your Order?</h2>
                    <p className="text-white/70 text-sm font-semibold mt-1">
                        Your food will be sent to the kitchen
                    </p>
                </div>

                {/* Summary */}
                <div className="px-6 py-5">
                    <div className="flex items-center justify-between py-3 border-b border-[#F0E0D0]">
                        <span className="text-sm text-ink-subtle font-semibold">Items</span>
                        <span className="text-sm font-bold text-ink">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center justify-between py-3">
                        <span className="text-sm text-ink-subtle font-semibold">Total</span>
                        <span className="text-lg font-black text-brand-500 tabular-nums">{money(totalAmount)}</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="px-6 pb-6 flex gap-3">
                    <button
                        onClick={onCancel}
                        disabled={isPlacing}
                        className="flex-1 py-3.5 rounded-2xl border-2 border-hairline text-ink-subtle font-bold text-sm active:scale-95 transition disabled:opacity-40"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isPlacing}
                        className="flex-1 py-3.5 rounded-2xl bg-brand-500 text-white font-bold text-sm active:scale-95 transition shadow-md shadow-[#FB6303]/20 disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                        {isPlacing ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Placing...
                            </>
                        ) : (
                            'Confirm Order'
                        )}
                    </button>
                </div>
        </Modal>
    )
}
