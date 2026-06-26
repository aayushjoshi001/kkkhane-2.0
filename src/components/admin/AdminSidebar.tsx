'use client'

import { useState, useEffect, useRef } from 'react'
import {
    Users, UtensilsCrossed, Settings, LogOut, BarChart3, Palette, Grid3X3,
    Menu, X, TrendingUp, ShoppingBag, Tag, Heart, DollarSign, Package,
    FileText, Truck, Clock, CreditCard, Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Logo from '@/components/shared/Logo'
import { createClient } from '@/lib/supabase/client'

export default function AdminSidebar({ userRole, restaurantName }: { userRole?: string; restaurantName?: string }) {
    const pathname = usePathname()
    const router = useRouter()
    const supabase = createClient()
    const [isOpen, setIsOpen] = useState(false)
    const prevPathRef = useRef(pathname)

    useEffect(() => {
        if (prevPathRef.current !== pathname) {
            prevPathRef.current = pathname
            queueMicrotask(() => setIsOpen(false))
        }
    }, [pathname])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
        router.refresh()
    }

    const roleLabel = (userRole || 'admin').replace(/_/g, ' ')

    const content = (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-4 py-4 border-b border-hairline flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <Logo variant="dark" className="h-7 shrink-0" />
                    <div className="min-w-0">
                        <p className="text-small font-bold text-ink truncate leading-tight">{restaurantName || 'kkkhane'}</p>
                        <span className="inline-block mt-1 rounded-full bg-[var(--neutral-badge-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--neutral-badge-fg)]">
                            {roleLabel}
                        </span>
                    </div>
                </div>
                <button onClick={() => setIsOpen(false)}
                        className="md:hidden p-1.5 text-ink-subtle hover:text-ink rounded-[var(--r-md)] hover:bg-surface-muted">
                    <X size={18} />
                </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto py-3 px-2.5 scrollbar-thin space-y-0.5">
                <NavItem href="/admin/dashboard"  icon={BarChart3}       label="Overview"        path={pathname} />
                
                <SectionLabel>Menu</SectionLabel>
                <NavItem href="/admin/menu"        icon={UtensilsCrossed} label="Menu"            path={pathname} />
                <NavItem href="/admin/combos"      icon={Sparkles}        label="Combo Offers"    path={pathname} />
                <NavItem href="/admin/pricing"     icon={DollarSign}      label="Dynamic Pricing" path={pathname} />
                <NavItem href="/admin/promos"      icon={Tag}             label="Promo Codes"     path={pathname} />

                <SectionLabel>Sales & Service</SectionLabel>
                <NavItem href="/admin/orders"      icon={ShoppingBag}     label="Orders"         path={pathname} />
                <NavItem href="/admin/payments"    icon={CreditCard}      label="Payments"       path={pathname} />
                <NavItem href="/admin/takeout"     icon={Truck}           label="Takeout"        path={pathname} />
                <NavItem href="/admin/tables"      icon={Grid3X3}         label="Tables & QR"    path={pathname} />
                
                <SectionLabel>Revenue & Growth</SectionLabel>
                <NavItem href="/admin/loyalty"     icon={Heart}           label="Loyalty"         path={pathname} />
                <NavItem href="/admin/reports"     icon={FileText}        label="EOD Reports"     path={pathname} />
                <NavItem href="/admin/analytics"   icon={TrendingUp}      label="Analytics"      path={pathname} />

                <SectionLabel>Operations</SectionLabel>
                <NavItem href="/admin/ingredients" icon={Package}         label="Stock"  path={pathname} />
                <NavItem href="/admin/staff"       icon={Users}           label="Staff"          path={pathname} />
                <NavItem href="/admin/shifts"      icon={Clock}           label="Staff Shifts" path={pathname} />

                <SectionLabel>Config</SectionLabel>
                <NavItem href="/admin/homepage"    icon={Palette}         label="Homepage"      path={pathname} />
                <NavItem href="/admin/theme"       icon={Palette}         label="Brand & Theme" path={pathname} />
                <NavItem href="/admin/settings"    icon={Settings}        label="Settings"      path={pathname} />
            </nav>

            {/* Footer */}
            <div className="px-2.5 py-3 border-t border-hairline shrink-0">
                <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-3 h-9 text-small font-medium text-ink-muted hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] transition-colors"
                >
                    <LogOut size={18} className="shrink-0" />
                    Sign Out
                </button>
            </div>
        </div>
    )

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="md:hidden fixed top-3 left-3 z-40 p-2 bg-surface border border-hairline rounded-[var(--r-md)] shadow-md text-ink hover:bg-surface-muted transition-colors"
            >
                <Menu size={20} />
            </button>

            {isOpen && (
                <div className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setIsOpen(false)} />
            )}

            <aside className={`md:hidden fixed top-0 left-0 bottom-0 w-[248px] bg-surface z-50 shadow-lg transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                {content}
            </aside>

            <aside className="hidden md:block w-[248px] bg-surface border-r border-hairline shadow-sm shrink-0 z-20 h-screen sticky top-0 overflow-hidden">
                {content}
            </aside>
        </>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-3 pt-4 pb-1 text-[10px] font-bold text-ink-subtle uppercase tracking-widest">
            {children}
        </p>
    )
}

function NavItem({ href, icon: Icon, label, path }: { href: string; icon: React.ElementType; label: string; path: string }) {
    const isActive = path === href || path.startsWith(`${href}/`)
    return (
        <Link
            href={href}
            prefetch={true}
            className={`relative flex items-center gap-3 px-3 h-9 rounded-[var(--r-md)] text-sm font-medium transition-colors ${
                isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
            }`}
        >
            {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-brand-500" />
            )}
            <Icon size={18} className={`shrink-0 ${isActive ? 'text-brand-600' : 'text-ink-subtle'}`} />
            {label}
        </Link>
    )
}
