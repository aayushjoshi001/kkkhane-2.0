'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from './actions'
import { Eye, EyeOff, Lock, Mail, ArrowRight } from 'lucide-react'

const initialState = { error: null as string | null }

export function LoginForm({ redirectTo }: { redirectTo: string }) {
    const [state, formAction, isPending] = useActionState(loginAction, initialState)
    const [showPassword, setShowPassword] = useState(false)

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

            <div className="w-full flex items-center gap-4 my-8">
                <div className="h-px bg-gray-200 flex-1"></div>
                <span className="text-[13px] text-gray-400 font-medium">or</span>
                <div className="h-px bg-gray-200 flex-1"></div>
            </div>

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
