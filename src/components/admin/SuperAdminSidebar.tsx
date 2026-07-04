'use client'

import {
    LayoutDashboard, Building2, UtensilsCrossed, ShoppingBag, CreditCard, Truck,
    Users, Clock, DollarSign, Heart, Tag, Package, Grid3X3, FileText,
    TrendingUp, Settings, LogOut, Menu, X, Crown, BarChart3,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Logo from '@/components/shared/Logo'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { useSidebar } from '@/lib/contexts/SidebarContext'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const BASE = '/admin/super-admin'

export default function SuperAdminSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { isOpen, isCollapsed, closeMobile } = useSidebar()

    const handleSignOut = () => signOutAndRedirect(router)

    const content = (
        <div className="flex flex-col h-full bg-surface text-ink transition-colors duration-500">
            {/* Header */}
            <div className={cn("py-6 flex items-center shrink-0 relative z-10 transition-all duration-300", isCollapsed ? "px-0 justify-center" : "px-6 justify-between gap-3")}>
                <div className={cn("flex items-center min-w-0", isCollapsed ? "justify-center" : "gap-3")}>
                    <Logo className="h-7 shrink-0" />
                </div>
                <button onClick={closeMobile}
                        className="md:hidden p-1.5 text-ink-subtle hover:text-ink rounded-lg hover:bg-surface-muted transition-colors">
                    <X size={18} />
                </button>
            </div>

            {/* Super admin badge */}
            {!isCollapsed && (
                <div className="mx-6 mt-1 mb-4 flex items-center gap-2 bg-brand-50 border border-brand-200 rounded-[var(--r-md)] px-3 py-2 shrink-0">
                    <Crown size={14} className="text-brand-500 shrink-0" />
                    <span className="text-[11px] font-bold text-brand-600 tracking-wider uppercase">Super Admin</span>
                </div>
            )}
            {isCollapsed && (
                <div className="mx-auto mb-4 flex items-center justify-center bg-brand-50 border border-brand-200 rounded-full w-8 h-8 shrink-0" title="Super Admin">
                    <Crown size={14} className="text-brand-500" />
                </div>
            )}

            {/* Nav */}
            <nav className={cn("flex-1 overflow-y-auto py-2 scrollbar-none space-y-1 relative z-10", isCollapsed ? "px-2" : "px-4")}>
                <SectionLabel isCollapsed={isCollapsed}>Overview</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/dashboard`} icon={LayoutDashboard} label="Dashboard" path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/analytics`} icon={BarChart3}       label="Analytics" path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>Tenants</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/restaurants`} icon={Building2}  label="Restaurants" path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/payments`}    icon={CreditCard} label="Payments"    path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>Operations</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/menus`}   icon={UtensilsCrossed} label="Menus"   path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/orders`}  icon={ShoppingBag}     label="Orders"  path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/takeout`} icon={Truck}           label="Takeout" path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>People</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/staff`}  icon={Users} label="Staff"        path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/shifts`} icon={Clock} label="Staff Shifts" path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>Features</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/pricing`}     icon={DollarSign} label="Pricing"      path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/loyalty`}     icon={Heart}      label="Loyalty"      path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/promos`}      icon={Tag}        label="Promos"       path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/ingredients`} icon={Package}    label="Ingredients"  path={pathname} />
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/tables`}      icon={Grid3X3}    label="Tables & QR"  path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>Reporting</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/reports`} icon={FileText} label="EOD Reports" path={pathname} />

                <SectionLabel isCollapsed={isCollapsed}>Platform</SectionLabel>
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/config`} icon={Settings} label="Config" path={pathname} />
                
                <div className="h-4" />
            </nav>

            {/* Footer */}
            <div className={cn("p-4 shrink-0", isCollapsed ? "flex justify-center" : "")}>
                <button
                    onClick={handleSignOut}
                    title={isCollapsed ? "Sign Out" : undefined}
                    className={cn(
                        "flex items-center text-sm font-bold transition-all focus-ring",
                        isCollapsed ? "justify-center p-3 rounded-[var(--r-md)] text-ink-subtle hover:text-danger-fg hover:bg-danger-bg" : "w-full gap-3 px-4 py-3 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)]"
                    )}
                >
                    <LogOut size={18} className="shrink-0" />
                    {!isCollapsed && "Sign Out"}
                </button>
            </div>
        </div>
    )

    return (
        <>
            {isOpen && (
                <div className="md:hidden fixed inset-0 bg-ink/60 backdrop-blur-sm z-40 animate-fade-in" onClick={closeMobile} />
            )}

            <aside className={cn(
                "md:hidden fixed top-0 left-0 bottom-0 w-[280px] z-50 transition-transform duration-500 ease-[var(--ease-spring)] shadow-[20px_0_40px_rgba(0,0,0,0.1)]",
                isOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {content}
            </aside>

            <aside className={cn(
                "hidden md:block shrink-0 z-20 h-screen sticky top-0 overflow-hidden transition-all duration-300 ease-[var(--ease-spring)] shadow-sm border-r border-hairline",
                isCollapsed ? "w-[80px]" : "w-[280px]"
            )}>
                {content}
            </aside>
        </>
    )
}

function SectionLabel({ children, isCollapsed }: { children: React.ReactNode, isCollapsed: boolean }) {
    if (isCollapsed) {
        return (
            <div className="py-4 flex justify-center">
                <div className="w-6 h-[1px] bg-hairline" />
            </div>
        )
    }
    return (
        <p className="px-4 pt-6 pb-2 text-[10px] font-extrabold text-ink-muted uppercase tracking-wider flex items-center gap-2">
            {children}
        </p>
    )
}

function NavItem({ href, icon: Icon, label, path, isCollapsed }: { href: string; icon: React.ElementType; label: string; path: string; isCollapsed: boolean }) {
    const isActive = path === href || path.startsWith(`${href}/`)
    return (
        <Link
            href={href}
            prefetch={true}
            title={isCollapsed ? label : undefined}
            className={cn(
                "group relative flex items-center px-4 h-11 rounded-[var(--r-md)] text-[14px] font-bold transition-all duration-300",
                isCollapsed ? "justify-center" : "gap-3.5",
                isActive
                    ? "bg-brand-50 text-brand-600 shadow-sm"
                    : "text-ink-subtle hover:bg-surface-muted hover:text-ink"
            )}
        >
            {isActive && !isCollapsed && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-brand-500" />
            )}
            <Icon size={isCollapsed ? 20 : 18} className={cn(
                "shrink-0 transition-colors", 
                isActive ? "text-brand-500" : "text-ink-muted group-hover:text-ink"
            )} />
            {!isCollapsed && label}
        </Link>
    )
}
