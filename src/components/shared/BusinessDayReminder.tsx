'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CalendarClock, Clock, Loader2, Play, Power } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { useBusinessSession } from '@/lib/contexts/BusinessSessionContext'
import { useConfirmStore } from '@/lib/stores/confirm'

/**
 * The recurring "you still have a business day to close/open" popup.
 *
 * Two things it nags about, both of which otherwise go unnoticed until the till
 * misbehaves:
 *
 *  • A day left OPEN for an earlier date. Yesterday's session keeps every panel
 *    unlocked while today's takings post to yesterday's cash and bank books,
 *    and /api/day-book/session refuses to open today's day until it is closed —
 *    so the first person in tomorrow morning hits a wall with no explanation.
 *    Nothing on screen says this today: the header control reads "Day Active"
 *    and shows a date the staff aren't looking at.
 *
 *  • No day open at all, on a screen where BusinessGuard's lock prompt is not
 *    covering the page. Where the guard IS up, this stays silent — a permanent
 *    prompt carrying the open form is a stronger reminder than a popup.
 *
 * It only ever shows for someone who can act on it (manager / cashier /
 * super_admin); a waiter cannot close a day, so nagging them 4 times an hour
 * would be noise.
 *
 * Dismissing snoozes rather than resolves: the popup comes back after
 * REMINDER_INTERVAL_MS until the day is actually closed or opened. The snooze
 * is stored per business date, so it survives a page reload (a reminder that
 * reappears on every navigation gets clicked away reflexively) but a new day's
 * reminder is never pre-snoozed.
 */

/** How long a dismissed reminder stays quiet before it comes back. */
export const REMINDER_INTERVAL_MS = 15 * 60 * 1000

/** How often the clock is re-read to see whether a snooze has expired. */
const TICK_MS = 30 * 1000

type ReminderReason = 'close-stale-day' | 'open-day'

const snoozeKey = (reason: ReminderReason, scope: string) =>
    `kkkhane.businessDayReminder.${reason}.${scope}`

function readSnoozedUntil(key: string): number {
    try {
        const raw = window.localStorage.getItem(key)
        const value = raw ? Number(raw) : 0
        return Number.isFinite(value) ? value : 0
    } catch {
        // Private-mode / storage-disabled browsers just get an un-snoozed popup.
        return 0
    }
}

function writeSnoozedUntil(key: string, until: number) {
    try {
        window.localStorage.setItem(key, String(until))
    } catch {
        // Non-fatal: the snooze then lasts as long as this page does.
    }
}

function clearSnooze(key: string) {
    try {
        window.localStorage.removeItem(key)
    } catch {
        // Non-fatal.
    }
}

// ── The clock the reminder watches ───────────────────────────────────────────
// One shared ticking store rather than an interval and a mount effect inside
// the component: it reads 0 on the server and until the first client tick, so
// the popup can never flash during hydration, and publishClock() republishes it
// the moment a snooze is written so a dismissal takes effect immediately.
let clockNow = 0
let clockTimer: ReturnType<typeof setInterval> | null = null
const clockListeners = new Set<() => void>()

function publishClock() {
    clockNow = Date.now()
    clockListeners.forEach(notify => notify())
}

function subscribeClock(notify: () => void) {
    clockListeners.add(notify)
    if (clockTimer === null) {
        clockTimer = setInterval(publishClock, TICK_MS)
    }
    // React reads the snapshot before subscribing, so publish the first real
    // value from a microtask instead of waiting a whole tick for it.
    queueMicrotask(publishClock)

    return () => {
        clockListeners.delete(notify)
        if (clockListeners.size === 0 && clockTimer !== null) {
            clearInterval(clockTimer)
            clockTimer = null
            clockNow = 0
        }
    }
}

const readClock = () => clockNow
const readServerClock = () => 0

export default function BusinessDayReminder() {
    const {
        canManage,
        isClosed,
        todayDate,
        staleOpenSession,
        guardActive,
        openBusiness,
        closeBusiness,
        loading,
    } = useBusinessSession()
    const { confirm } = useConfirmStore()

    const now = useSyncExternalStore(subscribeClock, readClock, readServerClock)
    const [openingCash, setOpeningCash] = useState('0')
    const [openingBank, setOpeningBank] = useState('0')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // A stale day is the more urgent of the two — it is actively mis-filing
    // money — so it wins if both somehow apply.
    const reason: ReminderReason | null = !canManage
        ? null
        : staleOpenSession
            ? 'close-stale-day'
            : isClosed && !guardActive
                ? 'open-day'
                : null
    const scope = staleOpenSession?.date ?? todayDate
    const key = reason ? snoozeKey(reason, scope) : ''

    // Read on every render rather than held in state: `now` is 0 until the
    // clock's first client tick, which keeps this off the server and out of
    // hydration, and a fresh read is what makes a snooze written in another tab
    // (or before this reload) count.
    const snoozedUntil = now > 0 && key ? readSnoozedUntil(key) : Number.POSITIVE_INFINITY

    const snooze = useCallback(() => {
        if (!key) return
        writeSnoozedUntil(key, Date.now() + REMINDER_INTERVAL_MS)
        publishClock()
    }, [key])

    async function handleOpen() {
        setIsSubmitting(true)
        const ok = await openBusiness(todayDate, parseFloat(openingCash) || 0, parseFloat(openingBank) || 0)
        setIsSubmitting(false)
        if (ok) {
            clearSnooze(key)
            publishClock()
        }
    }

    async function handleCloseStale() {
        if (!staleOpenSession) return
        // Same guardrail as the header control: closing locks that date's books.
        const ok = await confirm({
            title: `Close business day ${staleOpenSession.date}?`,
            message: `This locks the cash book, bank book and sales for ${staleOpenSession.date}. You can then open today's day (${todayDate}).`,
            confirmText: 'Close That Day',
            isDestructive: true,
        })
        if (!ok) return

        setIsSubmitting(true)
        const closed = await closeBusiness(staleOpenSession.id)
        setIsSubmitting(false)
        if (closed) {
            clearSnooze(key)
            publishClock()
        }
    }

    const busy = isSubmitting || loading
    const visible = !!reason && now >= snoozedUntil

    return (
        <Modal
            open={visible}
            onClose={snooze}
            size="md"
            ariaLabel={reason === 'close-stale-day' ? 'Business day still open' : 'Business day not opened'}
        >
            {reason === 'close-stale-day' && staleOpenSession ? (
                <div className="p-6 sm:p-7 space-y-5">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 shrink-0 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                            <CalendarClock size={22} />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-base font-black text-ink tracking-tight">
                                Business day {staleOpenSession.date} is still open
                            </h2>
                            <p className="text-xs text-ink-muted font-semibold leading-relaxed">
                                Today is <strong className="text-ink">{todayDate}</strong>. Until that day is closed,
                                everything taken at the till today is being filed against{' '}
                                {staleOpenSession.date} — and today&apos;s day cannot be opened.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5">
                        <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold leading-relaxed">
                            Close {staleOpenSession.date} first, then open {todayDate} with the closing cash and bank
                            balances it carries forward.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                        <button
                            type="button"
                            onClick={handleCloseStale}
                            disabled={busy}
                            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-sm active:scale-[0.98]"
                        >
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                            Close {staleOpenSession.date}
                        </button>
                        <button
                            type="button"
                            onClick={snooze}
                            disabled={busy}
                            className="flex items-center justify-center gap-1.5 px-5 py-3 bg-surface-muted hover:bg-surface-muted/70 border border-hairline text-ink-subtle text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
                        >
                            <Clock size={14} />
                            Remind me in 15 min
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-6 sm:p-7 space-y-5">
                    <div className="flex items-start gap-3">
                        <div className="w-11 h-11 shrink-0 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                            <Play size={20} fill="currentColor" />
                        </div>
                        <div className="space-y-1">
                            <h2 className="text-base font-black text-ink tracking-tight">
                                Business day {todayDate} is not open yet
                            </h2>
                            <p className="text-xs text-ink-muted font-semibold leading-relaxed">
                                Registers, orders and bookings stay locked for every panel until the day is opened.
                                Yesterday&apos;s closing balances carry forward on their own — the amounts below only
                                adjust them.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">
                                Opening Cash (Rs.)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={openingCash}
                                onChange={e => setOpeningCash(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3.5 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">
                                Opening Bank (Rs.)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={openingBank}
                                onChange={e => setOpeningBank(e.target.value)}
                                placeholder="0.00"
                                className="w-full px-3.5 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                            />
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                        <button
                            type="button"
                            onClick={handleOpen}
                            disabled={busy}
                            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-sm active:scale-[0.98]"
                        >
                            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
                            Open Business Day
                        </button>
                        <button
                            type="button"
                            onClick={snooze}
                            disabled={busy}
                            className="flex items-center justify-center gap-1.5 px-5 py-3 bg-surface-muted hover:bg-surface-muted/70 border border-hairline text-ink-subtle text-xs font-bold uppercase tracking-wider rounded-xl transition-colors"
                        >
                            <Clock size={14} />
                            Remind me in 15 min
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    )
}
