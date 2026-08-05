'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Sparkles, AlertTriangle, X, ArrowRight } from 'lucide-react'
import type { TrialState } from '@/lib/trial'

const DISMISS_KEY = 'kkkhane:trial-banner-dismissed'

/** Local calendar day, so a dismissal lasts until tomorrow rather than forever. */
function todayKey(): string {
    return new Date().toISOString().slice(0, 10)
}

// A tiny store over localStorage so the banner can read it during render
// instead of in an effect. Reading browser-only state with useSyncExternalStore
// is what keeps the server and client renders from disagreeing: the server
// snapshot is always "not dismissed", and React swaps in the real value after
// hydration. Doing this with useState + useEffect would either mismatch or need
// a setState inside an effect, which cascades an extra render.
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
}

function getSnapshot(): boolean {
    try {
        return window.localStorage.getItem(DISMISS_KEY) === todayKey()
    } catch {
        // Private mode or storage disabled — treat as not dismissed.
        return false
    }
}

function getServerSnapshot(): boolean {
    return false
}

function dismissForToday() {
    try {
        window.localStorage.setItem(DISMISS_KEY, todayKey())
    } catch {
        // Nothing to do — it reappears on the next load, which is harmless.
    }
    listeners.forEach(l => l())
}

/**
 * Tells a manager where their 14-day trial stands.
 *
 * Without this a tenant on trial has no way to know they are on one: the plan
 * simply stops covering things on day 15 and the app starts refusing features
 * it allowed the day before, with nothing having said it would.
 *
 * Three states, escalating (see trialState() for how they are decided):
 *   - plenty of time left  — quiet, and dismissible for the day
 *   - the last few days    — urgent, and NOT dismissible
 *   - already ended        — urgent, not dismissible, for 30 days afterwards
 *
 * `endsAtLabel` is formatted on the server on purpose. Formatting a date in the
 * browser would render one string on the server and another in the client
 * whenever the two disagree about locale or timezone, which is a hydration
 * mismatch — and this app runs on Nepal time, 5:45 off UTC, so they would
 * disagree constantly.
 */
export default function TrialBanner({
    state,
    endsAtLabel,
}: {
    state: TrialState
    endsAtLabel: string
}) {
    const dismissedToday = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

    if (state.kind === 'none') return null

    const ended = state.kind === 'ended'
    const urgent = ended || state.urgent

    // Only the calm banner can be dismissed. Once the trial is nearly up — or
    // already gone — the message is the one thing the manager most needs to
    // see, so it stays put.
    const dismissible = !urgent
    if (dismissible && dismissedToday) return null

    return (
        <div
            role={urgent ? 'alert' : 'status'}
            className={`print:hidden mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 ${
                urgent
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-brand-200 bg-brand-50 text-brand-900'
            }`}
        >
            {urgent
                ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
                : <Sparkles className="w-4 h-4 shrink-0" aria-hidden />}

            <p className="text-[13px] font-medium min-w-0 flex-1">
                {state.kind === 'ended' ? (
                    <>
                        Your free trial ended on {endsAtLabel}. You&apos;re on the{' '}
                        <span className="font-semibold">Free</span> plan now — some features
                        you were using are no longer available.
                    </>
                ) : (
                    <>
                        <span className="font-semibold">
                            {state.daysRemaining === 1 ? '1 day left' : `${state.daysRemaining} days left`}
                        </span>{' '}
                        on your free trial — full access until {endsAtLabel}. After that
                        you&apos;ll move to the Free plan.
                    </>
                )}
            </p>

            <Link
                href="/admin/billing/packages"
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition shrink-0 ${
                    urgent
                        ? 'bg-amber-900 text-white hover:bg-amber-800'
                        : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
            >
                {ended ? 'Choose a plan' : 'View plans'}
                <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>

            {dismissible && (
                <button
                    type="button"
                    onClick={dismissForToday}
                    aria-label="Dismiss until tomorrow"
                    className="shrink-0 rounded-md p-1 text-brand-700 hover:bg-brand-100 transition"
                >
                    <X className="w-4 h-4" aria-hidden />
                </button>
            )}
        </div>
    )
}
