'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { registerUserAction } from './actions'
import { Eye, EyeOff, Lock, Mail, ArrowRight, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Turnstile } from '@marsidev/react-turnstile'
import { useTurnstile, TURNSTILE_SITE_KEY } from '@/lib/hooks/useTurnstile'

export default function SignupForm() {
    const router = useRouter()
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [isGoogleLoading, setIsGoogleLoading] = useState(false)
    const turnstile = useTurnstile()

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsPending(true)
        setError(null)

        const formData = new FormData(e.currentTarget)
        const password = formData.get('password') as string
        const confirmPassword = formData.get('confirmPassword') as string

        if (password !== confirmPassword) {
            setError('Passwords do not match.')
            setIsPending(false)
            return
        }

        try {
            const result = await registerUserAction(formData)
            if (result.error) {
                setError(result.error)
            } else {
                router.push('/onboarding')
            }
        } catch (err) {
            setError('An unexpected error occurred.')
        } finally {
            setIsPending(false)
        }
    }

    const handleGoogleSignup = async () => {
        setError(null)
        setIsGoogleLoading(true)
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback?intent=signup&next=/onboarding` },
        })
        if (error) {
            setError(error.message)
            setIsGoogleLoading(false)
        }
    }

    const inputClasses = "h-[52px] w-full pl-12 pr-4 border border-hairline-strong rounded-[14px] text-[15px] focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 transition-all bg-surface placeholder:text-ink-subtle text-ink"
    const labelClasses = "text-[14px] font-semibold text-ink flex gap-1 mb-2"

    return (
        <div className="flex flex-col items-center justify-start md:justify-center w-full max-w-[420px] mx-auto pb-10">
            {/* Mobile Sheet Handle */}
            <div className="w-12 h-1.5 rounded-full bg-[#ff6b00] mb-8 md:hidden shrink-0" />

            {/* Header Content */}
            <div className="w-full text-left mb-8">
                <h1 className="text-[1.75rem] font-bold text-ink mb-2">Create an Account</h1>
                <p className="text-[15px] text-ink-subtle font-normal">Join KKKhane and set up your restaurant in minutes.</p>
            </div>

            {error && (
                <div className="w-full bg-red-50 text-red-700 px-4 py-3 rounded-[14px] text-[14px] border border-red-100 font-medium mb-6 text-center">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
                <div>
                    <label htmlFor="fullName" className={labelClasses}>Full Name <span className="text-red-500">*</span></label>
                    <div className="relative">
                        <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500" />
                        <input id="fullName" name="fullName" required placeholder="John Doe" className={inputClasses} />
                    </div>
                </div>

                <div>
                    <label htmlFor="email" className={labelClasses}>Email Address <span className="text-red-500">*</span></label>
                    <div className="relative">
                        <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500" />
                        <input id="email" name="email" type="email" required placeholder="owner@restaurant.com" className={inputClasses} />
                    </div>
                </div>

                <div>
                    <label htmlFor="password" className={labelClasses}>Password <span className="text-red-500">*</span></label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500" />
                        <input id="password" name="password" type={showPassword ? 'text' : 'password'} required placeholder="At least 8 characters" className={inputClasses} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-muted transition p-1">
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                <div>
                    <label htmlFor="confirmPassword" className={labelClasses}>Confirm Password <span className="text-red-500">*</span></label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500" />
                        <input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} required placeholder="Re-enter your password" className={inputClasses} />
                    </div>
                </div>

                <input type="hidden" name="cf-turnstile-response" value={turnstile.token || ''} />

                {TURNSTILE_SITE_KEY && (
                    <div className="flex flex-col items-center gap-2 mt-2 mb-2">
                        <Turnstile
                            siteKey={TURNSTILE_SITE_KEY}
                            onSuccess={turnstile.handleSuccess}
                            onExpire={turnstile.handleExpire}
                            onError={turnstile.handleError}
                            options={{ theme: 'light', size: 'normal' }}
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
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                    {isPending ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>Create Account <ArrowRight size={20} className="ml-1" /></>
                    )}
                </button>
            </form>

            <div className="w-full flex items-center gap-4 mt-6 mb-6">
                <div className="h-px bg-surface-muted flex-1"></div>
                <span className="text-[13px] text-ink-subtle font-medium">or</span>
                <div className="h-px bg-surface-muted flex-1"></div>
            </div>

            <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={isGoogleLoading}
                className="w-full bg-surface border border-hairline-strong text-ink-muted h-[52px] rounded-[14px] text-[15px] font-semibold shadow-sm hover:bg-surface-muted transition-all flex items-center justify-center gap-3 mb-6 disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {isGoogleLoading ? (
                    <span className="w-5 h-5 border-2 border-hairline-strong border-t-gray-600 rounded-full animate-spin" />
                ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                )}
                {isGoogleLoading ? 'Redirecting…' : 'Sign up with Google'}
            </button>

            <p className="text-center text-[15px] text-ink-subtle">
                Already have an account?{' '}
                <Link href="/login" className="font-semibold text-brand-500 hover:underline">
                    Log In
                </Link>
            </p>
        </div>
    )
}
