'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
    BS_MAX_YEAR,
    BS_MIN_YEAR,
    BS_MONTHS,
    adIsoToBs,
    bsMonthDays,
    bsMonthStartWeekday,
    bsToAdIso,
    bsToday,
    formatBsParts,
    shiftBsMonth,
    todayAdIso,
} from '@/lib/calendar'
import { useCalendar } from '@/lib/contexts/CalendarContext'
import { cn } from '@/lib/utils'

/**
 * Date entry in Bikram Sambat.
 *
 * The value handed in and out is always Gregorian `YYYY-MM-DD` — the same string
 * a native `<input type="date">` produces. That is deliberate: a field can be
 * moved onto this picker without touching its validation, its server action or
 * its column, and two cashiers on opposite calendar toggles submit identical
 * rows. Only the reading and clicking is BS.
 *
 * On the `ad` toggle it renders the native input instead. Someone who has asked
 * for Gregorian is better served by their own OS date picker — with its keyboard
 * entry and locale habits — than by a re-implementation of it.
 */

const INPUT_CLASS =
    'w-full flex items-center justify-between gap-2 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm px-3 py-2 border bg-surface text-ink transition-all disabled:opacity-50 disabled:cursor-not-allowed'

/** Sunday-first, matching both the JS day index and the Nepali week. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/**
 * `Jul 25, 2026` from an ISO date, built from local parts.
 *
 * Formatting the string through `new Date(iso)` would read it as UTC midnight
 * and print the previous day anywhere behind UTC.
 */
function adLabel(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return iso
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function BsCalendarGrid({
    value,
    onPick,
}: {
    value: string
    onPick: (iso: string) => void
}) {
    const selected = useMemo(() => adIsoToBs(value), [value])
    const today = useMemo(() => bsToday(), [])
    const todayIso = useMemo(() => todayAdIso(), [])

    // The month on screen, which drifts from the selection as you navigate.
    // The grid only exists while the popover is open, so this initialiser runs
    // afresh on every open — reopening always lands on the selected date's
    // month without an effect to sync it back.
    const [view, setView] = useState<{ year: number; month: number }>(
        () => selected ?? { year: today.year, month: today.month },
    )

    const days = bsMonthDays(view.year, view.month)
    const lead = bsMonthStartWeekday(view.year, view.month)
    const atStart = view.year === BS_MIN_YEAR && view.month === 1
    const atEnd = view.year === BS_MAX_YEAR && view.month === 12

    const isSelected = (day: number) =>
        selected?.year === view.year && selected?.month === view.month && selected?.day === day
    const isToday = (day: number) =>
        today.year === view.year && today.month === view.month && today.day === day

    function pick(day: number) {
        const iso = bsToAdIso({ year: view.year, month: view.month, day })
        if (iso) onPick(iso)
    }

    return (
        <div className="p-2.5 w-[17rem]">
            <div className="flex items-center justify-between gap-1 mb-2">
                <button
                    type="button"
                    aria-label="Previous month"
                    disabled={atStart}
                    onClick={() => setView(v => shiftBsMonth(v.year, v.month, -1))}
                    className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-ring"
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="text-center leading-tight">
                    <p className="text-sm font-bold text-ink tabular-nums">
                        {BS_MONTHS[view.month - 1]} {view.year}
                    </p>
                    <p className="text-[10px] text-ink-subtle tabular-nums">
                        {adLabel(bsToAdIso({ ...view, day: 1 }) ?? '')}
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Next month"
                    disabled={atEnd}
                    onClick={() => setView(v => shiftBsMonth(v.year, v.month, 1))}
                    className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors disabled:opacity-30 disabled:hover:bg-transparent focus-ring"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
                {WEEKDAYS.map((d, i) => (
                    <span
                        key={i}
                        className={cn(
                            'text-[10px] font-bold text-center py-1 uppercase',
                            // Saturday is the weekend in Nepal, not Sunday.
                            i === 6 ? 'text-rose-500' : 'text-ink-subtle',
                        )}
                    >
                        {d}
                    </span>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} />)}
                {Array.from({ length: days }, (_, i) => {
                    const day = i + 1
                    const selectedDay = isSelected(day)
                    return (
                        <button
                            key={day}
                            type="button"
                            onClick={() => pick(day)}
                            aria-pressed={selectedDay}
                            className={cn(
                                'h-8 rounded-lg text-xs font-semibold tabular-nums transition-colors focus-ring',
                                selectedDay
                                    ? 'bg-brand-500 text-white font-bold'
                                    : isToday(day)
                                        ? 'bg-brand-50 text-brand-700 font-bold hover:bg-brand-100'
                                        : 'text-ink hover:bg-surface-muted',
                            )}
                        >
                            {day}
                        </button>
                    )
                })}
            </div>

            <button
                type="button"
                onClick={() => onPick(todayIso)}
                className="mt-2 w-full py-1.5 rounded-lg text-[11px] font-bold text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring"
            >
                Today — {formatBsParts(today)}
            </button>
        </div>
    )
}

/** Shared popover shell: a trigger button that opens the BS month grid. */
function BsPopover({
    value,
    onChange,
    disabled,
    id,
    ariaLabel,
    placeholder,
    trailing,
    className,
}: {
    value: string
    onChange: (iso: string) => void
    disabled?: boolean
    id?: string
    ariaLabel?: string
    placeholder: string
    trailing?: React.ReactNode
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const bs = value ? adIsoToBs(value) : null

    useEffect(() => {
        if (!open) return
        function onDocClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={ref} className="relative">
            <div className="flex items-stretch gap-1.5">
                <button
                    type="button"
                    id={id}
                    disabled={disabled}
                    aria-label={ariaLabel}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen(o => !o)}
                    className={cn(INPUT_CLASS, className, 'flex-1 min-w-0')}
                >
                    {bs ? (
                        <span className="truncate text-left leading-tight">
                            <span className="block font-semibold text-ink tabular-nums">{formatBsParts(bs)}</span>
                            <span className="block text-[10px] text-ink-subtle tabular-nums">{adLabel(value)}</span>
                        </span>
                    ) : (
                        <span className="truncate text-left text-ink-subtle">{placeholder}</span>
                    )}
                    <CalendarDays size={15} className="text-ink-subtle shrink-0" />
                </button>
                {trailing}
            </div>
            {open && (
                <div
                    role="dialog"
                    aria-label="Choose a Bikram Sambat date"
                    className="absolute z-50 mt-1.5 bg-surface border border-hairline rounded-[var(--r-md)] shadow-2xl animate-in fade-in zoom-in-95 duration-150"
                >
                    <BsCalendarGrid
                        value={value}
                        onPick={iso => {
                            onChange(iso)
                            setOpen(false)
                        }}
                    />
                </div>
            )}
        </div>
    )
}

/**
 * A date field. `value`/`onChange` speak Gregorian `YYYY-MM-DD` in both
 * calendars; only the presentation changes with the toggle.
 */
export function NepaliDateInput({
    value,
    onChange,
    disabled,
    id,
    className,
    placeholder = 'Select date',
    'aria-label': ariaLabel,
}: {
    value: string
    onChange: (iso: string) => void
    disabled?: boolean
    id?: string
    className?: string
    placeholder?: string
    'aria-label'?: string
}) {
    const { calendar } = useCalendar()

    if (calendar === 'ad') {
        return (
            <input
                type="date"
                id={id}
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={e => onChange(e.target.value)}
                className={cn(INPUT_CLASS, className)}
            />
        )
    }

    return (
        <BsPopover
            value={value}
            onChange={onChange}
            disabled={disabled}
            id={id}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            className={className}
        />
    )
}

/**
 * A date-and-time field, for check-in/check-out and anything else that needs a
 * clock reading beside the day.
 *
 * The value is `YYYY-MM-DDTHH:mm` — exactly what `<input type="datetime-local">`
 * emits — so the same submit paths keep working. In BS the day comes from the
 * grid and the time from a native time input, which is the part of the native
 * control worth keeping: it already handles 12/24-hour locales and keyboards.
 */
export function NepaliDateTimeInput({
    value,
    onChange,
    disabled,
    id,
    className,
    placeholder = 'Select date',
    'aria-label': ariaLabel,
}: {
    value: string
    onChange: (value: string) => void
    disabled?: boolean
    id?: string
    className?: string
    placeholder?: string
    'aria-label'?: string
}) {
    const { calendar } = useCalendar()

    if (calendar === 'ad') {
        return (
            <input
                type="datetime-local"
                id={id}
                value={value}
                disabled={disabled}
                aria-label={ariaLabel}
                onChange={e => onChange(e.target.value)}
                className={cn(INPUT_CLASS, className)}
            />
        )
    }

    const [datePart = '', timePart = ''] = value ? value.split('T') : []

    // A time with no date, or the reverse, is not a value any caller can use —
    // so a half-filled field reports empty and the existing "required" checks
    // still catch it. Picking a day first defaults the clock rather than
    // leaving the pair permanently unusable.
    const emit = (nextDate: string, nextTime: string) => {
        if (!nextDate) return onChange('')
        onChange(`${nextDate}T${nextTime || '12:00'}`)
    }

    return (
        <BsPopover
            value={datePart}
            onChange={iso => emit(iso, timePart)}
            disabled={disabled}
            id={id}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            className={className}
            trailing={
                <input
                    type="time"
                    value={timePart}
                    disabled={disabled || !datePart}
                    aria-label="Time"
                    onChange={e => emit(datePart, e.target.value)}
                    className={cn(INPUT_CLASS, className, 'w-[6.25rem] shrink-0 px-2')}
                />
            }
        />
    )
}
