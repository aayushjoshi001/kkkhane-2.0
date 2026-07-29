'use client'

import { useState } from 'react'
import { BedDouble, Phone, Loader2, ArrowRight } from 'lucide-react'
import { verifyRoomGuest } from './roomGuestActions'

/**
 * Phone gate shown when a checked-in room's QR is scanned. The guest confirms
 * the phone on their booking to unlock in-room ordering. A "Call for Service"
 * button is always available so a guest whose number isn't on file can still
 * reach reception.
 */
export default function RoomGuestVerify({
    tableId,
    roomNumber,
    restaurantName,
    receptionPhone,
}: {
    tableId: string
    roomNumber: string
    restaurantName?: string
    receptionPhone?: string | null
}) {
    const [phone, setPhone] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)
        setPending(true)
        const res = await verifyRoomGuest(tableId, phone)
        if ('error' in res) {
            setError(res.error)
            setPending(false)
            return
        }
        // Cookie is set. Reload the whole page rather than router.refresh(): a
        // soft refresh re-renders from the client Router Cache and intermittently
        // misses the just-set httpOnly cookie, so the server still reads
        // "unverified" and the gate reappears — forcing the guest to enter their
        // number a second time. A full navigation sends the cookie on a fresh
        // request, so the menu unlocks on the first try. We intentionally leave
        // `pending` true here — the reload replaces the component.
        window.location.reload()
    }

    return (
        <main className="min-h-dvh flex items-center justify-center bg-surface-muted px-6 py-16">
            <div className="w-full max-w-md flex flex-col items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-brand-100 text-brand-600 grid place-items-center">
                    <BedDouble size={28} />
                </div>

                <div className="flex flex-col gap-2 text-center">
                    <h1 className="text-2xl font-extrabold text-ink tracking-tight">
                        Welcome to Room {roomNumber}
                    </h1>
                    <p className="text-[15px] text-ink-subtle font-medium leading-relaxed">
                        Confirm the mobile number on your booking to start ordering to your room.
                    </p>
                </div>

                <form onSubmit={submit} className="w-full flex flex-col gap-3">
                    <div className="relative">
                        <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
                        <input
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="Mobile number on your booking"
                            className="h-14 w-full rounded-2xl border border-hairline bg-surface pl-12 pr-4 text-[15px] font-semibold text-ink placeholder:text-ink-muted outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all tabular-nums"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-danger-fg font-medium text-center px-2">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={pending || !phone.trim()}
                        className="h-14 w-full rounded-2xl bg-brand-500 text-white text-base font-extrabold shadow-[0_8px_24px_rgba(251,99,3,0.3)] hover:bg-brand-400 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:pointer-events-none"
                    >
                        {pending ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <>
                                Continue <ArrowRight size={20} />
                            </>
                        )}
                    </button>
                </form>

                {restaurantName && (
                    <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mt-1">
                        {restaurantName}
                    </p>
                )}
            </div>
        </main>
    )
}
