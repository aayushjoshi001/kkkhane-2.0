'use client'

import { ReactNode, useState, useEffect } from 'react'
import { LogOut, LogIn, Loader2 } from 'lucide-react'
import Logo from '@/components/shared/Logo'
import SoundEnableButton from '@/components/shared/SoundEnableButton'
import CalendarToggle from '@/components/shared/CalendarToggle'
import PrinterSettingsButton from '@/components/shared/PrinterSettingsButton'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { setCustomNotificationSound } from '@/lib/audio'
import { useRouter } from 'next/navigation'
import { CommandHint } from '@/components/ui/CommandHint'
import CommandPaletteMount from '@/components/ui/CommandPaletteMount'
import { clockIn, clockOut } from '@/app/api/staff/actions'
import { toast } from 'react-hot-toast'
import Link from 'next/link'

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
            <header className="bg-canvas border-b border-hairline sticky top-0 z-30 shadow-sm relative overflow-hidden">
                {/* Orange top accent strip — matches AdminSidebar and PremiumPageHeader design language */}
                <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-brand-500/80 to-transparent pointer-events-none" />
                {/* Three columns rather than a flex row with an absolutely
                    positioned middle. The clock used to be `absolute left-1/2`,
                    which takes it out of flow entirely, so the layout had no way
                    to know it was there: as soon as the right-hand group grew
                    past the centre line — and it does, once the command hint,
                    printer, calendar toggle, sound button and staff card are all
                    in it — the two drew over each other and the time sat on top
                    of the search. The outer columns are minmax(0,1fr) so they
                    can shrink below their content instead of pushing the bar
                    wider than the screen. */}
                <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
                    {/* Left */}
                    <div className="flex items-center gap-3 min-w-0">
                        <Logo className="h-7 shrink-0" />
                        {restaurantName && (
                            <div className="hidden sm:block">
                                <p className="text-xs font-bold text-ink leading-none truncate max-w-[160px]">{restaurantName}</p>
                                <p className="text-[10px] text-ink-subtle font-medium tracking-widest uppercase mt-0.5">{portalLabel}</p>
                            </div>
                        )}
                    </div>

                    {/* Center — clock. Hidden on the narrowest screens for the
                        same reason the restaurant name is: on a phone the right
                        group needs the room more than the time does, and the
                        till shows a clock of its own. */}
                    <div className="hidden sm:block justify-self-center">
                        <span className="font-mono text-sm font-bold text-ink-muted tabular-nums tracking-wider">
                            {time}
                        </span>
                    </div>

                    {/* Right */}
                    <div className="flex items-center justify-end gap-1.5 md:gap-2.5">
                        <CommandHint />
                        {commandRole === 'cashier' && <PrinterSettingsButton role="invoice" variant="light" />}
                        {/* Not `hidden sm:*`: the cashier works the desk on a phone
                            as often as a monitor, and hiding this was hiding the only
                            way to switch the check-in/check-out pickers between BS and
                            AD — the toggle read as broken because it wasn't on screen. */}
                        <CalendarToggle />
                        <SoundEnableButton variant="light" />
                        {staffName && (
                            <div className="hidden md:flex items-center gap-2">
                                <div className="h-4 w-px bg-surface-muted" />
                                <Link 
                                    href={`/${commandRole}/profile`} 
                                    className="flex items-center gap-2 hover:bg-surface-muted p-1.5 rounded-lg transition-colors cursor-pointer group"
                                >
                                    <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] text-xs font-bold group-hover:bg-[var(--color-primary)]/20 transition-colors">
                                        {staffName[0].toUpperCase()}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-semibold text-ink-muted max-w-28 truncate leading-none group-hover:text-[var(--color-primary)] transition-colors">{staffName}</span>
                                        {shiftsEnabled && (
                                            <span className={`text-[10px] font-bold ${shift ? 'text-emerald-600' : 'text-ink-subtle'} mt-0.5 leading-none`}>
                                                {shift ? 'On Shift' : 'Off Shift'}
                                            </span>
                                        )}
                                    </div>
                                </Link>
                            </div>
                        )}
                        <div className="h-4 w-px bg-surface-muted hidden md:block" />
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
                                <div className="h-4 w-px bg-surface-muted hidden md:block" />
                            </>
                        )}
                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-red-600 transition px-2.5 py-2 rounded-lg hover:bg-red-50 active:scale-95"
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
