'use client'

import { ReactNode, useState, useEffect, useRef } from 'react'
import { LogOut, LogIn, Loader2, Menu, X } from 'lucide-react'
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
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setCustomNotificationSound(notificationSoundUrl || null)
    }, [notificationSoundUrl])

    useEffect(() => {
        const tick = () => setTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }))
        tick()
        const id = setInterval(tick, 10_000)
        return () => clearInterval(id)
    }, [])

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
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
            <header className="bg-canvas border-b border-hairline sticky top-0 z-30 shadow-sm relative">
                {/* Orange top accent strip */}
                <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-brand-500/80 to-transparent pointer-events-none" />
                <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
                    {/* Logo + restaurant name */}
                    <div className="flex items-center gap-3 min-w-0">
                        <Link href={`/${commandRole}`}>
                            <Logo className="h-7 shrink-0" />
                        </Link>
                        {restaurantName && (
                            <div className="hidden sm:block">
                                <p className="text-xs font-bold text-ink leading-none truncate max-w-[160px]">{restaurantName}</p>
                                <p className="text-[10px] text-ink-subtle font-medium tracking-widest uppercase mt-0.5">{portalLabel}</p>
                            </div>
                        )}
                    </div>

                    {/* Center clock — hidden on mobile */}
                    <div className="hidden sm:block">
                        <span className="font-mono text-sm font-bold text-ink-muted tabular-nums tracking-wider">
                            {time}
                        </span>
                    </div>

                    {/* Desktop right actions — hidden on mobile */}
                    <div className="hidden sm:flex items-center justify-end gap-1.5 md:gap-2.5">
                        <CommandHint />
                        {commandRole === 'cashier' && <PrinterSettingsButton role="invoice" variant="light" />}
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

                    {/* Mobile hamburger */}
                    <div className="sm:hidden flex items-center gap-2 relative" ref={menuRef}>
                        {staffName && (
                            <Link
                                href={`/${commandRole}/profile`}
                                className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] text-xs font-bold shrink-0"
                            >
                                {staffName[0].toUpperCase()}
                            </Link>
                        )}
                        <button
                            onClick={() => setMenuOpen(o => !o)}
                            className="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-surface-muted transition-colors text-ink-muted"
                            aria-label="Open menu"
                        >
                            {menuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>

                        {menuOpen && (
                            <div className="absolute right-0 top-12 w-64 bg-canvas border border-hairline rounded-2xl shadow-lg overflow-hidden z-50 p-2 flex flex-col gap-1">
                                {/* Clock */}
                                <div className="px-3 py-2 text-xs font-mono font-bold text-ink-muted tabular-nums tracking-wider">
                                    {time}
                                </div>
                                <div className="h-px bg-hairline mx-2" />

                                {/* Restaurant info */}
                                {restaurantName && (
                                    <>
                                        <div className="px-3 py-2">
                                            <p className="text-xs font-bold text-ink leading-none">{restaurantName}</p>
                                            <p className="text-[10px] text-ink-subtle font-medium tracking-widest uppercase mt-0.5">{portalLabel}</p>
                                        </div>
                                        <div className="h-px bg-hairline mx-2" />
                                    </>
                                )}

                                {/* Staff profile */}
                                {staffName && (
                                    <Link
                                        href={`/${commandRole}/profile`}
                                        onClick={() => setMenuOpen(false)}
                                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-muted transition-colors"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] text-xs font-bold shrink-0">
                                            {staffName[0].toUpperCase()}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-xs font-semibold text-ink truncate">{staffName}</span>
                                            {shiftsEnabled && (
                                                <span className={`text-[10px] font-bold ${shift ? 'text-emerald-600' : 'text-ink-subtle'}`}>
                                                    {shift ? 'On Shift' : 'Off Shift'}
                                                </span>
                                            )}
                                        </div>
                                    </Link>
                                )}

                                {/* Utility buttons */}
                                <div className="flex items-center gap-1 px-2 py-1">
                                    <CommandHint />
                                    {commandRole === 'cashier' && <PrinterSettingsButton role="invoice" variant="light" />}
                                    <CalendarToggle />
                                    <SoundEnableButton variant="light" />
                                </div>

                                <div className="h-px bg-hairline mx-2" />

                                {/* Clock in/out */}
                                {shiftsEnabled && userId && (
                                    shift ? (
                                        <button
                                            onClick={() => { handleClockOut(); setMenuOpen(false) }}
                                            disabled={busy}
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                                            Clock Out
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => { handleClockIn(); setMenuOpen(false) }}
                                            disabled={busy}
                                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
                                            Clock In
                                        </button>
                                    )
                                )}

                                {/* Sign out */}
                                <button
                                    onClick={() => { handleSignOut(); setMenuOpen(false) }}
                                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-ink-subtle hover:text-red-600 hover:bg-red-50 transition"
                                >
                                    <LogOut size={14} />
                                    Sign Out
                                </button>
                            </div>
                        )}
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
