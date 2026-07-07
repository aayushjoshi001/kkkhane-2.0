'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Turnstile } from '@marsidev/react-turnstile'
import { useTurnstile, TURNSTILE_SITE_KEY } from '@/lib/hooks/useTurnstile'
import { forgotPasswordAction } from './actions'
import AuthHero from '@/components/shared/AuthHero'
import { Mail, ArrowLeft, CheckCircle2, ArrowRight } from 'lucide-react'

const initialState = { error: null as string | null, success: false }

export default function ForgotPasswordPage() {
    const [state, formAction, isPending] = useActionState(forgotPasswordAction, initialState)
    const turnstile = useTurnstile()

    const inputClasses = "h-[52px] w-full rounded-[14px] border border-hairline-strong bg-surface pl-12 pr-4 text-[15px] outline-none text-ink placeholder:text-ink-subtle focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all"
    const labelClasses = "text-[13px] font-semibold text-ink flex gap-1 mb-1.5"

    return (
        <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#ff6b00] overflow-hidden">
            <div className="w-full md:w-[45%] lg:w-[40%] h-[35vh] md:h-full flex-shrink-0">
                <AuthHero heightClassName="h-full" />
            </div>
            <div className="flex-1 w-full flex flex-col justify-start md:justify-center items-center px-0 md:px-8 -mt-6 md:mt-0 relative z-10 bg-transparent md:bg-surface rounded-t-[2rem] md:rounded-none overflow-hidden">
                <div className="w-full h-full bg-surface md:bg-transparent px-6 sm:px-10 pt-8 pb-12 flex flex-col items-center justify-start md:justify-center overflow-y-auto no-scrollbar relative">
                    <div className="w-full max-w-[420px] mx-auto pb-10">
                        {/* Mobile Sheet Handle */}
                        <div className="w-12 h-1.5 rounded-full bg-[#ff6b00] mb-8 md:hidden shrink-0 mx-auto" />

                        {state.success ? (
                            <div className="w-full text-center animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
                                <div className="inline-flex items-center justify-center w-20 h-20 rounded-[20px] bg-green-50 border border-green-100 mb-6 text-green-500 shadow-sm">
                                    <CheckCircle2 size={40} />
                                </div>
                                <h1 className="text-[1.75rem] font-bold text-ink mb-2">Check your inbox</h1>
                                <p className="text-[15px] text-ink-subtle mb-10 leading-relaxed max-w-sm">
                                    If an account exists for that email, we sent a password reset link. It expires in 1 hour.
                                </p>
                                <Link href="/login"
                                      className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-gray-800 text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-gray-900/25 transition-all">
                                    <ArrowLeft size={18} /> Back to Log In
                                </Link>
                            </div>
                        ) : (
                            <>
                                <div className="w-full text-left mb-8">
                                    <h1 className="text-[1.75rem] font-bold text-ink mb-2">Reset Password</h1>
                                    <p className="text-[15px] text-ink-subtle font-normal">Enter your email and we'll send a reset link.</p>
                                </div>

                                <form action={formAction} className="w-full flex flex-col gap-5">
                                    <input type="hidden" name="cf-turnstile-response" value={turnstile.token || ''} />
                                    {state.error && (
                                        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-[14px] text-sm border border-red-100 font-medium text-center">
                                            {state.error}
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-2">
                                        <label htmlFor="email" className={labelClasses}>
                                            Email Address <span className="text-red-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500" />
                                            <input
                                                id="email"
                                                name="email"
                                                type="email"
                                                required
                                                autoFocus
                                                className={inputClasses}
                                                placeholder="owner@restaurant.com"
                                            />
                                        </div>
                                    </div>
                                    
                                    {TURNSTILE_SITE_KEY && (
                                        <div className="flex flex-col items-center gap-2 mt-2">
                                            <Turnstile
                                                siteKey={TURNSTILE_SITE_KEY}
                                                onSuccess={turnstile.handleSuccess}
                                                onExpire={turnstile.handleExpire}
                                                onError={turnstile.handleError}
                                                options={{ theme: 'light', size: 'normal' }}
                                                injectScript={false}
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
                                            <>Send Reset Link <ArrowRight size={20} className="ml-1" /></>
                                        )}
                                    </button>
                                </form>

                                <div className="mt-8 text-center">
                                    <Link href="/login"
                                          className="inline-flex items-center gap-2 text-[15px] font-semibold text-ink-subtle hover:text-ink transition">
                                        <ArrowLeft size={16} /> Back to Log In
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
