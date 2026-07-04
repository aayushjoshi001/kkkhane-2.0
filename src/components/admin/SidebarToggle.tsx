'use client'

import { Menu } from 'lucide-react'
import { useSidebar } from '@/lib/contexts/SidebarContext'

export default function SidebarToggle({ isSuperAdmin }: { isSuperAdmin: boolean }) {
    const { toggleMobile, toggleDesktop, isCollapsed } = useSidebar()

    return (
        <div className="flex items-center gap-4">
            {/* Mobile Toggle */}
            <button
                onClick={toggleMobile}
                className="md:hidden p-2 -ml-2 rounded-xl text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring"
                aria-label="Open Sidebar"
            >
                <Menu size={20} />
            </button>

            {/* Desktop Toggle */}
            <button
                onClick={toggleDesktop}
                className="hidden md:flex p-2 -ml-2 rounded-xl text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring"
                aria-label={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
                <Menu size={20} />
            </button>

            {/* Optional Context Title */}
            <h2 className="hidden md:block text-h3 text-ink truncate">
                {isSuperAdmin ? 'SaaS Control Panel' : 'Management Console'}
            </h2>
        </div>
    )
}
