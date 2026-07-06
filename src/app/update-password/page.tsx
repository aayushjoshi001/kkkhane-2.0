'use client'

import { useActionState, useState, useEffect } from 'react'
import Link from 'next/link'
import { updatePasswordAction } from './actions'
import AuthHero from '@/components/shared/AuthHero'
import { Lock, ArrowRight, Eye, EyeOff, AlertTriangle } from 'lucide-react'

const initialState = { error: null as string | null }

export default function UpdatePasswordPage() {
    const [state, formAction, isPending] = useActionState(updatePasswordAction, initialState)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [isChecking, setIsChecking] = useState(true)

    // A simple client check just to avoid flicker, the real security check happens in the server action
    useEffect(() => {
        setIsChecking(false)
    }, [])

    const inputClasses = "h-[52px] w-full rounded-[14px] border border-hairline-strong bg-surface pl-12 pr-12 text-[15px] outline-none text-ink placeholder:text-ink-subtle focus:border-[#ff5a00] focus:ring-1 focus:ring-[#ff5a00] transition-all"
    const labelClasses = "text-[13px] font-semibold text-ink flex gap-1 mb-1.5"

    if (isChecking) return null

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

                        <div className="w-full text-left mb-8">
                            <h1 className="text-[1.75rem] font-bold text-ink mb-2">Create New Password</h1>
                            <p className="text-[15px] text-ink-subtle font-normal">Your new password must be at least 8 characters long.</p>
                        </div>

                        <form action={formAction} className="w-full flex flex-col gap-5">
                            {state.error && (
                                <div className="bg-red-50 text-red-700 px-4 py-3 rounded-[14px] text-sm border border-red-100 font-medium text-left flex items-start gap-2">
                                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                                    <span>{state.error}</span>
                                </div>
                            )}

                            <div className="flex flex-col gap-2">
                                <label htmlFor="password" className={labelClasses}>
                                    New Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                                    <input
                                        id="password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        required
                                        autoFocus
                                        className={inputClasses}
                                        placeholder="At least 8 characters"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-muted transition p-1"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label htmlFor="confirmPassword" className={labelClasses}>
                                    Confirm New Password <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                                    <input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type={showConfirm ? 'text' : 'password'}
                                        required
                                        className={inputClasses}
                                        placeholder="Re-enter your new password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirm(!showConfirm)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink-muted transition p-1"
                                        tabIndex={-1}
                                    >
                                        {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isPending}
                                className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {isPending ? (
                                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>Update Password <ArrowRight size={20} className="ml-1" /></>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    )
}
