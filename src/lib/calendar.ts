import { toNepaliDate } from './nepaliDate'
import { NEPAL_TZ } from './utils'

/**
 * Which calendar leads when a date is displayed.
 *
 * Both are always shown — the secondary one in brackets — so nothing is ever
 * lost. `bs` puts Bikram Sambat first (the default, this being a Nepali
 * product); `ad` puts Gregorian first, for reconciling against a bank
 * statement, a card processor, or anything else that has never heard of Asar.
 */
export type Calendar = 'bs' | 'ad'

export const CALENDAR_COOKIE = 'kkkhane-calendar'
export const DEFAULT_CALENDAR: Calendar = 'bs'

/** Narrow an untrusted cookie/query value to a Calendar, falling back to the default. */
export function parseCalendar(value: string | undefined | null): Calendar {
    return value === 'ad' || value === 'bs' ? value : DEFAULT_CALENDAR
}

/**
 * The Kathmandu wall-clock Y/M/D for an instant, as a Date whose *local*
 * components carry those values.
 *
 * `new NepaliDate(d)` reads the JS Date's local components, so converting a raw
 * instant in a browser outside Nepal picks the wrong calendar day either side of
 * midnight. Re-basing on the Kathmandu date first makes the conversion agree
 * everywhere — the same reason every formatter in lib/utils pins NEPAL_TZ.
 */
function nepalCalendarDate(date: Date): Date {
    // en-CA gives ISO-ordered parts, so this needs no reparsing of month names.
    const [y, m, d] = date
        .toLocaleDateString('en-CA', { timeZone: NEPAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .split('-')
        .map(Number)
    return new Date(y, m - 1, d)
}

function toDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null
    const date = typeof value === 'string' ? new Date(value) : value
    return Number.isNaN(date.getTime()) ? null : date
}

/** Bikram Sambat rendering, e.g. `Asar 26, 2083`. */
function bsPart(date: Date, opts: { withYear?: boolean } = {}): string | null {
    try {
        return toNepaliDate(nepalCalendarDate(date), opts.withYear === false ? 'MMMM DD' : 'MMMM DD, YYYY', 'en')
    } catch {
        // A date outside the converter's supported range must not take the
        // whole page down — the AD half alone is still useful.
        return null
    }
}

/** Gregorian rendering, e.g. `Jul 10, 2026`. */
function adPart(date: Date, opts: { withYear?: boolean } = {}): string {
    return date.toLocaleDateString('en-US', {
        timeZone: NEPAL_TZ,
        month: 'short',
        day: 'numeric',
        ...(opts.withYear === false ? {} : { year: 'numeric' }),
    })
}

function timePart(date: Date): string {
    return date.toLocaleTimeString('en-US', {
        timeZone: NEPAL_TZ,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

/** `<lead> (<secondary>)`, or just the lead when conversion was unavailable. */
function pair(lead: string | null, secondary: string | null): string {
    if (!lead) return secondary ?? '-'
    if (!secondary) return lead
    return `${lead} (${secondary})`
}

/**
 * The two calendars as separate strings, for callers that want to lay them out
 * themselves rather than take the bracketed one-liner.
 *
 * Dense tables are the reason this exists: "Shrawan 08, 2083 (Jul 24, 2026)" is
 * roughly twice the width of the AD date it replaced, and in a nowrap cell that
 * pushes the whole table into horizontal scroll. Stacking the secondary
 * calendar under the primary keeps both without the width.
 *
 * `secondary` is null when the BS conversion failed, so callers can render just
 * the one line rather than an empty second row.
 */
export function formatDateParts(
    value: string | Date | null | undefined,
    calendar: Calendar = DEFAULT_CALENDAR,
    opts: { withYear?: boolean } = {},
): { primary: string; secondary: string | null } {
    const date = toDate(value)
    if (!date) return { primary: '-', secondary: null }
    const bs = bsPart(date, opts)
    const ad = adPart(date, opts)
    return calendar === 'bs'
        ? { primary: bs ?? ad, secondary: bs ? ad : null }
        : { primary: ad, secondary: bs }
}

/**
 * A date with both calendars, the chosen one leading.
 *
 *   bs → "Asar 26, 2083 (Jul 10, 2026)"
 *   ad → "Jul 10, 2026 (Asar 26, 2083)"
 */
export function formatDate(
    value: string | Date | null | undefined,
    calendar: Calendar = DEFAULT_CALENDAR,
    opts: { withYear?: boolean } = {},
): string {
    const date = toDate(value)
    if (!date) return '-'
    const bs = bsPart(date, opts)
    const ad = adPart(date, opts)
    return calendar === 'bs' ? pair(bs, ad) : pair(ad, bs)
}

/**
 * As {@link formatDate} with the time appended once, after both calendars —
 * the clock reading is identical either way, so repeating it inside the
 * brackets would be noise.
 *
 *   bs → "Asar 26, 2083 (Jul 10, 2026), 2:42 PM"
 */
export function formatDateTime(
    value: string | Date | null | undefined,
    calendar: Calendar = DEFAULT_CALENDAR,
): string {
    const date = toDate(value)
    if (!date) return '-'
    return `${formatDate(date, calendar)}, ${timePart(date)}`
}

/**
 * Compact form for dense tables and stay ranges — no year on either calendar.
 *
 *   bs → "Asar 26 (Jul 10)"
 */
export function formatDateShort(
    value: string | Date | null | undefined,
    calendar: Calendar = DEFAULT_CALENDAR,
): string {
    return formatDate(value, calendar, { withYear: false })
}

/**
 * Long form with the weekday, for the ledger page headers that name the day
 * being viewed.
 *
 *   bs → "Friday, Asar 26, 2083 (Jul 10, 2026)"
 *
 * The weekday is the same in either calendar, so it is stated once up front
 * rather than repeated inside the brackets.
 */
export function formatDateLong(
    value: string | Date | null | undefined,
    calendar: Calendar = DEFAULT_CALENDAR,
): string {
    const date = toDate(value)
    if (!date) return '-'
    const weekday = date.toLocaleDateString('en-US', { timeZone: NEPAL_TZ, weekday: 'long' })
    return `${weekday}, ${formatDate(date, calendar)}`
}

/** Time only. Calendar-independent, but pinned to Kathmandu like the rest. */
export function formatTime(value: string | Date | null | undefined): string {
    const date = toDate(value)
    return date ? timePart(date) : '-'
}

/** Short label for the calendar toggle, e.g. "2083 BS" / "2026 AD". */
export function calendarLabel(calendar: Calendar, now: Date = new Date()): string {
    if (calendar === 'ad') return `${now.toLocaleDateString('en-US', { timeZone: NEPAL_TZ, year: 'numeric' })} AD`
    try {
        return `${toNepaliDate(nepalCalendarDate(now), 'YYYY', 'en')} BS`
    } catch {
        return 'BS'
    }
}
