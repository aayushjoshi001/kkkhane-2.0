'use client'

import { ReactNode, useState, useEffect } from 'react'
import { LogOut, LogIn, Loader2 } from 'lucide-react'
import Logo from '@/components/shared/Logo'
import SoundEnableButton from '@/components/shared/SoundEnableButton'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { setCustomNotificationSound } from '@/lib/audio'
import { useRouter } from 'next/navigation'
import { CommandHint } from '@/components/ui/CommandHint'
import CommandPaletteMount from '@/components/ui/CommandPaletteMount'
import { clockIn, clockOut } from '@/app/api/staff/actions'
import { toast } from 'react-hot-toast'

interface Props {
    children: ReactNode
    restaurantName?: string
    staffName?: string
    userId?: string
    restaurantId?: string
    onShift?: boolean
    shiftsEnabled?: boolean
    notificationSoundUrl?: string | null
    portalLabel?: string
    /** Role used to scope the command palette's navigation list. */
    commandRole?: string
}

export default function WaiterLayoutClient({
    children,
    restaurantName,
    staffName,
    userId,
    restaurantId,
    onShift = false,
    shiftsEnabled = false,
    notificationSoundUrl,
    portalLabel = 'Waiter',
    commandRole = 'waiter'
}: Props) {
    const router = useRouter()
    const [time, setTime] = useState('')
    const [shift, setShift] = useState(onShift)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setCustomNotificationSound(notificationSoundUrl || null)
    }, [notificationSoundUrl])

    useEffect(() => {
        const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }))
        tick()
        const id = setInterval(tick, 10_000)
        return () => clearInterval(id)
    }, [])

    const handleSignOut = () => signOutAndRedirect(router)

    const handleClockIn = async () => {
        if (!userId || !restaurantId) return
        setBusy(true)
        const res = await clockIn(userId, restaurantId)
        setBusy(false)
        if (res.error) {
            toast.error(res.error)
            return
        }
        setShift(true)
        toast.success('Clocked in — have a great shift!')
        router.refresh()
    }

    const handleClockOut = async () => {
        if (!userId) return
        setBusy(true)
        const res = await clockOut(userId)
        setBusy(false)
        if (res.error) {
            toast.error(res.error)
            return
        }
        setShift(false)
        toast.success('Clocked out successfully!')
        router.refresh()
    }

    return (
        <div className="min-h-screen bg-canvas flex flex-col">
            <header className="bg-surface border-b border-hairline sticky top-0 z-30 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
                    {/* Left */}
                    <div className="flex items-center gap-3 min-w-0">
                        <Logo className="h-7 shrink-0" />
                        {restaurantName && (
                            <div className="hidden sm:block">
                                <p className="text-xs font-bold text-gray-800 leading-none truncate max-w-[160px]">{restaurantName}</p>
                                <p className="text-[10px] text-gray-400 font-medium tracking-widest uppercase mt-0.5">{portalLabel}</p>
                            </div>
                        )}
                    </div>

                    {/* Center — clock */}
                    <div className="absolute left-1/2 -translate-x-1/2">
                        <span className="font-mono text-sm font-bold text-gray-700 tabular-nums tracking-wider">
                            {time}
                        </span>
                    </div>

                    {/* Right */}
                    <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0">
                        <CommandHint />
                        <SoundEnableButton variant="light" />
                        {staffName && (
                            <div className="hidden md:flex items-center gap-2">
                                <div className="h-4 w-px bg-gray-200" />
                                <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] text-xs font-bold">
                                    {staffName[0].toUpperCase()}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-semibold text-gray-700 max-w-28 truncate leading-none">{staffName}</span>
                                    {shiftsEnabled && (
                                        <span className={`text-[10px] font-bold ${shift ? 'text-emerald-600' : 'text-gray-400'} mt-0.5 leading-none`}>
                                            {shift ? 'On Shift' : 'Off Shift'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="h-4 w-px bg-gray-200 hidden md:block" />
                        {shiftsEnabled && userId && (
                            <>
                                {shift ? (
                                    <button
                                        onClick={handleClockOut}
                                        disabled={busy}
                                        className="flex items-center gap-1 text-[11px] font-bold text-red-600 border border-red-200 hover:bg-red-50 transition px-2.5 py-1.5 rounded-lg active:scale-95 disabled:opacity-50"
                                    >
                                        {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                                        Clock Out
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleClockIn}
                                        disabled={busy}
                                        className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 border border-emerald-200 hover:bg-emerald-50 transition px-2.5 py-1.5 rounded-lg active:scale-95 disabled:opacity-50"
                                    >
                                        {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
                                        Clock In
                                    </button>
                                )}
                                <div className="h-4 w-px bg-gray-200 hidden md:block" />
                            </>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-red-600 transition px-2.5 py-2 rounded-lg hover:bg-red-50 active:scale-95"
                        >
                            <LogOut size={15} />
                            <span className="hidden md:inline">Sign Out</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto p-3 md:p-6">
                {children}
            </main>
            <CommandPaletteMount role={commandRole} theme="light" />
        </div>
    )
}
