'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Lock, User, ArrowRight, AlertTriangle } from 'lucide-react'
import { acceptInvitationAction } from './actions'

type InviteLookup =
    | { valid: true; restaurantName: string; roleName: string; email: string }
    | { valid: false; reason: string }

function formatRoleName(name: string) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export default function AcceptInviteForm({ token, result }: { token: string; result: InviteLookup }) {
    const router = useRouter()
    const [fullName, setFullName] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    if (!result.valid) {
        return (
            <div className="flex flex-col items-center w-full max-w-[420px] mx-auto text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="w-12 h-1.5 rounded-full bg-brand-200 mb-8 md:hidden" />
                <div className="mx-auto w-16 h-16 rounded-full bg-danger-bg/20 border border-danger-bg flex items-center justify-center mb-6">
                    <AlertTriangle size={28} className="text-danger-fg" />
                </div>
                <h1 className="text-2xl font-extrabold text-ink tracking-tight mb-3">Invite Not Available</h1>
                <p className="text-base text-ink-subtle font-medium">{result.reason}</p>
            </div>
        )
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (fullName.trim().length < 2) {
            setError('Please enter your full name')
            return
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters')
            return
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }

        setIsSubmitting(true)
        const res = await acceptInvitationAction(token, { fullName, password })
        setIsSubmitting(false)

        if (!res.success) {
            setError(res.error || 'Failed to accept invitation')
            return
        }

        router.push(res.landing || '/admin/dashboard')
    }

    return (
        <div className="flex flex-col items-center w-full max-w-[420px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="w-12 h-1.5 rounded-full bg-brand-200 mb-8 md:hidden" />

            <div className="w-full text-center md:text-left mb-10">
                <h1 className="text-3xl md:text-4xl font-extrabold text-ink tracking-tight mb-3">Join {result.restaurantName}</h1>
                <p className="text-base text-ink-subtle font-medium">
                    You&apos;ve been invited as <strong className="text-ink">{formatRoleName(result.roleName)}</strong>. Set your password to get started.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-5">
                {error && (
                    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 font-medium text-center">
                        {error}
                    </div>
                )}

                <div className="flex flex-col gap-2 group">
                    <label htmlFor="email" className="text-sm font-bold text-ink-subtle uppercase tracking-wider">Email Address</label>
                    <input
                        id="email"
                        type="email"
                        value={result.email}
                        disabled
                        className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/50 px-4 text-[15px] font-semibold text-ink-subtle"
                    />
                </div>

                <div className="flex flex-col gap-2 group">
                    <label htmlFor="fullName" className="text-sm font-bold text-ink-subtle uppercase tracking-wider flex gap-1 transition-colors group-focus-within:text-brand-600">
                        Full Name <span className="text-danger-fg">*</span>
                    </label>
                    <div className="relative">
                        <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted group-focus-within:text-brand-500 transition-colors" />
                        <input
                            id="fullName"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            required
                            disabled={isSubmitting}
                            className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/30 hover:bg-surface focus:bg-surface pl-12 pr-4 text-[15px] font-semibold outline-none text-ink placeholder:text-ink-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] disabled:opacity-50"
                            placeholder="Your full name"
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2 group">
                    <label htmlFor="password" className="text-sm font-bold text-ink-subtle uppercase tracking-wider flex gap-1 transition-colors group-focus-within:text-brand-600">
                        Password <span className="text-danger-fg">*</span>
                    </label>
                    <div className="relative">
                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted group-focus-within:text-brand-500 transition-colors" />
                        <input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            disabled={isSubmitting}
                            className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/30 hover:bg-surface focus:bg-surface pl-12 pr-12 text-[15px] font-semibold outline-none text-ink placeholder:text-ink-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] disabled:opacity-50"
                            placeholder="At least 8 characters"
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

                <div className="flex flex-col gap-2 group">
                    <label htmlFor="confirmPassword" className="text-sm font-bold text-ink-subtle uppercase tracking-wider flex gap-1 transition-colors group-focus-within:text-brand-600">
                        Confirm Password <span className="text-danger-fg">*</span>
                    </label>
                    <input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        disabled={isSubmitting}
                        className="h-14 w-full rounded-2xl border border-hairline bg-surface-muted/30 hover:bg-surface focus:bg-surface px-4 text-[15px] font-semibold outline-none text-ink placeholder:text-ink-muted focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] disabled:opacity-50"
                        placeholder="Re-enter your password"
                    />
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-brand-500 hover:bg-brand-400 text-white h-14 rounded-2xl text-base font-extrabold shadow-[0_8px_24px_rgba(251,99,3,0.3)] hover:shadow-[0_12px_32px_rgba(251,99,3,0.4)] transition-all hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 mt-1 disabled:opacity-70 disabled:pointer-events-none focus-ring"
                >
                    {isSubmitting ? (
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>
                            Accept & Get Started <ArrowRight size={20} className="ml-1" />
                        </>
                    )}
                </button>
            </form>
        </div>
    )
}
