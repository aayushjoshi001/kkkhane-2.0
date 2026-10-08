'use client'

import { Play, AlertCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import { useBusinessSession } from '@/lib/contexts/BusinessSessionContext'

interface BusinessSessionControlProps {
    initialSession?: {
        id: string
        date: string
        status: 'open' | 'closed'
        opening_balance: number
        opening_bank_balance: number
    } | null
    userRole?: string
    todayDate?: string
    variant?: 'banner' | 'compact' | 'mini'
}

export default function BusinessSessionControl({
    variant = 'banner',
}: BusinessSessionControlProps) {
    const { confirm } = useConfirmStore()
    const { session, isClosed, canManage, todayDate, openBusiness, closeBusiness, loading } = useBusinessSession()

    async function handleOpenBusiness() {
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can open the business day')
            return
        }

        const ok = await confirm({
            title: 'Open Business Day?',
            message: `Start transactions for business date: ${todayDate}. Yesterday's closing balances will carry forward automatically.`,
            confirmText: 'Open Business',
            isDestructive: false,
        })
        if (!ok) return

        await openBusiness(todayDate)
    }

    async function handleCloseBusiness() {
        if (!session) return
        if (!canManage) {
            toast.error('Only managers, cashiers, and admins can close the business day')
            return
        }

        const ok = await confirm({
            title: 'Close Business Day?',
            message: `This will lock all cash books, bank books, and sales for date: ${session.date}. No further transactions can be added today.`,
            confirmText: 'Close Business',
            isDestructive: true,
        })
        if (!ok) return

        await closeBusiness()
    }

    if (variant === 'compact') {
        return (
            <div className="inline-flex items-center print:hidden">
                {isClosed ? (
                    <button
                        onClick={handleOpenBusiness}
                        disabled={loading}
                        className="flex items-center gap-2 text-sm font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-4 py-2.5 rounded-xl transition-colors shadow-sm active:scale-95 shrink-0"
                        title="Business Day is Closed — Click to Open"
                    >
                        {loading ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : (
                            <Play size={15} fill="currentColor" className="text-amber-600" />
                        )}
                        <span>Open Business Day</span>
                    </button>
                ) : (
                    <button
                        onClick={handleCloseBusiness}
                        disabled={loading}
                        className="flex items-center gap-2 text-sm font-bold text-emerald-900 bg-emerald-100 hover:bg-rose-100 hover:text-rose-900 border border-emerald-300 hover:border-rose-300 px-4 py-2.5 rounded-xl transition-colors shadow-sm active:scale-95 shrink-0"
                        title={`Business Day Active (${session?.date ?? todayDate}) — Click to Close`}
                    >
                        {loading ? (
                            <Loader2 size={15} className="animate-spin" />
                        ) : (
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>
                        )}
                        <span>Day Active ({session?.date ?? todayDate})</span>
                    </button>
                )}
            </div>
        )
    }

    if (variant === 'mini') {
        return (
            <div className="inline-flex items-center print:hidden shrink-0">
                {isClosed ? (
                    <button
                        onClick={handleOpenBusiness}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 h-6 rounded-md transition-colors active:scale-95 shrink-0"
                        title="Business Day Closed — Click to Open"
                    >
                        {loading ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} fill="currentColor" className="text-amber-500" />}
                        <span>Open</span>
                    </button>
                ) : (
                    <button
                        onClick={handleCloseBusiness}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-rose-50 hover:text-rose-700 border border-emerald-200 hover:border-rose-200 px-2 h-6 rounded-md transition-colors active:scale-95 shrink-0"
                        title={`Day Active (${session?.date ?? todayDate}) — Click to Close`}
                    >
                        {loading ? <Loader2 size={10} className="animate-spin" /> : (
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                            </span>
                        )}
                        <span>Active</span>
                    </button>
                )}
            </div>
        )
    }

    // Active-day state already shows in the top bar's compact pill, so the
    // banner only needs to surface here when it demands action: opening a closed day.
    if (!isClosed) return null

    return (
        <div className="w-full animate-fade-in print:hidden">
            <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3">
                    <AlertCircle className="text-amber-600 shrink-0 w-5.5 h-5.5 mt-0.5" />
                    <div className="space-y-1">
                        <h4 className="font-extrabold text-sm text-amber-900 uppercase tracking-wide">Business Day is Closed</h4>
                        <p className="text-xs text-amber-700 font-semibold leading-relaxed max-w-2xl">
                            Today&apos;s registers and books are locked. You must open the business day to enable cashier checkout, orders, bookings, and manual entry logs.
                        </p>
                    </div>
                </div>
                {canManage && (
                    <button
                        onClick={handleOpenBusiness}
                        disabled={loading}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-sm active:scale-95 shrink-0"
                    >
                        {loading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Play size={14} fill="currentColor" />
                        )}
                        Open Business Day
                    </button>
                )}
            </div>
        </div>
    )
}
