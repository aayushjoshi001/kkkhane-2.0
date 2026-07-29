'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'
import { usePathname } from 'next/navigation'

/** Tailwind's `md` breakpoint — the width at which the drawer becomes the static sidebar. */
const MD_BREAKPOINT = '(min-width: 768px)'

interface SidebarContextType {
    isOpen: boolean // For mobile (drawer)
    isCollapsed: boolean // For desktop (mini sidebar)
    toggleMobile: () => void
    toggleDesktop: () => void
    closeMobile: () => void
}

const defaultContext: SidebarContextType = {
    isOpen: false,
    isCollapsed: false,
    toggleMobile: () => {},
    toggleDesktop: () => {},
    closeMobile: () => {}
}

const SidebarContext = createContext<SidebarContextType>(defaultContext)

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false)
    const pathname = usePathname()

    // Load saved desktop state. Has to be an effect: localStorage is not
    // available during the server render, and seeding useState from it would
    // desync hydration.
    useEffect(() => {
        const saved = localStorage.getItem('srms-sidebar-collapsed')
        if (saved === 'true') {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsCollapsed(true)
        }
    }, [])

    // Close mobile sidebar on route change
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsOpen(false)
    }, [pathname])

    // Growing past `md` swaps the drawer for the static sidebar. Without this the
    // drawer state stays "open" behind it — and since opening the drawer locks
    // body scroll, rotating a tablet to landscape left the page unscrollable
    // with nothing on screen to explain why.
    useEffect(() => {
        const mq = window.matchMedia(MD_BREAKPOINT)
        const sync = () => { if (mq.matches) setIsOpen(false) }
        sync()
        mq.addEventListener('change', sync)
        return () => mq.removeEventListener('change', sync)
    }, [])

    // Stable identities: these are dependencies of the drawer's focus, scroll-lock
    // and key handlers, which would otherwise tear down and re-run on every render.
    const toggleMobile = useCallback(() => setIsOpen((prev) => !prev), [])
    const closeMobile = useCallback(() => setIsOpen(false), [])
    const toggleDesktop = useCallback(() => {
        setIsCollapsed((prev) => {
            const next = !prev
            localStorage.setItem('srms-sidebar-collapsed', String(next))
            return next
        })
    }, [])

    const value = useMemo(
        () => ({ isOpen, isCollapsed, toggleMobile, toggleDesktop, closeMobile }),
        [isOpen, isCollapsed, toggleMobile, toggleDesktop, closeMobile]
    )

    return (
        <SidebarContext.Provider value={value}>
            {children}
        </SidebarContext.Provider>
    )
}

export function useSidebar() {
    const context = useContext(SidebarContext)
    return context
}
