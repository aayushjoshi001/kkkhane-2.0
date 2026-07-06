'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertCircle, RefreshCcw } from 'lucide-react'

export default function WaiterError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
    useEffect(() => { Sentry.captureException(error) }, [error])
    return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
                <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-extrabold text-ink mb-2">Something went wrong</h2>
            <p className="text-ink-subtle max-w-md mb-6">Could not load the operations panel. Try refreshing.</p>
            <button onClick={() => reset()} className="flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-xl font-medium hover:bg-gray-800 transition active:scale-95">
                <RefreshCcw size={18} /> Retry
            </button>
        </div>
    )
}
