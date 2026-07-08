'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { Loader2 } from 'lucide-react'

export default function UnauthorizedPage() {
    const router = useRouter()
    const [isLoggingOut, setIsLoggingOut] = useState(false)

    const handleLogoutAndLogin = async () => {
        setIsLoggingOut(true)
        try {
            await signOutAndRedirect(router)
        } catch (e) {
            console.error('Sign-out error:', e)
            router.push('/login')
        } finally {
            setIsLoggingOut(false)
        }
    }

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-secondary)]">
            <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-2xl text-center">
                <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                    <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                </div>
                <h1 className="text-2xl font-bold text-ink mb-2">Access Denied</h1>
                <p className="text-ink-subtle mb-8">
                    You don&apos;t have permission to access this page.
                    Please contact your administrator if you believe this is a mistake.
                </p>
                <div className="flex flex-col gap-3">
                    <button
                        onClick={handleLogoutAndLogin}
                        disabled={isLoggingOut}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-secondary)] px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-colors disabled:opacity-50"
                    >
                        {isLoggingOut ? <Loader2 size={16} className="animate-spin" /> : null}
                        Logout &amp; Switch Account
                    </button>
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center rounded-xl border border-hairline-strong px-6 py-3 text-sm font-semibold text-ink-muted hover:bg-surface-muted transition-colors"
                    >
                        Back to Home
                    </Link>
                </div>
            </div>
        </div>
    )
}
