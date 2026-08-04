'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import {
    Users, UtensilsCrossed, Settings, LogOut, BarChart3, Palette, Grid3X3,
    TrendingUp, ShoppingBag, Tag, Heart, DollarSign, Package,
    FileText, Truck, Clock, CreditCard, Sparkles, Sun, Moon, X,
    Bed, CalendarRange, Hotel, BookOpen, Wallet, Landmark, HandCoins, PenLine,
    AlertTriangle, Printer, Activity
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Logo from '@/components/shared/Logo'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useSidebar } from '@/lib/contexts/SidebarContext'
import SidebarShell from '@/components/admin/SidebarShell'
import { useFeatures, useFeatureEnabled, useBusinessMode } from '@/lib/contexts/FeatureContext'
import { generatedAvatar, isGeneratedAvatar } from '@/lib/avatar'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export default function AdminSidebar({ userRole, restaurantName, userAvatar }: { userRole?: string; restaurantName?: string; userAvatar?: string }) {
    const pathname = usePathname()
    const router = useRouter()
    const { closeMobile } = useSidebar()
    const [isDark, setIsDark] = useState(true) // Defaulting to the dark premium vibe
    const [imgError, setImgError] = useState(false)
    // Every flag resolves through useFeatureEnabled, which shares the absent-key
    // defaults (DEFAULT_ON_FEATURES / MODULE_DEFAULT_ON) with the server's
    // getRestaurantFeatures. These used to be hand-written `?? true` fallbacks
    // guarded by a comment saying the hook read a missing key as off — that
    // stopped being true when the hook learned the shared default list, and the
    // local copies were then a second table of defaults that nothing kept in
    // step with the first. The nav decides what a tenant can see, so it must
    // reach the same answer as the page gate behind each link.
    const features = useFeatures()
    const dineInEnabled = useFeatureEnabled('dineInEnabled')
    const financeEnabled = useFeatureEnabled('financeEnabled')
    const manualEntryEnabled = useFeatureEnabled('manualEntryEnabled')
    const promosEnabled = useFeatureEnabled('promosEnabled')
    const loyaltyEnabled = useFeatureEnabled('loyaltyEnabled')
    const takeoutEnabled = useFeatureEnabled('takeoutEnabled')
    const dynamicPricingEnabled = useFeatureEnabled('dynamicPricingEnabled')
    const ingredientTrackingEnabled = useFeatureEnabled('ingredientTrackingEnabled')
    const staffShiftsEnabled = useFeatureEnabled('staffShiftsEnabled')
    const staffManagementEnabled = useFeatureEnabled('staffManagementEnabled')
    const tableManagementEnabled = useFeatureEnabled('tableManagementEnabled')
    const businessMode = useBusinessMode()
    const isHotel = businessMode === 'hotel'

    // Load theme preference on mount. Effect rather than a lazy useState
    // initialiser because localStorage does not exist during the server render.
    useEffect(() => {
        const storedTheme = localStorage.getItem('srms-theme')
        const nextIsDark = storedTheme !== 'light'
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsDark(nextIsDark)
        document.documentElement.classList.toggle('dark', nextIsDark)
    }, [])

    const handleSignOut = () => signOutAndRedirect(router)
    
    const toggleTheme = () => {
        const newIsDark = !isDark
        setIsDark(newIsDark)
        localStorage.setItem('srms-theme', newIsDark ? 'dark' : 'light')
        if (newIsDark) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }

    const roleLabel = (userRole || 'admin').replace(/_/g, ' ')
    // Use DiceBear Notionists style for a premium placeholder if no avatar provided
    const avatarUrl = userAvatar || generatedAvatar(roleLabel)

    // Rendered once per frame by SidebarShell — the drawer always gets
    // `isCollapsed: false`, since collapsing is a desktop-only affordance.
    const renderContent = (isCollapsed: boolean) => (
        <div className={cn(
            "flex flex-col h-full relative overflow-hidden transition-colors duration-500",
            isDark ? "bg-[#0a0a0a] text-white/70" : "bg-[#f8f9fa] text-ink-muted border-r border-hairline-strong"
        )}>
            {/* Ambient Background Glow (Only in Dark Mode) */}
            {isDark && (
                <>
                    <div className="absolute top-[-10%] left-[-20%] w-[300px] h-[300px] bg-brand-500 opacity-10 blur-[100px] rounded-full pointer-events-none" />
                    <div className="absolute bottom-[-10%] right-[-20%] w-[300px] h-[300px] bg-blue-500 opacity-10 blur-[100px] rounded-full pointer-events-none" />
                </>
            )}

            {/* Header / Logo */}
            <div className={cn("py-6 flex items-center shrink-0 relative z-10 transition-all duration-300", isCollapsed ? "px-0 justify-center" : "px-6 justify-between gap-3")}>
                <div className={cn("flex items-center min-w-0", isCollapsed ? "justify-center" : "gap-3")}>
                    <Logo variant="dark" className={cn("shrink-0", isDark ? "h-7" : "h-7")} />
                    {!isCollapsed && (
                        <div className="min-w-0 flex flex-col justify-center transition-all duration-300 opacity-100">
                            <p className={cn("text-base font-extrabold truncate leading-none tracking-tight", isDark ? "text-white" : "text-ink")}>
                                {restaurantName || 'kkkhane'}
                            </p>
                            <p className="text-[10px] font-bold text-brand-500 uppercase tracking-[0.2em] mt-1.5">
                                Workspace
                            </p>
                        </div>
                    )}
                </div>
                <button onClick={closeMobile}
                        type="button"
                        aria-label="Close navigation menu"
                        className={cn(
                            // 44px tap target; `p-2` around an 18px icon was 34px.
                            "md:hidden -mr-2 inline-flex items-center justify-center min-w-11 min-h-11 rounded-xl transition-colors",
                            isDark ? "text-white/50 hover:text-white hover:bg-surface/10" : "text-ink-subtle hover:text-ink hover:bg-surface-muted"
                        )}>
                    <X size={20} />
                </button>
            </div>

            {/* Navigation */}
            <nav className={cn("flex-1 overflow-y-auto overscroll-contain py-2 scrollbar-none space-y-1 relative z-10", isCollapsed ? "px-2" : "px-4")}>
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/dashboard"     icon={BarChart3}       label="Overview"        path={pathname} />
                {financeEnabled && manualEntryEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/manual-entry"  icon={PenLine}         label="Manual Entry"    path={pathname} />}
                <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Alerts & Status</SectionLabel>
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/critical"      icon={AlertTriangle}   label="Critical Center" path={pathname} />
                {isHotel ? (
                    <>
                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Hospitality</SectionLabel>
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/rooms"     icon={Bed}             label="Rooms & Suites"  path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/bookings"  icon={CalendarRange}   label="Bookings History"        path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/orders"    icon={ShoppingBag}     label="Service Orders History"  path={pathname} />
                        {features.irdSyncEnabled && userRole !== 'manager' && (
                            <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/payments"  icon={CreditCard}      label="Room Billing"    path={pathname} />
                        )}

                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Menu & Catalog</SectionLabel>
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/menu"        icon={UtensilsCrossed} label="Menu Catalog"    path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/combos"      icon={Sparkles}        label="Combo Offers"    path={pathname} />
                        {dynamicPricingEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/pricing"     icon={DollarSign}      label="Dynamic Pricing" path={pathname} />}
                        {promosEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/promos"      icon={Tag}             label="Promo Codes"     path={pathname} />}
                        {tableManagementEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/tables"      icon={Grid3X3}         label="Tables & QR"     path={pathname} />}

                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Intelligence</SectionLabel>
                        {financeEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/reports"     icon={FileText}        label="EOD Reports"     path={pathname} />}
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/analytics"   icon={TrendingUp}      label="Analytics"       path={pathname} />
                    </>
                ) : (
                    <>
                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Menu & Catalog</SectionLabel>
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/menu"        icon={UtensilsCrossed} label="Menu Catalog"    path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/combos"      icon={Sparkles}        label="Combo Offers"    path={pathname} />
                        {dynamicPricingEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/pricing"     icon={DollarSign}      label="Dynamic Pricing" path={pathname} />}
                        {promosEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/promos"      icon={Tag}             label="Promo Codes"     path={pathname} />}
                        {/* Same rule and same section as the hotel branch above,
                            and the same rule as the page behind it
                            (admin/tables/page.tsx gates on tableManagementEnabled
                            alone). This link used to additionally require
                            dineInEnabled while the hotel branch and the page did
                            not — three rules for one destination, so a hotel saw
                            the link with dine-in off, a delivery-only restaurant
                            had it hidden yet could still open the page by URL,
                            and turning dine-in off looked like it removed a
                            module it does not own. Whether a tenant lays out
                            tables is tableManagementEnabled's question; whether
                            guests order from them at the table is dineInEnabled's,
                            and that gates Live Orders below, not this. */}
                        {tableManagementEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/tables"      icon={Grid3X3}         label="Tables & QR"     path={pathname} />}

                        {(dineInEnabled || takeoutEnabled) && (
                            <>
                                <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Live Operations</SectionLabel>
                                {/* No badge until it can show a real count — this
                                    read `badge="12"` unconditionally, so every
                                    restaurant saw "12 live orders" forever. */}
                                {dineInEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/orders"      icon={ShoppingBag}     label="Live Orders"     path={pathname} />}
                                {dineInEnabled && features.irdSyncEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/payments"    icon={CreditCard}      label="Payments"        path={pathname} />}
                                {takeoutEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/takeout"     icon={Truck}           label="Takeout & Disp." path={pathname} />}
                            </>
                        )}
                        
                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Intelligence</SectionLabel>
                        {loyaltyEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/loyalty"     icon={Heart}           label="Loyalty Program" path={pathname} />}
                        {financeEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/reports"     icon={FileText}        label="EOD Reports"     path={pathname} />}
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/analytics"   icon={TrendingUp}      label="Analytics"       path={pathname} />
                    </>
                )}

                {(ingredientTrackingEnabled || staffManagementEnabled || staffShiftsEnabled || financeEnabled) && (
                    <>
                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Operations</SectionLabel>
                        {ingredientTrackingEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/ingredients" icon={Package}         label="Inventory"       path={pathname} />}
                        {staffManagementEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/staff"       icon={Users}           label="Staff Members"   path={pathname} />}
                        {financeEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/suppliers"   icon={Truck}           label="Suppliers Ledger" path={pathname} />}
                        {staffShiftsEnabled && <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/shifts"      icon={Clock}           label="Schedule"        path={pathname} />}
                    </>
                )}

                {financeEnabled && (
                    <>
                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Ledgers</SectionLabel>
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/day-book"    icon={BookOpen}        label="Day Book"        path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/cash-book"   icon={Wallet}          label="Cash Book"       path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/bank-book"   icon={Landmark}        label="Bank Book"       path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/bank-ledger" icon={Landmark}        label="Bank Ledger"     path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/vouchers"    icon={FileText}        label="Vouchers Ledger" path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/customers"   icon={HandCoins}       label="Customers Ledger" path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/income-expenses" icon={TrendingUp}  label="Income & Expenses" path={pathname} />
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/activities" icon={Activity} label="Activities Log" path={pathname} />

                        <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Finance</SectionLabel>
                        <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/finance"     icon={Wallet}          label="Finance"         path={pathname} />
                    </>
                )}

                <SectionLabel isDark={isDark} isCollapsed={isCollapsed}>Settings</SectionLabel>
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/homepage"    icon={Palette}         label="Homepage Setup"  path={pathname} />
                {features.irdSyncEnabled && (
                    <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/reconciliation" icon={Users}        label="Partner Linking" path={pathname} />
                )}
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/theme"       icon={Palette}         label="Brand & Theme"   path={pathname} />
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/printers"    icon={Printer}         label="Printers"        path={pathname} />
                <NavItem isDark={isDark} isCollapsed={isCollapsed} href="/admin/settings"    icon={Settings}        label="Settings"        path={pathname} />
                
                <div className="h-4" /> {/* Bottom padding */}
            </nav>

            {/* Footer Profile & Theme Toggle */}
            <div className={cn("p-4 relative z-10 shrink-0", isCollapsed && "p-2 flex flex-col gap-2 items-center")}>
                <Link href="/admin/profile" className={cn(
                    "flex items-center rounded-2xl transition-all duration-300 group cursor-pointer backdrop-blur-md",
                    isCollapsed ? "flex-col p-2 gap-2" : "gap-3 p-3",
                    isDark 
                        ? "bg-surface/5 border border-white/10 hover:bg-surface/10" 
                        : "bg-surface border border-hairline-strong hover:border-hairline-strong hover:shadow-sm"
                )}>
                    {/* User Avatar */}
                    <div className={cn("rounded-xl overflow-hidden shrink-0 border border-black/5 shadow-sm relative", isCollapsed ? "w-8 h-8" : "w-10 h-10")}>
                        {imgError ? (
                            <div className="w-full h-full bg-brand-500 flex items-center justify-center text-white font-bold">
                                {roleLabel.charAt(0).toUpperCase()}
                            </div>
                        ) : (
                            <Image 
                                src={avatarUrl}
                                alt="User avatar"
                                fill
                                sizes="40px"
                                unoptimized={isGeneratedAvatar(avatarUrl)}
                                className="object-cover"
                                onError={() => setImgError(true)}
                            />
                        )}
                    </div>
                    
                    {!isCollapsed && (
                        <div className="flex-1 min-w-0 transition-opacity duration-300 opacity-100">
                            <p className={cn("text-sm font-bold truncate capitalize", isDark ? "text-white" : "text-ink")}>
                                {roleLabel}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                                </span>
                                <p className={cn("text-[11px] font-medium truncate", isDark ? "text-white/50" : "text-ink-subtle")}>
                                    System Online
                                </p>
                            </div>
                        </div>
                    )}

                    <div className={cn(
                        "flex items-center gap-1 transition-opacity", 
                        isCollapsed ? "flex-col opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    )}>
                        <button 
                            onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
                            className={cn(
                                "p-2 rounded-xl transition-all",
                                isDark 
                                    ? "text-white/40 hover:text-white hover:bg-surface/10" 
                                    : "text-ink-subtle hover:text-ink hover:bg-surface-muted"
                            )}
                            title="Toggle Theme"
                        >
                            {isDark ? <Sun size={16} /> : <Moon size={16} />}
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleSignOut(); }}
                            className={cn(
                                "p-2 rounded-xl transition-all",
                                isDark 
                                    ? "text-white/40 hover:text-red-400 hover:bg-red-500/10" 
                                    : "text-ink-subtle hover:text-red-500 hover:bg-red-50"
                            )}
                            title="Sign Out"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </Link>
            </div>
        </div>
    )

    return <SidebarShell renderContent={renderContent} tone={isDark ? 'dark' : 'light'} />
}

function SectionLabel({ children, isDark, isCollapsed }: { children: React.ReactNode, isDark: boolean, isCollapsed: boolean }) {
    if (isCollapsed) {
        return (
            <div className="py-4 flex justify-center">
                <div className={cn("w-6 h-[1px]", isDark ? "bg-surface/10" : "bg-surface-muted")} />
            </div>
        )
    }
    return (
        <p className={cn(
            "px-4 pt-6 pb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] flex items-center gap-2",
            isDark ? "text-white/30" : "text-ink-subtle"
        )}>
            {children}
        </p>
    )
}

function NavItem({ href, icon: Icon, label, path, badge, isDark, isCollapsed }: { href: string; icon: React.ElementType; label: string; path: string; badge?: string; isDark: boolean; isCollapsed: boolean }) {
    const isActive = path === href || path.startsWith(`${href}/`)
    return (
        <Link
            href={href}
            prefetch={true}
            title={isCollapsed ? label : undefined}
            className={cn(
                // Colour and background carry the state; the row itself stays put.
                // It used to scale 1.02 and shift 4px right on both hover and
                // active, so the list nudged sideways under a moving finger and
                // the scaled row's edge fought the panel's rounded corner.
                "group relative flex items-center px-4 h-11 rounded-2xl text-[14px] font-semibold",
                "transition-colors duration-200 motion-reduce:transition-none",
                isCollapsed ? "justify-center" : "justify-between",
                isActive
                    ? isDark
                        ? "bg-gradient-to-r from-brand-500 to-[#ff7a00] text-white shadow-[0_2px_10px_-2px_rgba(255,90,0,0.45)]"
                        : "bg-brand-500/10 text-brand-600 border border-brand-500/20"
                    : isDark
                        // /60 on near-black is about 3.4:1 — under the 4.5:1 floor
                        // for the smaller text this nav uses.
                        ? "text-white/75 hover:bg-white/5 hover:text-white"
                        : "text-ink-subtle hover:bg-surface-muted hover:text-ink"
            )}
        >
            <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3.5")}>
                <Icon size={isCollapsed ? 20 : 18} className={cn(
                    "shrink-0 transition-all duration-300", 
                    isActive 
                        ? isDark ? "text-white" : "text-brand-500" 
                        : isDark ? "text-white/40 group-hover:text-white/80" : "text-ink-subtle group-hover:text-ink-muted"
                )} />
                {!isCollapsed && <span>{label}</span>}
            </div>
            {!isCollapsed && badge && (
                <span className={cn(
                    "px-2 py-0.5 text-[10px] font-extrabold rounded-full tabular-nums shadow-sm transition-all duration-300",
                    isActive 
                        ? isDark ? "bg-surface text-brand-500" : "bg-brand-500 text-white"
                        : isDark ? "bg-brand-500 text-white group-hover:shadow-[0_0_10px_rgba(255,90,0,0.5)]" : "bg-surface-muted text-ink-muted"
                )}>
                    {badge}
                </span>
            )}
            {/* Dot indicator for collapsed active state with badge */}
            {isCollapsed && badge && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-500 border-2 border-[#0a0a0a]" />
            )}
        </Link>
    )
}
