'use client'

import { Loader2, UserCheck } from 'lucide-react'
import type { GuestSuggestion } from '@/lib/hooks/useGuestLookup'

/**
 * Returning guests matching what the front desk has typed so far.
 *
 * Shows the visit count rather than just the name: "3rd visit" is the piece of
 * information that changes how the desk greets someone, and it is not
 * recoverable from the booking form otherwise.
 *
 * Renders nothing at all when there is nothing to offer — an empty box under
 * the field would imply the guest is new, which is a claim this cannot make
 * while the query is still short or in flight.
 */
export default function GuestSuggestionList({
    suggestions,
    loading,
    onPick,
    formatDate,
}: {
    suggestions: GuestSuggestion[]
    loading: boolean
    onPick: (guest: GuestSuggestion) => void
    /** Tenant-aware date formatter (BS/AD), so this matches the rest of the panel. */
    formatDate?: (value: string) => string
}) {
    if (!loading && suggestions.length === 0) return null

    return (
        <div className="border border-hairline rounded-xl bg-surface-muted/40 overflow-hidden">
            {loading && suggestions.length === 0 ? (
                <p className="flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-semibold text-ink-subtle">
                    <Loader2 size={11} className="animate-spin" />
                    Checking past guests…
                </p>
            ) : (
                <>
                    <p className="px-2.5 pt-1.5 pb-1 text-[9px] font-black uppercase tracking-wider text-ink-subtle">
                        Stayed before — tap to fill
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                        {suggestions.map(guest => (
                            <button
                                key={guest.phone}
                                type="button"
                                onClick={() => onPick(guest)}
                                className="w-full text-left px-2.5 py-1.5 border-t border-hairline hover:bg-brand-50 transition-colors"
                            >
                                <span className="flex items-center justify-between gap-2">
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-1.5">
                                            <UserCheck size={11} className="text-brand-500 shrink-0" />
                                            <span className="text-[11px] font-bold text-ink truncate">{guest.name}</span>
                                        </span>
                                        <span className="block text-[10px] font-semibold text-ink-subtle tabular-nums">
                                            {guest.phone}
                                            {guest.kyc && <span className="ml-1.5 opacity-70">· {guest.kyc}</span>}
                                        </span>
                                    </span>
                                    <span className="text-right shrink-0">
                                        <span className="block text-[10px] font-black text-brand-600">
                                            {guest.visits === 1 ? '1 stay' : `${guest.visits} stays`}
                                        </span>
                                        {guest.lastStayAt && formatDate && (
                                            <span className="block text-[9px] font-semibold text-ink-subtle">
                                                last {formatDate(guest.lastStayAt)}
                                            </span>
                                        )}
                                        {guest.loyaltyPoints ? (
                                            <span className="block text-[9px] font-bold text-amber-600">
                                                {guest.loyaltyPoints} pts
                                            </span>
                                        ) : null}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
