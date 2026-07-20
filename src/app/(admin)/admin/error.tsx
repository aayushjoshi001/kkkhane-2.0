'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

export default function AdminError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('Admin Error Boundary:', error)
        Sentry.captureException(error)
    }, [error])

    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center bg-surface rounded-2xl shadow-sm border border-red-100">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
                <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Something went wrong</h2>
            <p className="text-ink-subtle max-w-md mx-auto mb-8">
                An error occurred while loading this section. You can try recovering the page or returning to the dashboard.
            </p>
            <div className="flex gap-4">
                <button
                    onClick={() => reset()}
                    className="flex items-center gap-2 px-5 py-2.5 bg-ink text-surface rounded-xl font-medium hover:opacity-90 transition-opacity"
                >
                    <RefreshCcw size={18} /> Try again
                </button>
            </div>
            {error.message && (
                <div className="mt-8 p-4 bg-surface-muted rounded-lg text-left w-full max-w-2xl overflow-auto text-xs font-mono text-ink-muted border border-hairline-strong">
                    {error.message}
                </div>
            )}
        </div>
    )
}
