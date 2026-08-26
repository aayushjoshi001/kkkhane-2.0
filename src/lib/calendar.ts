import NepaliDate from 'nepali-date-converter'
import { toNepaliDate } from './nepaliDate'
import { NEPAL_TZ, nepalCalendarDate } from './utils'

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

// ── Date entry ────────────────────────────────────────────────────────────────
//
// Everything above renders an instant we already have. The rest of this module
// is the other direction: letting someone *pick* a Bikram Sambat date.
//
// The one rule these helpers exist to enforce is that BS never reaches storage.
// Form state, server actions and every column stay Gregorian `YYYY-MM-DD`, so a
// field can be switched to the BS picker without touching its submit path, and
// two cashiers on opposite calendar toggles write byte-identical rows.

/** A Bikram Sambat calendar date. `month` is 1-12, unlike the converter's 0-11. */
export interface BsParts {
    year: number
    month: number
    day: number
}

/**
 * The span nepali-date-converter can actually convert. Outside it the library
 * throws or returns nonsense, so the pickers clamp their year navigation here
 * rather than letting someone scroll into a range that silently misconverts.
 */
export const BS_MIN_YEAR = 2000
export const BS_MAX_YEAR = 2090

/**
 * BS month names, read out of the converter rather than typed out here.
 *
 * Hardcoding them would let the picker's dropdown drift from the dates rendered
 * beside it — the library says "Aswin" where most transliterations say "Ashoj",
 * and disagreeing with ourselves in one screen is worse than either spelling.
 */
export const BS_MONTHS: string[] = Array.from({ length: 12 }, (_, m) =>
    toNepaliDate(new NepaliDate(BS_MIN_YEAR + 80, m, 1).toJsDate(), 'MMMM', 'en'),
)

/** A Date's *local* Y/M/D as `YYYY-MM-DD`. */
function localIso(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse `YYYY-MM-DD` into a local-midnight Date.
 *
 * `new Date('2026-07-25')` is parsed as UTC midnight, which in Kathmandu is
 * 5:45am — harmless for display, but it makes the BS conversion land a day early
 * for any timezone behind UTC. Building the Date from parts keeps the calendar
 * day the user typed.
 */
function fromLocalIso(iso: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
    if (!m) return null
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(date.getTime()) ? null : date
}

/**
 * How many days a BS month has — 29 to 32, varying year to year, which is why
 * it must be asked rather than assumed.
 *
 * Derived by overshooting: the converter normalises an out-of-range day into the
 * following month, so the largest day that still reports the month it was asked
 * for is that month's length.
 */
export function bsMonthDays(year: number, month: number): number {
    for (let day = 32; day > 28; day--) {
        try {
            const nd = new NepaliDate(year, month - 1, day)
            if (nd.getMonth() === month - 1 && nd.getDate() === day) return day
        } catch {
            // Keep stepping down; a shorter month simply answers on a later pass.
        }
    }
    return 30
}

/** Gregorian `YYYY-MM-DD` → BS parts, or null if unconvertible. */
export function adIsoToBs(iso: string | null | undefined): BsParts | null {
    if (!iso) return null
    const date = fromLocalIso(iso)
    if (!date) return null
    try {
        const nd = new NepaliDate(date)
        return { year: nd.getYear(), month: nd.getMonth() + 1, day: nd.getDate() }
    } catch {
        return null
    }
}

/** BS parts → Gregorian `YYYY-MM-DD`, or null if unconvertible. */
export function bsToAdIso(parts: BsParts): string | null {
    const { year, month, day } = parts
    if (year < BS_MIN_YEAR || year > BS_MAX_YEAR || month < 1 || month > 12 || day < 1) return null
    try {
        return localIso(new NepaliDate(year, month - 1, day).toJsDate())
    } catch {
        return null
    }
}

/** Today in Bikram Sambat, on Kathmandu's clock. */
export function bsToday(): BsParts {
    return adIsoToBs(todayAdIso()) ?? { year: BS_MIN_YEAR, month: 1, day: 1 }
}

/** Today as Gregorian `YYYY-MM-DD`, on Kathmandu's clock. */
export function todayAdIso(): string {
    // en-CA is already ISO-ordered, so this needs no reassembly.
    return new Date().toLocaleDateString('en-CA', {
        timeZone: NEPAL_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
}

/** `Asar 09, 2083` — the BS half alone, for picker labels. */
export function formatBsParts(parts: BsParts, opts: { withYear?: boolean } = {}): string {
    const month = BS_MONTHS[parts.month - 1] ?? String(parts.month)
    const day = String(parts.day).padStart(2, '0')
    return opts.withYear === false ? `${month} ${day}` : `${month} ${day}, ${parts.year}`
}

/**
 * Weekday column (0 = Sunday) that a BS month starts on, for laying out a grid.
 * Nepali calendars start the week on Sunday, same as the JS convention, so the
 * day index needs no rotation.
 */
export function bsMonthStartWeekday(year: number, month: number): number {
    try {
        return new NepaliDate(year, month - 1, 1).toJsDate().getDay()
    } catch {
        return 0
    }
}

/** Step a BS year/month pair by whole months, clamped to the supported range. */
export function shiftBsMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const total = year * 12 + (month - 1) + delta
    const nextYear = Math.floor(total / 12)
    const nextMonth = (total % 12) + 1
    if (nextYear < BS_MIN_YEAR) return { year: BS_MIN_YEAR, month: 1 }
    if (nextYear > BS_MAX_YEAR) return { year: BS_MAX_YEAR, month: 12 }
    return { year: nextYear, month: nextMonth }
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
