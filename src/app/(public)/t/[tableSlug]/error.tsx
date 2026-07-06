'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertCircle, RefreshCcw } from 'lucide-react'

export default function CustomerError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => { Sentry.captureException(error) }, [error])
    return (
        <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={40} />
            </div>
            <h2 className="text-2xl font-bold text-ink mb-3">Oops! Something went wrong.</h2>
            <p className="text-ink-subtle max-w-sm mx-auto mb-8">
                We couldn&apos;t load this part of the menu. Please try refreshing.
            </p>
            <button
                onClick={() => reset()}
                className="flex items-center justify-center gap-2 w-full max-w-xs py-3.5 bg-[var(--color-primary)] text-white font-semibold rounded-2xl active:scale-95 transition-transform"
            >
                <RefreshCcw size={20} /> Reload Menu
            </button>
        </div>
    )
}
