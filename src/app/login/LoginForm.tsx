'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from './actions'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react'

const initialState = { error: null as string | null }

export function LoginForm({ redirectTo }: { redirectTo: string }) {
    const [state, formAction, isPending] = useActionState(loginAction, initialState)
    const [showPassword, setShowPassword] = useState(false)
    const [isGoogleLoading, setIsGoogleLoading] = useState(false)
    const [googleError, setGoogleError] = useState<string | null>(null)

    const handleGoogleLogin = async () => {
        setGoogleError(null)
        setIsGoogleLoading(true)
        const supabase = createClient()
        const next = redirectTo ? `&next=${encodeURIComponent(redirectTo)}` : ''
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback?intent=login${next}` },
        })
        // On success the browser navigates away to Google — nothing left to do here.
        if (error) {
            setGoogleError(error.message)
            setIsGoogleLoading(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-start md:justify-center w-full max-w-[420px] mx-auto">
            {/* Mobile Sheet Handle */}
            <div className="w-12 h-1.5 rounded-full bg-[#ff6b00] mb-8 md:hidden" />

            {/* Header */}
            <div className="w-full text-left mb-8">
                <h1 className="text-[1.75rem] font-bold text-gray-900 mb-2">Log in to Your Restaurant</h1>
                <p className="text-[15px] text-gray-500 font-normal">Welcome back! Sign in to continue.</p>
            </div>

            <form action={formAction} className="w-full flex flex-col gap-5">
                <input type="hidden" name="redirect" value={redirectTo} />

                {state?.error && (
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 font-medium text-center">
                        {state.error}
                    </div>
                )}

                {/* Email Input */}
                <div className="flex flex-col gap-2">
                    <label htmlFor="email" className="text-sm font-semibold text-gray-900 flex gap-1">
                        Email Address <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                        <input
                            id="email"
                            name="email"
                            type="email"
                            required
                            className="h-[52px] w-full rounded-[14px] border border-gray-200 bg-white pl-12 pr-4 text-[15px] outline-none text-gray-900 placeholder:text-gray-400 focus:border-[#ff5a00] focus:ring-1 focus:ring-[#ff5a00] transition-all"
                            placeholder="owner@restaurant.com"
                        />
                    </div>
                </div>

                {/* Password Input */}
                <div className="flex flex-col gap-2">
                    <label htmlFor="password" className="text-sm font-semibold text-gray-900 flex gap-1">
                        Password <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#ff5a00]" />
                        <input
                            id="password"
                            name="password"
                            type={showPassword ? 'text' : 'password'}
                            required
                            className="h-[52px] w-full rounded-[14px] border border-gray-200 bg-white pl-12 pr-12 text-[15px] outline-none text-gray-900 placeholder:text-gray-400 focus:border-[#ff5a00] focus:ring-1 focus:ring-[#ff5a00] transition-all"
                            placeholder="Enter your password"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition p-1"
                            tabIndex={-1}
                        >
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                </div>

                <div className="flex justify-end -mt-1 mb-2">
                    <Link href="/forgot-password" className="text-[13px] font-medium text-[#ff5a00] hover:underline">
                        Forgot Password?
                    </Link>
                </div>

                <button
                    type="submit"
                    disabled={isPending}
                    className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mt-1 disabled:opacity-70 disabled:cursor-not-allowed"
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

            <div className="w-full flex items-center gap-4 mt-6 mb-6">
                <div className="h-px bg-gray-200 flex-1"></div>
                <span className="text-[13px] text-gray-400 font-medium">or</span>
                <div className="h-px bg-gray-200 flex-1"></div>
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
                className="w-full bg-white border border-gray-200 text-gray-700 h-[52px] rounded-[14px] text-[15px] font-semibold shadow-sm hover:bg-gray-50 transition-all flex items-center justify-center gap-3 mb-8 disabled:opacity-60 disabled:cursor-not-allowed"
            >
                {isGoogleLoading ? (
                    <span className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                )}
                {isGoogleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>

            <p className="text-center text-[15px] text-gray-500">
                Don&apos;t have an account?{' '}
                <Link href="/signup" className="font-semibold text-[#ff5a00] hover:underline">
                    Sign Up Free
                </Link>
            </p>

            {/* Demo Accounts (Subtle placement beneath the card) */}
            <details className="mt-12 group w-full bg-gray-50 border border-gray-100 rounded-2xl">
                <summary className="text-xs font-semibold text-gray-500 p-4 cursor-pointer flex justify-center hover:text-gray-700 transition-colors list-none text-center outline-none">
                    Development: Show Demo Accounts
                </summary>
                <div className="p-4 pt-0 grid grid-cols-2 gap-2 border-t border-gray-100">
                    {[
                        { label: 'New User', email: 'newuser@srms.app', color: 'bg-pink-100 text-pink-700 hover:bg-pink-200' },
                        { label: 'Super Admin', email: 'demo@srms.app', color: 'bg-orange-100 text-orange-700 hover:bg-orange-200' },
                        { label: 'Manager',    email: 'manager@srms.app', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
                        { label: 'Kitchen',    email: 'kitchen@srms.app', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' },
                        { label: 'Waiter',     email: 'waiter@srms.app',  color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
                        { label: 'Cashier',    email: 'cashier@srms.app', color: 'bg-teal-100 text-teal-700 hover:bg-teal-200' },
                    ].map(({ label, email, color }) => (
                        <button
                            key={email}
                            type="button"
                            className={`text-[11px] font-bold py-2 px-3 rounded-lg transition shadow-sm ${color}`}
                            onClick={() => {
                                setTimeout(() => {
                                    const f = document.getElementById('email') as HTMLInputElement | null
                                    const p = document.getElementById('password') as HTMLInputElement | null
                                    if (f) f.value = email
                                    if (p) p.value = 'Password123!'
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
