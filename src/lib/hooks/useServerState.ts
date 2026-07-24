'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Local state seeded from a server prop that re-seeds whenever that prop changes.
 *
 * Live components hold their own copy of the data so realtime deltas can patch
 * it without a round trip. Plain `useState(initialX)` only reads the prop once,
 * though, so once a component has drifted - a missed event during a reconnect,
 * a counter that incremented one time too few - nothing can put it right. That
 * is what made the panels "work sometimes": there was no path back to server
 * truth short of the operator reloading the page.
 *
 * Pairing this with `RealtimeCatchUp` closes the loop: on reconnect the panel
 * calls `router.refresh()`, the route's server components re-run, the new props
 * arrive here, and every live component snaps back to the authoritative values.
 *
 * A refresh therefore overwrites unsaved local state, which is intended - the
 * server is the source of truth and a reconnect is exactly when the client's
 * copy is least trustworthy. Props only change on refresh or navigation, never
 * on an ordinary client re-render, so this does not fight realtime patches.
 */
export function useServerState<T>(initial: T): [T, Dispatch<SetStateAction<T>>] {
    const [state, setState] = useState<T>(initial)
    const [seenInitial, setSeenInitial] = useState<T>(initial)

    // React's documented way to reset state when a prop changes: adjust during
    // render rather than in an effect. React re-runs this component immediately
    // with the new state and never commits the stale pass, so the resync lands
    // in the same paint — an effect would render the stale data first, then
    // render again to correct it.
    if (initial !== seenInitial) {
        setSeenInitial(initial)
        setState(initial)
    }

    return [state, setState]
}
