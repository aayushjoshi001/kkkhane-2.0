'use client'

import { Search } from 'lucide-react'

// Lives in its own module (no cmdk import) so it can be statically imported by
// server layouts without pulling the palette/cmdk into the initial bundle.
export const COMMAND_OPEN_EVENT = 'kkk:command-open'

/** Dispatch from anywhere (e.g. the hint button) to open the palette. */
export function openCommandPalette() {
    window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))
}

/** Subtle "Press ⌘K" affordance; also opens the palette on click (touch). */
export function CommandHint({ className, iconOnly = false, hideKbd = false }: { className?: string; iconOnly?: boolean; hideKbd?: boolean }) {
    return (
        <button
            type="button"
            onClick={openCommandPalette}
            className={`hidden sm:flex items-center gap-1.5 text-caption text-ink-subtle hover:text-ink transition-colors ${className ?? ''}`}
            aria-label="Open command palette"
            title={iconOnly ? 'Search (⌘K)' : undefined}
        >
            <Search size={iconOnly ? 12 : 12} />
            {!iconOnly && (
                <>
                    <span>Search</span>
                    {!hideKbd && <kbd className="px-1.5 py-0.5 rounded border border-hairline-strong bg-surface-muted font-sans tabular font-medium">⌘K</kbd>}
                </>
            )}
        </button>
    )
}
