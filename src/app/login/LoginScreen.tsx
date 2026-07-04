'use client'

import { useState, useEffect } from 'react'
import { LoginForm } from './LoginForm'
import StaffLoginView, { STAFF_TERMINAL_STORAGE_KEY } from './StaffLoginView'

/**
 * Owns the toggle between the owner/manager email+password form and the
 * staff name+PIN terminal view. Defaults to owner mode unless a `?r=` slug
 * was passed in (a bookmarked terminal link) — a remembered terminal slug in
 * localStorage (no `?r=`) flips to staff mode right after mount instead of
 * on first render, so server and client markup still match on hydration.
 */
export default function LoginScreen({ redirectTo, initialSlug }: { redirectTo: string; initialSlug?: string }) {
    const [mode, setMode] = useState<'owner' | 'staff'>(initialSlug ? 'staff' : 'owner')

    useEffect(() => {
        if (!initialSlug && localStorage.getItem(STAFF_TERMINAL_STORAGE_KEY)) {
            setMode('staff')
        }
        // Only relevant on first mount for the "remembered device" case.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (mode === 'staff') {
        return <StaffLoginView initialSlug={initialSlug} onSwitchToOwnerLogin={() => setMode('owner')} />
    }

    return (
        <div className="w-full flex flex-col items-center">
            <LoginForm redirectTo={redirectTo} />
            <button
                onClick={() => setMode('staff')}
                className="text-sm font-semibold text-gray-400 hover:text-gray-600 mt-4 transition-colors"
            >
                Staff sign-in →
            </button>
        </div>
    )
}
