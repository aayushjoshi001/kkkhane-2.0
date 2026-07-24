'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
    CALENDAR_COOKIE,
    DEFAULT_CALENDAR,
    formatDate as fmtDate,
    formatDateLong as fmtDateLong,
    formatDateShort as fmtDateShort,
    formatDateTime as fmtDateTime,
    type Calendar,
} from '@/lib/calendar'

interface CalendarContextValue {
    calendar: Calendar
    setCalendar: (next: Calendar) => void
    toggle: () => void
}

const CalendarContext = createContext<CalendarContextValue>({
    calendar: DEFAULT_CALENDAR,
    setCalendar: () => {},
    toggle: () => {},
})

/** A year is plenty — the preference is a convenience, not a credential. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Holds each user's choice of leading calendar.
 *
 * The value is kept in a cookie rather than localStorage because dates are
 * rendered on both sides: the dashboard, reports and several ledger pages are
 * server components. A client-only preference would leave those stuck on the
 * default and hydrate to different text than the server sent. The cookie is
 * read during the server render and handed in as `initial`, so the first paint
 * is already correct.
 *
 * Changing it writes the cookie and calls router.refresh(), so server-rendered
 * dates re-render in the new calendar without a full page load.
 */
export function CalendarProvider({
    initial,
    children,
}: {
    initial: Calendar
    children: ReactNode
}) {
    const router = useRouter()

    const setCalendar = useCallback(
        (next: Calendar) => {
            document.cookie = `${CALENDAR_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
            router.refresh()
        },
        [router],
    )

    const value = useMemo<CalendarContextValue>(
        () => ({
            calendar: initial,
            setCalendar,
            toggle: () => setCalendar(initial === 'bs' ? 'ad' : 'bs'),
        }),
        [initial, setCalendar],
    )

    return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>
}

export function useCalendar(): CalendarContextValue {
    return useContext(CalendarContext)
}

/**
 * Date formatters bound to the current calendar.
 *
 *   const { formatDate } = useDates()
 *   <span>{formatDate(entry.created_at)}</span>
 */
export function useDates() {
    const { calendar } = useCalendar()
    return useMemo(
        () => ({
            calendar,
            formatDate: (value: string | Date | null | undefined) => fmtDate(value, calendar),
            formatDateTime: (value: string | Date | null | undefined) => fmtDateTime(value, calendar),
            formatDateShort: (value: string | Date | null | undefined) => fmtDateShort(value, calendar),
            formatDateLong: (value: string | Date | null | undefined) => fmtDateLong(value, calendar),
        }),
        [calendar],
    )
}
