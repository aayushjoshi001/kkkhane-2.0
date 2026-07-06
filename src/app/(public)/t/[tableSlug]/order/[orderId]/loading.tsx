import { Loader2, CheckCircle2 } from 'lucide-react'

// Shown instantly on navigation while the order page renders server-side, so
// there's no blank gap between "Place Order" and the confirmation screen.
export default function OrderLoading() {
    return (
        <div className="min-h-screen bg-surface-muted flex flex-col items-center justify-center p-6 text-center">
            <div className="relative w-16 h-16 mb-5">
                <div className="absolute inset-0 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-[var(--color-primary)]" />
                </div>
                <Loader2 size={64} className="absolute inset-0 animate-spin text-[var(--color-primary)]/40" />
            </div>
            <h1 className="text-lg font-bold text-ink">Confirming your order…</h1>
            <p className="text-sm text-ink-subtle mt-1">Sending it to the kitchen.</p>
        </div>
    )
}
