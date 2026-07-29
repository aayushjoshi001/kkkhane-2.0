'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * The single modal primitive. One backdrop, one radius, one z-scale, one set of
 * behaviors — replaces the 45 hand-rolled `fixed inset-0` overlays that each
 * re-derived (inconsistently) their backdrop colour, z-index, escape handling,
 * scroll lock, and focus management.
 *
 * Behaviors handled here so no caller has to reimplement them:
 *  - Portal to <body> (after mount, so SSR is a no-op)
 *  - Consistent backdrop (bg-ink/50 + blur) and enter animation
 *  - Escape-to-close — only the *topmost* open modal responds (stack-aware)
 *  - Body scroll lock while any modal is open (ref-counted for nested modals)
 *  - Focus trap + focus restore to the element that was focused before opening
 *  - role="dialog" aria-modal, labelled by the title when `title` is provided
 *
 * Layering: use `layer="top"` for globally-mounted dialogs that must sit above
 * any feature modal (e.g. the confirm dialog), so a confirm() fired from inside
 * an open form is never buried behind it.
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

export interface ModalProps {
    open: boolean
    onClose: () => void
    children: ReactNode
    /** Constrains panel width. `full` fills the viewport (POS-style workspaces). */
    size?: ModalSize
    /** Dismiss when the backdrop is clicked. Default true. */
    closeOnBackdrop?: boolean
    /** Dismiss on the Escape key. Default true. */
    closeOnEscape?: boolean
    /** Accessible name when there is no visible title element to reference. */
    ariaLabel?: string
    /** Extra classes for the panel (layout, height, etc.). */
    className?: string
    /** Extra classes for the backdrop wrapper. */
    backdropClassName?: string
    /**
     * Stacking layer. `default` (z-[200]) for feature modals; `top` (z-[300])
     * for the global confirm dialog so it always wins over a feature modal.
     */
    layer?: 'default' | 'top'
}

const SIZE: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    full: 'max-w-5xl h-full md:h-[85vh]',
}

// Ref-counted body scroll lock: the background stays locked as long as *any*
// modal is open, and unlocks only when the last one closes.
let lockCount = 0
function lockScroll() {
    if (lockCount === 0) {
        const scrollbar = window.innerWidth - document.documentElement.clientWidth
        document.body.style.overflow = 'hidden'
        // Compensate for the removed scrollbar so the page doesn't shift.
        if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    }
    lockCount++
}
function unlockScroll() {
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
        document.body.style.overflow = ''
        document.body.style.paddingRight = ''
    }
}

// Stack of open modals so only the topmost handles Escape (and, later, so a
// nested modal traps focus above its parent).
const modalStack: symbol[] = []

const FOCUSABLE =
    'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function Modal({
    open,
    onClose,
    children,
    size = 'lg',
    closeOnBackdrop = true,
    closeOnEscape = true,
    ariaLabel,
    className,
    backdropClassName,
    layer = 'default',
}: ModalProps) {
    const [mounted, setMounted] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const idRef = useRef<symbol | null>(null)

    useEffect(() => setMounted(true), [])

    // Latest onClose without re-subscribing the key handler every render.
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    const isTopmost = useCallback(
        () => modalStack.length > 0 && modalStack[modalStack.length - 1] === idRef.current,
        [],
    )

    useEffect(() => {
        if (!open) return
        const id = Symbol('modal')
        idRef.current = id
        modalStack.push(id)
        lockScroll()

        const previouslyFocused = document.activeElement as HTMLElement | null
        // Focus the first focusable control, else the panel itself.
        const panel = panelRef.current
        const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
        ;(first ?? panel)?.focus()

        function onKeyDown(e: KeyboardEvent) {
            if (modalStack[modalStack.length - 1] !== id) return // not topmost
            if (e.key === 'Escape' && closeOnEscape) {
                e.stopPropagation()
                onCloseRef.current()
                return
            }
            if (e.key === 'Tab' && panel) {
                const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                    el => el.offsetParent !== null || el === document.activeElement,
                )
                if (items.length === 0) {
                    e.preventDefault()
                    panel.focus()
                    return
                }
                const firstEl = items[0]
                const lastEl = items[items.length - 1]
                const active = document.activeElement
                if (e.shiftKey && (active === firstEl || active === panel)) {
                    e.preventDefault()
                    lastEl.focus()
                } else if (!e.shiftKey && active === lastEl) {
                    e.preventDefault()
                    firstEl.focus()
                }
            }
        }

        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
            const idx = modalStack.indexOf(id)
            if (idx !== -1) modalStack.splice(idx, 1)
            unlockScroll()
            // Restore focus if it's still safe to do so.
            if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
        }
    }, [open, closeOnEscape])

    if (!mounted || !open) return null

    const isFull = size === 'full'

    return createPortal(
        <div
            className={cn(
                'fixed inset-0 flex items-center justify-center bg-ink/50 backdrop-blur-sm',
                'animate-in fade-in duration-200',
                // Full-screen workspaces go edge-to-edge on mobile; smaller
                // dialogs keep a margin so they read as centered cards.
                isFull ? 'p-0 sm:p-4' : 'p-4',
                layer === 'top' ? 'z-[300]' : 'z-[200]',
                backdropClassName,
            )}
            onMouseDown={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                tabIndex={-1}
                className={cn(
                    'relative bg-surface w-full border border-hairline shadow-2xl outline-none overflow-y-auto',
                    'animate-in zoom-in-95 duration-150',
                    isFull
                        ? 'rounded-none sm:rounded-[24px] max-h-[100dvh] sm:max-h-[90vh]'
                        : 'rounded-[24px] max-h-[90vh]',
                    SIZE[size],
                    className,
                )}
            >
                {children}
            </div>
        </div>,
        document.body,
    )
}
