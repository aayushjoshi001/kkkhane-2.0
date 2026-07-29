'use client'

import { formatDateParts, formatTime } from '@/lib/calendar'
import { useCalendar } from '@/lib/contexts/CalendarContext'
import { cn } from '@/lib/utils'

/**
 * A date in a table cell: the chosen calendar on top, the other beneath it in
 * smaller muted type.
 *
 * Showing both calendars inline — "Shrawan 08, 2083 (Jul 24, 2026)" — is about
 * twice the width of the AD date it replaced. In the nowrap cells these tables
 * use, that widened the whole table enough to force horizontal scrolling on the
 * orders, bookings and shifts lists. Stacking keeps both readings at roughly the
 * original column width, and the row height was already two lines in most of
 * these tables anyway.
 *
 * Set `time` to append the clock reading to the primary line; it is identical in
 * either calendar, so it never belongs on the secondary one.
 */
export default function DateCell({
    value,
    time = false,
    withYear = true,
    className,
}: {
    value: string | Date | null | undefined
    time?: boolean
    withYear?: boolean
    className?: string
}) {
    const { calendar } = useCalendar()
    const { primary, secondary } = formatDateParts(value, calendar, { withYear })

    return (
        <span className={cn('inline-block leading-tight', className)}>
            <span className="block tabular-nums whitespace-nowrap">
                {primary}
                {time && <span className="ml-1.5 opacity-70">{formatTime(value)}</span>}
            </span>
            {secondary && (
                <span className="block text-[11px] text-ink-subtle tabular-nums whitespace-nowrap mt-0.5">
                    {secondary}
                </span>
            )}
        </span>
    )
}
