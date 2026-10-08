'use client'

import { Menu } from 'lucide-react'
import { useSidebar } from '@/lib/contexts/SidebarContext'

export default function MobileMenuButton() {
    const { toggleMobile, isOpen, __hasProvider } = useSidebar()
    if (!__hasProvider) return null
    return (
        <button
            type="button"
            onClick={toggleMobile}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 hover:bg-white/35 text-white border border-white/30 transition-colors shrink-0"
            aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isOpen}
            aria-controls="admin-sidebar"
        >
            <Menu size={20} />
        </button>
    )
}
