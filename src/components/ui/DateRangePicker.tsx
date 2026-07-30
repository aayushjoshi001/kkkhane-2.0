'use client'

import { X } from 'lucide-react'
import { NepaliDateInput } from './NepaliDateInput'
import { getNstDateString } from '@/lib/timezone'
import { cn } from '@/lib/utils'

/**
 * A from/to date range, always Gregorian `YYYY-MM-DD` — same contract as
 * `NepaliDateInput`. `null` on either side means "unbounded" (used for the
 * 'all' preset); a caller that needs both ends set should treat a `null` as
 * today rather than leaving a request unbounded.
 */
export interface DateRange {
    from: string | null
    to: string | null
}

type PresetKey = 'today' | 'week' | 'month' | 'year' | 'all'

/** Monday of the week containing `iso`, matching the week-start convention
 *  already used by Income & Expenses' own preset filter. */
function mondayOf(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const day = date.getDay() // 0=Sun..6=Sat
    date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day))
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`
const firstOfYear = (iso: string) => `${iso.slice(0, 4)}-01-01`

const PRESETS: { key: PresetKey; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
]

/** The concrete `{from, to}` a preset resolves to right now, in NST. */
export function presetRange(preset: PresetKey): DateRange {
    const today = getNstDateString()
    switch (preset) {
        case 'today': return { from: today, to: today }
        case 'week': return { from: mondayOf(today), to: today }
        case 'month': return { from: firstOfMonth(today), to: today }
        case 'year': return { from: firstOfYear(today), to: today }
        case 'all': return { from: null, to: null }
    }
}

interface DateRangePickerProps {
    from: string | null
    to: string | null
    onChange: (range: DateRange) => void
    className?: string
    /** Hide the "All Time" preset and the clear button — for pages that
     *  always show exactly one bounded period (e.g. Day Book), never an
     *  unfiltered everything. */
    allowAll?: boolean
}

/**
 * A responsive from/to date range picker that renders in Bikram Sambat or
 * Gregorian to match the app-wide calendar toggle (each side is a
 * `NepaliDateInput`, which already reads `useCalendar()` itself). Preset
 * buttons cover the common cases; the two fields underneath cover everything
 * else. Value is always Gregorian ISO, `null` meaning unbounded.
 */
export function DateRangePicker({ from, to, onChange, className, allowAll = true }: DateRangePickerProps) {
    const activePreset = PRESETS.find(p => {
        const r = presetRange(p.key)
        return r.from === from && r.to === to
    })?.key

    const handleFrom = (iso: string) => {
        // Dragging "from" past "to" pulls "to" along instead of producing an
        // inverted, meaningless range.
        onChange({ from: iso, to: to && to < iso ? iso : to })
    }
    const handleTo = (iso: string) => {
        onChange({ from: from && from > iso ? iso : from, to: iso })
    }

    const presets = allowAll ? PRESETS : PRESETS.filter(p => p.key !== 'all')

    return (
        <div className={cn('flex flex-col gap-2.5', className)}>
            <div className="flex flex-wrap items-center gap-1.5">
                {presets.map(p => (
                    <button
                        key={p.key}
                        type="button"
                        onClick={() => onChange(presetRange(p.key))}
                        className={cn(
                            'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap',
                            activePreset === p.key
                                ? 'bg-brand-500 text-white shadow-sm'
                                : 'bg-surface-muted text-ink-subtle hover:text-ink hover:bg-surface-muted/80 border border-hairline',
                        )}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                    <NepaliDateInput value={from ?? ''} onChange={handleFrom} placeholder="From" aria-label="From date" />
                </div>
                <span className="text-ink-subtle text-[11px] font-bold uppercase shrink-0 text-center sm:px-0.5">to</span>
                <div className="flex-1 min-w-0">
                    <NepaliDateInput value={to ?? ''} onChange={handleTo} placeholder="To" aria-label="To date" />
                </div>
                {allowAll && (from || to) && (
                    <button
                        type="button"
                        onClick={() => onChange({ from: null, to: null })}
                        aria-label="Clear date range"
                        title="Clear date range"
                        className="p-2 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors shrink-0 self-center"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>
        </div>
    )
}
