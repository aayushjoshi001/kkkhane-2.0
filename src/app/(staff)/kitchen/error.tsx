'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

export default function KitchenError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
    useEffect(() => { Sentry.captureException(error) }, [error])
    return (
        <div className="flex flex-col items-center justify-center h-full bg-ink text-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-red-900/50 text-red-400 rounded-full flex items-center justify-center mb-6">
                <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-extrabold mb-2">Kitchen Display Error</h2>
            <p className="text-ink-subtle max-w-md mb-6">Could not load the order queue. Try refreshing.</p>
            <button onClick={() => reset()} className="flex items-center gap-2 px-5 py-2.5 bg-gray-700 text-white rounded-xl font-medium hover:bg-gray-600 transition active:scale-95">
                <RefreshCcw size={18} /> Retry
            </button>
        </div>
    )
}
