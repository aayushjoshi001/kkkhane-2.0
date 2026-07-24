'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useSidebar } from '@/lib/contexts/SidebarContext'
import { cn } from '@/lib/utils'

/**
 * The two frames every admin sidebar lives in: a slide-over drawer under `md`,
 * and a static column at `md` and up.
 *
 * `renderContent` is called once per frame with the collapse state that frame
 * should use. That is the point of the render prop: collapsing is a desktop
 * affordance, but AdminSidebar and SuperAdminSidebar both used to build their
 * markup once and drop the same element into both frames, so a manager who had
 * collapsed the desktop sidebar — a preference kept in localStorage — got an
 * icon-only rail floating inside a full-width drawer on their phone, with every
 * label hidden and no way to expand it, on every visit until they went back to
 * a desktop to undo it. The drawer is now always passed `false`.
 *
 * Also centralises the drawer behaviour both copies were missing: Escape to
 * close, background scroll lock, focus moved in on open and returned to the
 * trigger on close, and the closed drawer taken out of the tab order — until
 * now it sat off-screen, still focusable, so tabbing through a page on a phone
 * walked invisibly through forty navigation links.
 */
export default function SidebarShell({
    renderContent,
    tone = 'light',
}: {
    renderContent: (collapsed: boolean) => ReactNode
    tone?: 'light' | 'dark'
}) {
    const { isOpen, isCollapsed, closeMobile } = useSidebar()
    const drawerRef = useRef<HTMLElement>(null)
    const returnFocusRef = useRef<HTMLElement | null>(null)

    useEffect(() => {
        if (!isOpen) return

        returnFocusRef.current = document.activeElement as HTMLElement | null

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMobile()
                return
            }
            if (event.key !== 'Tab') return

            // Keep Tab inside the panel. It is declared aria-modal, so a screen
            // reader already treats the rest of the page as hidden; without this
            // a keyboard user would still tab straight out into content they
            // cannot see behind the backdrop.
            const panel = drawerRef.current
            if (!panel) return
            const focusable = panel.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
            if (focusable.length === 0) return

            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            const active = document.activeElement

            if (event.shiftKey && (active === first || active === panel)) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && active === last) {
                event.preventDefault()
                first.focus()
            }
        }
        document.addEventListener('keydown', onKeyDown)

        // The drawer scrolls its own nav; without this the page behind it
        // scrolls too as soon as the nav hits its end.
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        // Focus the panel itself rather than its first link, so a screen reader
        // announces the navigation landmark instead of jumping into "Overview".
        drawerRef.current?.focus({ preventScroll: true })

        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.body.style.overflow = previousOverflow
            returnFocusRef.current?.focus?.({ preventScroll: true })
        }
    }, [isOpen, closeMobile])

    return (
        <>
            {/* Kept mounted so it can fade both ways — unmounting it made the
                backdrop vanish instantly while the panel was still sliding. */}
            <div
                aria-hidden="true"
                onClick={closeMobile}
                className={cn(
                    'print:hidden md:hidden fixed inset-0 z-40 backdrop-blur-[2px] transition-opacity duration-300 ease-out',
                    tone === 'dark' ? 'bg-black/50' : 'bg-ink/40',
                    isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
            />

            {/* Mobile drawer */}
            <aside
                ref={drawerRef}
                id="admin-sidebar"
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="Main navigation"
                inert={!isOpen}
                className={cn(
                    'print:hidden md:hidden fixed inset-y-0 left-0 z-50 outline-none',
                    // Leaves a comfortable strip of backdrop to tap on a 320px
                    // phone, where the old fixed 280px left barely 40px.
                    'w-[min(84vw,320px)]',
                    'rounded-r-3xl overflow-hidden',
                    'transition-transform duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none',
                    isOpen ? 'translate-x-0' : '-translate-x-full',
                    tone === 'dark'
                        ? 'shadow-[8px_0_32px_-8px_rgba(0,0,0,0.6)]'
                        : 'shadow-[8px_0_32px_-8px_rgba(0,0,0,0.18)]'
                )}
            >
                {renderContent(false)}
            </aside>

            {/* Desktop column */}
            <aside
                className={cn(
                    'print:hidden hidden md:block shrink-0 z-20 h-screen sticky top-0 overflow-hidden',
                    'transition-[width] duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none',
                    isCollapsed ? 'w-[80px]' : 'w-[280px]',
                    tone === 'dark'
                        ? 'border-r border-white/5 shadow-[4px_0_24px_rgba(0,0,0,0.05)]'
                        : 'border-r border-hairline-strong shadow-sm'
                )}
            >
                {renderContent(isCollapsed)}
            </aside>
        </>
    )
}
