'use client'

import { useCalendar } from '@/lib/contexts/CalendarContext'
import { calendarLabel } from '@/lib/calendar'
import { cn } from '@/lib/utils'

/**
 * Switches which calendar leads, for this user, everywhere.
 *
 * A segmented control rather than a switch: both options are named, so it is
 * obvious what the alternative is and which one is active without having to
 * flip it and look. Labels carry the live year — "2083 BS" / "2026 AD" — which
 * makes the difference concrete rather than an abstract acronym.
 */
export default function CalendarToggle({ className }: { className?: string }) {
    const { calendar, setCalendar } = useCalendar()

    return (
        <div
            role="radiogroup"
            aria-label="Date calendar"
            className={cn(
                'inline-flex items-center gap-0.5 p-0.5 rounded-full border border-hairline bg-surface-muted/60',
                className,
            )}
        >
            {(['bs', 'ad'] as const).map((option) => {
                const active = calendar === option
                return (
                    <button
                        key={option}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setCalendar(option)}
                        title={option === 'bs' ? 'Show Bikram Sambat dates first' : 'Show Gregorian dates first'}
                        className={cn(
                            'px-2.5 h-7 rounded-full text-[11px] font-bold tracking-wide transition-colors focus-ring whitespace-nowrap',
                            active
                                ? 'bg-surface text-ink shadow-sm'
                                : 'text-ink-subtle hover:text-ink',
                        )}
                    >
                        {calendarLabel(option)}
                    </button>
                )
            })}
        </div>
    )
}
