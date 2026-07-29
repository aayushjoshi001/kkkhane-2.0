'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
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
import SidebarShell from '@/components/admin/SidebarShell'
import { generatedAvatar, isGeneratedAvatar } from '@/lib/avatar'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const BASE = '/admin/super-admin'

export default function SuperAdminSidebar({ userRole = 'super_admin', userAvatar }: { userRole?: string; userAvatar?: string }) {
    const pathname = usePathname()
    const router = useRouter()
    const { closeMobile } = useSidebar()
    const [imgError, setImgError] = useState(false)

    const handleSignOut = () => signOutAndRedirect(router)

    const avatarSrc = userAvatar || generatedAvatar('superadmin', 'fb6303')

    // Rendered once per frame by SidebarShell — the drawer always gets
    // `isCollapsed: false`, since collapsing is a desktop-only affordance.
    const renderContent = (isCollapsed: boolean) => (
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
                <NavItem isCollapsed={isCollapsed} href={`${BASE}/restaurants`} icon={Building2}  label="Businesses" path={pathname} />
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

            {/* Footer Profile & Sign Out */}
            <div className={cn("p-4 shrink-0 border-t border-hairline", isCollapsed && "p-2 flex flex-col gap-2 items-center")}>
                <Link href="/admin/super-admin/profile" className={cn(
                    "flex items-center rounded-2xl transition-all duration-300 group cursor-pointer",
                    isCollapsed ? "flex-col p-2 gap-2" : "gap-3 p-2",
                    "hover:bg-surface-muted"
                )}>
                    {/* User Avatar */}
                    <div className={cn("rounded-xl overflow-hidden shrink-0 border border-hairline relative", isCollapsed ? "w-8 h-8" : "w-9 h-9")}>
                        {imgError ? (
                            <div className="w-full h-full bg-brand-500 flex items-center justify-center text-white font-bold text-xs">
                                {userRole.charAt(0).toUpperCase()}
                            </div>
                        ) : (
                            <Image 
                                src={avatarSrc}
                                alt="Admin avatar"
                                fill
                                sizes="36px"
                                unoptimized={isGeneratedAvatar(avatarSrc)}
                                className="object-cover"
                                onError={() => setImgError(true)}
                            />
                        )}
                    </div>
                    
                    {!isCollapsed && (
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate capitalize text-ink">
                                {userRole.replace(/_/g, ' ')}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </span>
                                <p className="text-[11px] font-medium truncate text-ink-muted">
                                    System Online
                                </p>
                            </div>
                        </div>
                    )}

                    <div className={cn(
                        "flex items-center transition-opacity", 
                        isCollapsed ? "flex-col opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    )}>
                        <button 
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSignOut(); }}
                            className="p-1.5 rounded-xl transition-all text-ink-subtle hover:text-danger-fg hover:bg-danger-bg"
                            title="Sign Out"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </Link>
            </div>
        </div>
    )

    return <SidebarShell renderContent={renderContent} tone="light" />
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
