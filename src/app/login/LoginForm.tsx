'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from './actions'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react'
import { Turnstile } from '@marsidev/react-turnstile'
import { useTurnstile, TURNSTILE_SITE_KEY } from '@/lib/hooks/useTurnstile'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/lib/demoAccounts'

const initialState = { error: null as string | null }

export function LoginForm({ redirectTo }: { redirectTo: string }) {
    const [state, formAction, isPending] = useActionState(loginAction, initialState)
    const [showPassword, setShowPassword] = useState(false)
    const turnstile = useTurnstile()
    const [isGoogleLoading, setIsGoogleLoading] = useState(false)
    const [googleError, setGoogleError] = useState<string | null>(null)

    const handleGoogleLogin = async () => {
        setGoogleError(null)
        setIsGoogleLoading(true)
        const supabase = createClient()
        const next = redirectTo ? `&next=${encodeURIComponent(redirectTo)}` : ''
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/auth/callback?intent=login${next}` },
            })
            // On success the browser navigates away to Google — nothing left to do here.
            if (error) {
                setGoogleError(error.message)
                setIsGoogleLoading(false)
            }
        } catch (err: any) {
            console.error('Google OAuth login error:', err)
            setGoogleError('Network error connecting to the authentication server.')
            setIsGoogleLoading(false)
        }
    }

    return (
        <div className="flex flex-col items-center w-full max-w-[420px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Mobile Sheet Handle */}
            <div className="w-12 h-1.5 rounded-full bg-brand-200 mb-8 md:hidden" />

            {/* Header */}
            <div className="w-full text-center md:text-left mb-10">
                <h1 className="text-3xl md:text-4xl font-extrabold text-ink tracking-tight mb-3">Log in to Your Restaurant</h1>
                <p className="text-base text-ink-subtle font-medium">Welcome back! Sign in to continue managing your business.</p>
            </div>

            <form action={formAction} className="w-full flex flex-col gap-5">
                <input type="hidden" name="redirect" value={redirectTo} />
                <input type="hidden" name="cf-turnstile-response" value={turnstile.token || ''} />

                {state?.error && (
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 font-medium text-center">
                        {state.error}
                    </div>
                )}

                {/* Email Input */}
                <div className="flex flex-col gap-2 group">
                    <label htmlFor="email" className="text-sm font-bold text-ink-subtle uppercase tracking-wider flex gap-1 transition-colors group-focus-within:text-brand-600">
                        Email Address <span className="text-danger-fg">*</span>
                    </label>
                    <div className="relative">
                        <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted group-focus-within:text-brand-500 transition-colors" />
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/30 hover:bg-surface focus:bg-surface pl-12 pr-4 text-[15px] font-semibold outline-none text-ink placeholder:text-ink-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            placeholder="owner@restaurant.com"
                        />
                    </div>
                </div>

                {/* Password Input */}
                <div className="flex flex-col gap-2 group">
                    <label htmlFor="password" className="text-sm font-bold text-ink-subtle uppercase tracking-wider flex gap-1 transition-colors group-focus-within:text-brand-600">
                        Password <span className="text-danger-fg">*</span>
                    </label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted group-focus-within:text-brand-500 transition-colors" />
                        <input
                            id="password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            required
                            className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/30 hover:bg-surface focus:bg-surface pl-12 pr-12 text-[15px] font-semibold outline-none text-ink placeholder:text-ink-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            placeholder="Enter your password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-muted hover:text-brand-500 transition-colors p-1 rounded-md focus-ring"
                            tabIndex={-1}
                        >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                </div>

                <div className="flex justify-end -mt-1 mb-3">
                    <Link href="/forgot-password" className="text-sm font-bold text-brand-600 hover:text-brand-500 transition-colors">
                        Forgot Password?
                    </Link>
                </div>
                
                {TURNSTILE_SITE_KEY && (
                    <div className="flex flex-col items-center gap-2 mb-2">
                        <Turnstile
                            siteKey={TURNSTILE_SITE_KEY}
                            onSuccess={turnstile.handleSuccess}
                            onExpire={turnstile.handleExpire}
                            onError={turnstile.handleError}
                            options={{ theme: 'light', size: 'normal' }}
                            scriptOptions={{ appendTo: 'body' }}
                        />
                        {turnstile.unavailable && (
                            <p className="text-xs text-ink-muted text-center max-w-xs">
                                Security check is taking longer than usual. You can still continue.
                            </p>
                        )}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isPending || turnstile.isBlocking}
                    className="w-full bg-brand-500 hover:bg-brand-400 text-white h-14 rounded-2xl text-base font-extrabold shadow-[0_8px_24px_rgba(251,99,3,0.3)] hover:shadow-[0_12px_32px_rgba(251,99,3,0.4)] transition-all hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 mt-1 disabled:opacity-70 disabled:pointer-events-none focus-ring"
                >
                    {isPending ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            Log In <ArrowRight size={20} className="ml-1" />
                        </>
                    )}
                </button>
            </form>

            <div className="w-full flex items-center gap-4 mt-8 mb-8">
                <div className="h-px bg-hairline flex-1"></div>
                <span className="text-[13px] text-ink-muted font-bold uppercase tracking-widest">or</span>
                <div className="h-px bg-hairline flex-1"></div>
            </div>

            {googleError && (
                <div className="w-full bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 font-medium text-center mb-4">
                    {googleError}
                </div>
            )}
            <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading}
                className="w-full bg-surface border border-hairline text-ink h-14 rounded-2xl text-[15px] font-bold shadow-sm hover:bg-surface-muted transition-all flex items-center justify-center gap-3 mb-8 disabled:opacity-60 disabled:pointer-events-none focus-ring"
            >
                {isGoogleLoading ? (
                    <span className="w-5 h-5 border-2 border-ink-muted border-t-ink rounded-full animate-spin" />
                ) : (
                    <svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                )}
                {isGoogleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <p className="text-center text-[15px] font-medium text-ink-subtle">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="font-extrabold text-brand-600 hover:text-brand-500 transition-colors">
                    Sign Up Free
                </Link>
            </p>

            {/* Demo Accounts (Subtle placement beneath the card) */}
            <details className="mt-12 group w-full bg-surface-muted border border-hairline rounded-2xl">
                <summary className="text-xs font-semibold text-ink-subtle p-4 cursor-pointer flex justify-center hover:text-ink-muted transition-colors list-none text-center outline-none">
                    Development: Show Demo Accounts
                </summary>
                <div className="p-4 pt-0 grid grid-cols-2 gap-2 border-t border-hairline">
                    {DEMO_ACCOUNTS.map(({ label, email, color }) => (
                        <button
                            key={email}
                            type="button"
                            className={`text-[11px] font-bold py-2 px-3 rounded-lg transition shadow-sm ${color}`}
                            onClick={() => {
                                setTimeout(() => {
                                    const f = document.getElementById('email') as HTMLInputElement | null
                                    const p = document.getElementById('password') as HTMLInputElement | null
                                    if (f) f.value = email
                                    if (p) p.value = DEMO_PASSWORD
                                }, 10)
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </details>
        </div>
    )
}
