'use client'

import { Suspense, useState, useEffect, useActionState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resetPasswordAction } from './actions'
import AuthHero from '@/components/shared/AuthHero'
import { Eye, EyeOff, CheckCircle2, AlertTriangle, ArrowRight, Lock } from 'lucide-react'

const initialState = { error: null as string | null, success: false }

const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#ff6b00] overflow-hidden">
        <div className="w-full md:w-[45%] lg:w-[40%] h-[35vh] md:h-full flex-shrink-0">
            <AuthHero heightClassName="h-full" />
        </div>
        <div className="flex-1 w-full flex flex-col justify-start md:justify-center items-center px-0 md:px-8 -mt-6 md:mt-0 relative z-10 bg-transparent md:bg-surface rounded-t-[2rem] md:rounded-none overflow-hidden">
            <div className="w-full h-full bg-surface md:bg-transparent px-6 sm:px-10 pt-8 pb-12 flex flex-col items-center justify-start md:justify-center overflow-y-auto no-scrollbar relative">
                <div className="w-full max-w-[420px] mx-auto pb-10">
                    {/* Mobile Sheet Handle */}
                    <div className="w-12 h-1.5 rounded-full bg-[#ff6b00] mb-8 md:hidden shrink-0 mx-auto" />
                    {children}
                </div>
            </div>
        </div>
    </div>
)

function ResetPasswordForm() {
    const supabase = createClient()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [sessionReady, setSessionReady] = useState(false)
    const [sessionError, setSessionError] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [state, formAction, isPending] = useActionState(resetPasswordAction, initialState)

    useEffect(() => {
        const code = searchParams.get('code')
        if (!code) { setSessionError(true); return }
        supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
            if (error) setSessionError(true)
            else setSessionReady(true)
        })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (state.success) setTimeout(() => router.push('/login'), 2000)
    }, [state.success, router])

    if (sessionError) return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-[20px] bg-red-50 border border-red-100 mb-6 text-red-500 shadow-sm">
                <AlertTriangle size={40} />
            </div>
            <h1 className="text-[1.75rem] font-bold text-ink mb-2">Link Expired</h1>
            <p className="text-[15px] text-ink-subtle mb-10 leading-relaxed max-w-sm">
                This password reset link has expired or already been used. Please request a new one.
            </p>
            <a href="/forgot-password" className="inline-flex items-center justify-center gap-2 w-full bg-ink hover:bg-gray-800 text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-gray-900/25 transition-all">
                Request New Link
            </a>
        </div>
    )

    if (state.success) return (
        <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-[20px] bg-green-50 border border-green-100 mb-6 text-green-500 shadow-sm">
                <CheckCircle2 size={40} />
            </div>
            <h1 className="text-[1.75rem] font-bold text-ink mb-2">Password Updated!</h1>
            <p className="text-[15px] text-ink-subtle">Redirecting you to login…</p>
        </div>
    )

    if (!sessionReady) return (
        <div className="text-center flex flex-col items-center pt-10">
            <div className="w-10 h-10 border-4 border-hairline-strong border-t-[#ff5a00] rounded-full animate-spin mx-auto mb-6" />
            <p className="text-[15px] text-ink-subtle font-medium">Verifying reset link…</p>
        </div>
    )

    const inputClasses = "h-[52px] w-full rounded-[14px] border border-hairline-strong bg-surface pl-12 pr-12 text-[15px] outline-none text-ink placeholder:text-ink-subtle focus:border-[#ff5a00] focus:ring-1 focus:ring-[#ff5a00] transition-all"
    const labelClasses = "text-[13px] font-semibold text-ink flex gap-1 mb-1.5"

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-full text-left mb-8">
                <h1 className="text-[1.75rem] font-bold text-ink mb-2">Set New Password</h1>
                <p className="text-[15px] text-ink-subtle font-normal">Choose a strong password of at least 8 characters.</p>
            </div>

            <form action={formAction} className="space-y-5">
                {state.error && (
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-[14px] text-sm border border-red-100 font-medium text-center">
                        {state.error}
                    </div>
                )}

                <div className="flex flex-col gap-2">
                    <label className={labelClasses} htmlFor="password">
                        New Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                        <input
                            id="password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            className={inputClasses}
                            placeholder="••••••••"
                            onChange={(e) => {
                                const val = e.target.value
                                const meter = document.getElementById('pwd-meter')
                                const text = document.getElementById('pwd-text')
                                if (meter && text) {
                                    if (!val) {
                                        meter.style.display = 'none'
                                        return
                                    }
                                    meter.style.display = 'flex'
                                    const strength = (val.length >= 8 ? 1 : 0) + (/[a-z]/.test(val) && /[A-Z]/.test(val) ? 1 : 0) + (/\d/.test(val) ? 1 : 0) + (/[^a-zA-Z\d]/.test(val) ? 1 : 0)
                                    const bars = meter.querySelectorAll('.meter-bar')
                                    bars.forEach((bar, i) => {
                                        const b = bar as HTMLElement
                                        b.className = `meter-bar h-1.5 flex-1 rounded-full transition-colors ${strength > i ? (strength <= 2 ? 'bg-brand-500' : strength === 3 ? 'bg-yellow-500' : 'bg-green-500') : 'bg-surface-muted'}`
                                    })
                                    text.innerText = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength]
                                }
                                
                                // Validation for confirm match
                                const confirm = document.getElementById('confirm') as HTMLInputElement
                                const confirmErr = document.getElementById('confirm-error')
                                if (confirm && confirm.value) {
                                    if (confirm.value !== val) {
                                        confirm.classList.add('border-red-300', 'focus:border-red-500', 'focus:ring-red-500')
                                        if (confirmErr) confirmErr.style.display = 'block'
                                    } else {
                                        confirm.classList.remove('border-red-300', 'focus:border-red-500', 'focus:ring-red-500')
                                        if (confirmErr) confirmErr.style.display = 'none'
                                    }
                                }
                            }}
                        />
                        <button type="button" onClick={() => setShowPassword(p => !p)} tabIndex={-1}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-muted transition p-1">
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                    <div id="pwd-meter" className="mt-1.5 hidden items-center gap-2">
                        <div className="meter-bar h-1.5 flex-1 rounded-full bg-surface-muted" />
                        <div className="meter-bar h-1.5 flex-1 rounded-full bg-surface-muted" />
                        <div className="meter-bar h-1.5 flex-1 rounded-full bg-surface-muted" />
                        <div className="meter-bar h-1.5 flex-1 rounded-full bg-surface-muted" />
                        <span id="pwd-text" className="text-[11px] text-ink-subtle font-medium w-12 text-right"></span>
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <label className={labelClasses} htmlFor="confirm">
                        Confirm Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                        <input
                            id="confirm"
                            name="confirm"
                            type={showConfirm ? 'text' : 'password'}
                            required
                            minLength={8}
                            className={inputClasses}
                            placeholder="••••••••"
                            onChange={(e) => {
                                const pwd = (document.getElementById('password') as HTMLInputElement).value
                                const confirm = e.target
                                const confirmErr = document.getElementById('confirm-error')
                                if (confirm.value && confirm.value !== pwd) {
                                    confirm.classList.add('border-red-300', 'focus:border-red-500', 'focus:ring-red-500')
                                    if (confirmErr) confirmErr.style.display = 'block'
                                } else {
                                    confirm.classList.remove('border-red-300', 'focus:border-red-500', 'focus:ring-red-500')
                                    if (confirmErr) confirmErr.style.display = 'none'
                                }
                            }}
                        />
                        <button type="button" onClick={() => setShowConfirm(p => !p)} tabIndex={-1}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-muted transition p-1">
                            {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                    <p id="confirm-error" className="hidden text-[11px] text-red-500 mt-0.5 font-medium">Passwords do not match</p>
                </div>

                <button type="submit" disabled={isPending}
                        className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed">
                    {isPending ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>Update Password <ArrowRight size={20} className="ml-1" /></>
                    )}
                </button>
            </form>
        </div>
    )
}

export default function ResetPasswordPage() {
    return (
        <Shell>
            <Suspense fallback={
                <div className="text-center flex flex-col items-center pt-10">
                    <div className="w-10 h-10 border-4 border-hairline-strong border-t-[#ff5a00] rounded-full animate-spin mx-auto mb-6" />
                    <p className="text-[15px] text-ink-subtle font-medium">Loading…</p>
                </div>
            }>
                <ResetPasswordForm />
            </Suspense>
        </Shell>
    )
}
