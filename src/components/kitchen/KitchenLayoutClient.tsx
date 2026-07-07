'use client'

import { ReactNode, useEffect, useState } from 'react'
import { LogOut, ChefHat, LogIn, Loader2, PartyPopper } from 'lucide-react'
import Logo from '@/components/shared/Logo'
import SoundEnableButton from '@/components/shared/SoundEnableButton'
import PrinterSettingsButton from '@/components/shared/PrinterSettingsButton'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { setCustomNotificationSound } from '@/lib/audio'
import { useRouter } from 'next/navigation'
import CommandPaletteMount from '@/components/ui/CommandPaletteMount'
import { clockIn, clockOut, getShiftStats } from '@/app/api/staff/actions'
import { toast } from 'react-hot-toast'
import Link from 'next/link'

interface Props {
    children: ReactNode
    restaurantName?: string
    staffName?: string
    userId: string
    restaurantId: string
    onShift?: boolean
    shiftsEnabled?: boolean
    notificationSoundUrl?: string | null
}

export default function KitchenLayoutClient({ children, staffName, userId, restaurantId, onShift = false, shiftsEnabled = false, notificationSoundUrl }: Props) {
    const router = useRouter()
    const [shift, setShift] = useState(onShift)
    const [busy, setBusy] = useState(false)
    const [meals, setMeals] = useState<number | null>(null) // non-null → show congrats

    useEffect(() => { setCustomNotificationSound(notificationSoundUrl || null) }, [notificationSoundUrl])

    const signOut = () => signOutAndRedirect(router)

    const handleClockIn = async () => {
        setBusy(true)
        const res = await clockIn(userId, restaurantId)
        setBusy(false)
        if (res.error) { toast.error(res.error); return }
        setShift(true)
        toast.success('Clocked in — have a great shift!')
    }

    // End of shift: clock out, tally the dishes cooked, then show the send-off.
    const handleEndShift = async () => {
        setBusy(true)
        const res = await clockOut(userId)
        if (res.error || !res.shift) {
            setBusy(false)
            // No active shift to close — just sign out.
            await signOut()
            return
        }
        const stats = await getShiftStats(userId, res.shift.clock_in, res.shift.clock_out)
        setBusy(false)
        setMeals(stats.mealsCooked)
    }

    const onLogout = () => {
        if (shiftsEnabled && shift) handleEndShift()
        else signOut()
    }

    return (
        <div className="min-h-screen flex flex-col bg-[#FBF7F3] text-ink print:bg-surface">
            <header className="shrink-0 bg-surface border-b border-hairline px-4 h-16 flex items-center justify-between gap-3 print:hidden">
                <div className="flex items-center gap-2.5 min-w-0">
                    <Logo className="h-7 shrink-0" />
                    <div className="min-w-0">
                        <Link 
                            href="/kitchen/profile" 
                            className="flex items-center gap-2 hover:bg-surface-muted p-1 rounded-md transition-colors cursor-pointer group"
                        >
                            <span className="font-extrabold text-ink leading-none truncate max-w-30 group-hover:text-brand-500 transition-colors">{staffName || 'Staff'}</span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-500 bg-[#FFEAD9] px-2 py-0.5 rounded-full group-hover:bg-brand-500 group-hover:text-white transition-colors">
                                <ChefHat size={11} /> Kitchen
                            </span>
                        </Link>
                        {shiftsEnabled && (
                            <div className="flex items-center gap-1.5 mt-1 ml-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${shift ? 'bg-emerald-500' : 'bg-border'}`} />
                                <span className={`text-[11px] font-semibold ${shift ? 'text-emerald-600' : 'text-ink-subtle'}`}>
                                    {shift ? 'On Shift' : 'Off Shift'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    <PrinterSettingsButton role="kot" />
                    <SoundEnableButton />
                    {shiftsEnabled && !shift && (
                        <button
                            onClick={handleClockIn}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-2 rounded-full disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />} Clock In
                        </button>
                    )}
                    <button
                        onClick={onLogout}
                        disabled={busy}
                        className="w-10 h-10 rounded-full bg-surface-muted hover:bg-surface-muted text-ink-subtle hover:text-ink-muted flex items-center justify-center transition-colors disabled:opacity-50"
                        aria-label="Sign out"
                    >
                        {busy ? <Loader2 size={18} className="animate-spin" /> : <LogOut size={18} />}
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-hidden">
                {children}
            </main>
            <CommandPaletteMount role="kitchen" theme="light" />

            {/* End-of-shift send-off */}
            {meals !== null && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden text-center p-7">
                        <PartyPopper size={44} className="mx-auto text-brand-500 mb-2" />
                        <h3 className="text-2xl font-black text-ink">Amazing Work!</h3>
                        <p className="text-ink-subtle text-sm mt-1">Thank you, <span className="font-bold text-ink">{staffName || 'chef'}</span></p>

                        <div className="my-5 rounded-2xl bg-[#FFF4EC] py-6 px-4">
                            <p className="text-ink-subtle text-sm">Today you completed</p>
                            <p className="text-6xl font-black text-brand-500 leading-none my-1.5">{meals}</p>
                            <p className="font-extrabold text-ink">meal{meals === 1 ? '' : 's'} cooked successfully!</p>
                        </div>

                        <p className="text-brand-500 font-bold text-sm mb-5">Congratulations! See you next shift! 👋</p>
                        <button onClick={signOut} className="w-full bg-brand-500 text-white font-black rounded-2xl py-3.5 text-sm hover:opacity-90 active:scale-[0.99] transition">
                            Done &amp; Sign Out
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
