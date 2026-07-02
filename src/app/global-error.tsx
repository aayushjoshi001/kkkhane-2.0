'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

/**
 * Last-resort error boundary. Catches errors thrown in the root layout/template that
 * the per-segment error.tsx boundaries cannot reach. Replaces the whole document, so
 * it must render its own <html>/<body>.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => { Sentry.captureException(error) }, [error])

    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#FAFAF8' }}>
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginBottom: '0.75rem' }}>
                        Something went wrong
                    </h2>
                    <p style={{ color: '#6b7280', maxWidth: '28rem', marginBottom: '2rem' }}>
                        An unexpected error occurred. Please try again.
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <button
                            onClick={() => reset()}
                            style={{ padding: '0.75rem 1.5rem', background: '#111827', color: 'white', border: 'none', borderRadius: '0.75rem', fontWeight: 500, cursor: 'pointer' }}
                        >
                            Try again
                        </button>
                        <a 
                            href="/"
                            style={{ padding: '0.75rem 1.5rem', background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: '0.75rem', fontWeight: 500, textDecoration: 'none' }}
                        >
                            Back to Home
                        </a>
                    </div>
                </div>
            </body>
        </html>
    )
}
