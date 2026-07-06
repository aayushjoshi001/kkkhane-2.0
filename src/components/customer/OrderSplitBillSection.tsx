'use client'

import { useState } from 'react'
import { Scissors } from 'lucide-react'
import SplitBillModal from './SplitBillModal'

/**
 * Split Bill section on the order tracking page.
 * Shown after order is placed so the bill can be split among guests.
 */
export default function OrderSplitBillSection({
    sessionId,
    totalAmount,
}: {
    sessionId: string
    totalAmount: number
}) {
    const [showSplit, setShowSplit] = useState(false)

    return (
        <>
            <div className="mt-4 bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline overflow-hidden">
                <button
                    onClick={() => setShowSplit(true)}
                    className="w-full px-4 py-4 flex items-center justify-between hover:bg-surface-muted active:scale-[0.98] transition-all"
                >
                    <div className="flex items-center gap-2">
                        <Scissors size={20} className="text-blue-600" />
                        <span className="font-semibold text-ink">Split the Bill</span>
                    </div>
                    <span className="text-sm text-ink-subtle">Divide among guests →</span>
                </button>
            </div>

            {showSplit && (
                <SplitBillModal
                    sessionId={sessionId}
                    totalAmount={totalAmount}
                    onClose={() => setShowSplit(false)}
                />
            )}
        </>
    )
}
