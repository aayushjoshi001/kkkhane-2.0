'use client'

import { useState } from 'react'
import { Play, Power, AlertCircle, Calendar, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'

interface BusinessSessionControlProps {
    initialSession: {
        id: string
        date: string
        status: 'open' | 'closed'
        opening_balance: number
        opening_bank_balance: number
    } | null
    userRole: string
    todayDate: string
}

export default function BusinessSessionControl({
    initialSession,
    userRole,
    todayDate,
}: BusinessSessionControlProps) {
    const router = useRouter()
    const { confirm } = useConfirmStore()
    const [session, setSession] = useState(initialSession)
    const [loading, setLoading] = useState(false)

    const isClosed = !session || session.status === 'closed'
    const canManage = ['manager', 'super_admin', 'cashier'].includes(userRole)

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

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: todayDate }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            setSession(data.data)
            toast.success('Business day opened successfully! Cash book and bank books are now active.')
            router.refresh()
        } catch (e: any) {
            toast.error(e.message || 'Failed to open business day')
        } finally {
            setLoading(false)
        }
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

        setLoading(true)
        try {
            const res = await fetch('/api/day-book/session', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session.id }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            setSession(data.data)
            toast.success('Business day closed successfully. All books are locked.')
            router.refresh()
        } catch (e: any) {
            toast.error(e.message || 'Failed to close business day')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="w-full animate-fade-in print:hidden">
            {isClosed ? (
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
            ) : (
                <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-start gap-3">
                        <Calendar className="text-emerald-600 shrink-0 w-5.5 h-5.5 mt-0.5" />
                        <div className="space-y-1">
                            <h4 className="font-extrabold text-sm text-emerald-950 uppercase tracking-wide flex items-center gap-1.5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                </span>
                                Business Day is Active
                            </h4>
                            <p className="text-xs text-emerald-700 font-semibold leading-relaxed">
                                Active Business Date: <strong className="text-emerald-900">{session.date}</strong>. Cash books and bank books are open and ready for transactions.
                            </p>
                        </div>
                    </div>
                    {canManage && (
                        <button
                            onClick={handleCloseBusiness}
                            disabled={loading}
                            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-rose-600 hover:text-white disabled:opacity-50 text-emerald-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all border border-emerald-500/20 shadow-sm active:scale-95 shrink-0"
                        >
                            {loading ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Power size={14} />
                            )}
                            Close Business Day
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
