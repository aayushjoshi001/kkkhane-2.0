'use client'

import { useEffect, useState, ReactNode } from 'react'
import { useBusinessSession } from '@/lib/contexts/BusinessSessionContext'
import { Play, Lock, AlertCircle, RefreshCw, LogOut, Loader2, Sparkles, Building2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import Logo from '@/components/shared/Logo'

interface BusinessGuardProps {
    children: ReactNode
}

export default function BusinessGuard({ children }: BusinessGuardProps) {
    const router = useRouter()
    const { isClosed, canManage, userRole, todayDate, openBusiness, refreshSession, loading, setGuardActive } = useBusinessSession()

    const [openingCash, setOpeningCash] = useState<string>('0')
    const [openingBank, setOpeningBank] = useState<string>('0')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)

    // Announce the lock screen so the periodic reminder stays out of its way —
    // a permanent prompt with the form on it beats a popup saying the same
    // thing. Declared above the early return to keep the hook order stable.
    useEffect(() => {
        setGuardActive(isClosed)
        return () => setGuardActive(false)
    }, [isClosed, setGuardActive])

    if (!isClosed) {
        return <>{children}</>
    }

    async function handleOpen(e: React.FormEvent) {
        e.preventDefault()
        setIsSubmitting(true)
        const cashVal = parseFloat(openingCash) || 0
        const bankVal = parseFloat(openingBank) || 0
        await openBusiness(todayDate, cashVal, bankVal)
        setIsSubmitting(false)
    }

    async function handleManualRefresh() {
        setIsRefreshing(true)
        await refreshSession()
        setIsRefreshing(false)
    }

    return (
        <div className="relative min-h-screen w-full">
            {/* Background Content (Disabled & Blurred) */}
            <div className="pointer-events-none select-none blur-sm opacity-25 filter grayscale" aria-hidden="true">
                {children}
            </div>

            {/* Lockout Screen Barrier Overlay */}
            <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fade-in">
                <div className="w-full max-w-lg bg-surface border border-hairline rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 animate-scale-in relative overflow-hidden">
                    {/* Decorative ambient gradient backdrop */}
                    <div className="absolute -top-24 -right-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                    {/* Header Brand & Status */}
                    <div className="flex items-center justify-between border-b border-hairline pb-4">
                        <Logo className="h-7" />
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                            </span>
                            Business Closed
                        </div>
                    </div>

                    {/* Lock Icon & Title */}
                    <div className="text-center space-y-3 pt-2">
                        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white flex items-center justify-center shadow-lg shadow-amber-500/25 ring-8 ring-amber-500/10">
                            <Lock size={32} />
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
                            Business Day is Locked
                        </h2>
                        <p className="text-xs sm:text-sm text-ink-muted leading-relaxed max-w-md mx-auto">
                            No registers, orders, kitchen displays, or panel operations can be performed until the business day is opened.
                        </p>
                    </div>

                    {/* Manager / Cashier View: Open Business Form */}
                    {canManage ? (
                        <form onSubmit={handleOpen} className="space-y-4 bg-surface-muted/60 border border-hairline rounded-2xl p-4 sm:p-5">
                            <div className="flex items-center gap-2 text-xs font-bold text-ink uppercase tracking-wider text-amber-600">
                                <Sparkles size={15} />
                                <span>Open Business Day ({todayDate || 'Today'})</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-ink-muted">Opening Cash (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={openingCash}
                                        onChange={(e) => setOpeningCash(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-semibold text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-ink-muted">Opening Bank (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={openingBank}
                                        onChange={(e) => setOpeningBank(e.target.value)}
                                        className="w-full px-3.5 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-semibold text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                                        placeholder="0.00"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting || loading}
                                className="w-full py-3.5 px-5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-600 disabled:opacity-50 text-white font-extrabold text-sm uppercase tracking-wider rounded-xl transition-all shadow-md shadow-amber-500/20 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                            >
                                {isSubmitting || loading ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : (
                                    <Play size={18} fill="currentColor" />
                                )}
                                <span>Open Business Day Now</span>
                            </button>
                        </form>
                    ) : (
                        /* Staff View (Waiter / Kitchen / Bar): Waiting for Manager Notice */
                        <div className="space-y-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 sm:p-5 text-center">
                            <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs uppercase tracking-wider">
                                <AlertCircle size={16} />
                                <span>Action Required</span>
                            </div>
                            <p className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
                                You are signed in as <strong className="font-extrabold uppercase">{userRole}</strong>. A Cashier or Manager must open the business day before you can take orders or perform actions.
                            </p>

                            <button
                                onClick={handleManualRefresh}
                                disabled={isRefreshing}
                                className="w-full py-2.5 px-4 bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors flex items-center justify-center gap-2"
                            >
                                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                                <span>Check Status Again</span>
                            </button>
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between border-t border-hairline pt-4 text-xs font-semibold text-ink-subtle">
                        <span className="flex items-center gap-1">
                            <Building2 size={13} />
                            Role: <strong className="text-ink capitalize">{userRole}</strong>
                        </span>

                        <button
                            onClick={() => signOutAndRedirect(router)}
                            className="flex items-center gap-1.5 text-red-500 hover:text-red-600 transition-colors p-1 rounded-lg"
                        >
                            <LogOut size={14} />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
