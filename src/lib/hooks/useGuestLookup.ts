'use client'

import { useEffect, useState } from 'react'
import type { GuestSuggestion } from '@/app/api/customers/search/route'

export type { GuestSuggestion }

/**
 * Suggest returning guests as the front desk types a phone number or name.
 *
 * Debounced because this fires on every keystroke of a field the cashier is
 * actively typing into, and each call is an indexed lookup against the guest
 * book — without it, entering a ten-digit phone number would issue ten
 * queries and race their replies.
 *
 * Replies are matched against the query that asked for them, so a slow
 * response for "984" can never overwrite the newer results for "9841234".
 */
const MIN_QUERY_LENGTH = 3
const DEBOUNCE_MS = 250

export function useGuestLookup(query: string, { enabled = true }: { enabled?: boolean } = {}) {
    // Results are stored together with the query that produced them. Both the
    // "query too short" and "query has moved on" cases are then derived rather
    // than cleared by an effect, so nothing is set synchronously during render
    // and a stale list can never be shown against a newer query.
    const [fetched, setFetched] = useState<{ query: string; items: GuestSuggestion[] }>({ query: '', items: [] })
    const [fetching, setFetching] = useState(false)

    const trimmed = query.trim()
    const active = enabled && trimmed.length >= MIN_QUERY_LENGTH

    const suggestions = active && fetched.query === trimmed ? fetched.items : []
    const loading = active && fetched.query !== trimmed && fetching

    useEffect(() => {
        if (!active) return

        let cancelled = false
        // setState lives inside the timer rather than the effect body: this
        // fires on every keystroke, and marking it loading synchronously would
        // re-render the form on each character before any request is even sent.
        const timer = setTimeout(() => {
            if (cancelled) return
            setFetching(true)
            fetch(`/api/customers/search?q=${encodeURIComponent(trimmed)}`)
                .then(r => r.json())
                .then(data => {
                    if (cancelled) return
                    setFetched({ query: trimmed, items: data.success ? (data.customers || []) : [] })
                })
                .catch(() => { if (!cancelled) setFetched({ query: trimmed, items: [] }) })
                .finally(() => { if (!cancelled) setFetching(false) })
        }, DEBOUNCE_MS)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [trimmed, active])

    return { suggestions, loading }
}
