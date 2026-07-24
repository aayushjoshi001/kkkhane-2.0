'use client'

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useSidebar } from '@/lib/contexts/SidebarContext'

export default function SidebarToggle({ isSuperAdmin }: { isSuperAdmin: boolean }) {
    const { toggleMobile, toggleDesktop, isOpen, isCollapsed } = useSidebar()

    return (
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
            {/* Mobile: opens the drawer. min-h/w-11 keeps the tap target at the
                44px floor — `p-2` around an 20px icon left it at 36px, which is
                a real miss rate on a phone held one-handed. */}
            <button
                type="button"
                onClick={toggleMobile}
                className="md:hidden -ml-2 inline-flex items-center justify-center min-w-11 min-h-11 rounded-xl text-ink-subtle hover:text-ink hover:bg-surface-muted active:bg-surface-muted transition-colors focus-ring"
                aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={isOpen}
                aria-controls="admin-sidebar"
            >
                <Menu size={20} />
            </button>

            {/* Desktop: collapses the static column. The icon reflects which way
                it will go — a plain hamburger gave no hint of the current state. */}
            <button
                type="button"
                onClick={toggleDesktop}
                className="hidden md:inline-flex items-center justify-center -ml-2 min-w-10 min-h-10 rounded-xl text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring"
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={isCollapsed}
                title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
                {isCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </button>

            <h2 className="hidden md:block text-h3 text-ink truncate">
                {isSuperAdmin ? 'SaaS Control Panel' : 'Management Console'}
            </h2>
        </div>
    )
}
