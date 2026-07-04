'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { usePathname } from 'next/navigation'

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

    // Load saved desktop state
    useEffect(() => {
        const saved = localStorage.getItem('srms-sidebar-collapsed')
        if (saved === 'true') {
            setIsCollapsed(true)
        }
    }, [])

    // Close mobile sidebar on route change
    useEffect(() => {
        setIsOpen(false)
    }, [pathname])

    const toggleMobile = () => setIsOpen((prev) => !prev)
    const toggleDesktop = () => {
        setIsCollapsed((prev) => {
            const next = !prev
            localStorage.setItem('srms-sidebar-collapsed', String(next))
            return next
        })
    }
    const closeMobile = () => setIsOpen(false)

    return (
        <SidebarContext.Provider value={{ isOpen, isCollapsed, toggleMobile, toggleDesktop, closeMobile }}>
            {children}
        </SidebarContext.Provider>
    )
}

export function useSidebar() {
    const context = useContext(SidebarContext)
    return context
}
