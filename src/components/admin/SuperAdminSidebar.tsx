'use client'

import { useState, useEffect, useRef } from 'react'
import {
    LayoutDashboard, Building2, UtensilsCrossed, ShoppingBag, CreditCard, Truck,
    Users, Clock, DollarSign, Heart, Tag, Package, Grid3X3, FileText,
    TrendingUp, Settings, LogOut, Menu, X, Crown, BarChart3,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Logo from '@/components/shared/Logo'
import { signOutAndRedirect } from '@/lib/auth/signOut'

const BASE = '/admin/super-admin'

export default function SuperAdminSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const prevPathRef = useRef(pathname)

    useEffect(() => {
        if (prevPathRef.current !== pathname) {
            prevPathRef.current = pathname
            queueMicrotask(() => setIsOpen(false))
        }
    }, [pathname])

    const handleSignOut = () => signOutAndRedirect(router)

    const content = (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                    <Logo className="h-7 shrink-0" />
                </div>
                <button onClick={() => setIsOpen(false)}
                        className="md:hidden p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                    <X size={18} />
                </button>
            </div>

            {/* Super admin badge */}
            <div className="mx-3 mt-3 flex items-center gap-2 bg-[var(--color-primary)]/8 border border-[var(--color-primary)]/15 rounded-xl px-3 py-2 shrink-0">
                <Crown size={13} className="text-[var(--color-primary)] shrink-0" />
                <span className="text-[10px] font-bold text-[var(--color-primary)] tracking-widest uppercase">Super Admin</span>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto py-3 px-2.5 scrollbar-thin space-y-0.5">
                <SectionLabel>Overview</SectionLabel>
                <NavItem href={`${BASE}/dashboard`} icon={LayoutDashboard} label="Dashboard" path={pathname} />
                <NavItem href={`${BASE}/analytics`} icon={BarChart3}       label="Analytics" path={pathname} />

                <SectionLabel>Tenants</SectionLabel>
                <NavItem href={`${BASE}/restaurants`} icon={Building2}  label="Restaurants" path={pathname} />
                <NavItem href={`${BASE}/payments`}    icon={CreditCard} label="Payments"    path={pathname} />

                <SectionLabel>Operations</SectionLabel>
                <NavItem href={`${BASE}/menus`}   icon={UtensilsCrossed} label="Menus"   path={pathname} />
                <NavItem href={`${BASE}/orders`}  icon={ShoppingBag}     label="Orders"  path={pathname} />
                <NavItem href={`${BASE}/takeout`} icon={Truck}           label="Takeout" path={pathname} />

                <SectionLabel>People</SectionLabel>
                <NavItem href={`${BASE}/staff`}  icon={Users} label="Staff"        path={pathname} />
                <NavItem href={`${BASE}/shifts`} icon={Clock} label="Staff Shifts" path={pathname} />

                <SectionLabel>Features</SectionLabel>
                <NavItem href={`${BASE}/pricing`}     icon={DollarSign} label="Pricing"      path={pathname} />
                <NavItem href={`${BASE}/loyalty`}     icon={Heart}      label="Loyalty"      path={pathname} />
                <NavItem href={`${BASE}/promos`}      icon={Tag}        label="Promos"       path={pathname} />
                <NavItem href={`${BASE}/ingredients`} icon={Package}    label="Ingredients"  path={pathname} />
                <NavItem href={`${BASE}/tables`}      icon={Grid3X3}    label="Tables & QR"  path={pathname} />

                <SectionLabel>Reporting</SectionLabel>
                <NavItem href={`${BASE}/reports`} icon={FileText} label="EOD Reports" path={pathname} />

                <SectionLabel>Platform</SectionLabel>
                <NavItem href={`${BASE}/config`} icon={Settings} label="Config" path={pathname} />
            </nav>

            {/* Footer */}
            <div className="px-2.5 py-3 border-t border-gray-100 shrink-0">
                <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition active:scale-95"
                >
                    <LogOut size={16} className="shrink-0" />
                    Sign Out
                </button>
            </div>
        </div>
    )

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="md:hidden fixed top-3 left-3 z-40 p-2 bg-white border border-gray-200 rounded-xl shadow-md text-gray-700 hover:bg-gray-50 active:scale-95 transition"
            >
                <Menu size={20} />
            </button>

            {isOpen && (
                <div className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setIsOpen(false)} />
            )}

            <aside className={`md:hidden fixed top-0 left-0 bottom-0 w-64 bg-white z-50 shadow-2xl transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                {content}
            </aside>

            <aside className="hidden md:block w-60 bg-white border-r border-gray-100 shrink-0 z-20 h-screen sticky top-0 overflow-hidden">
                {content}
            </aside>
        </>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="px-3 pt-4 pb-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
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
            className={`relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${
                isActive
                    ? 'bg-[var(--color-primary)]/8 text-[var(--color-primary)]'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
        >
            {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full bg-[var(--color-primary)]" />
            )}
            <Icon size={16} className={`shrink-0 ${isActive ? 'text-[var(--color-primary)]' : 'text-gray-400'}`} />
            {label}
        </Link>
    )
}
