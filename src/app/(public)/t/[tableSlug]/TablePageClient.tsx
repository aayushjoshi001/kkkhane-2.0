'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import HomepageGate from '@/components/customer/HomepageGate'
import type { MenuItem, MenuCategory } from '@/types/database'
import MenuSection from '@/components/customer/MenuSection'
import CartSummary from '@/components/customer/CartSummary'
import Logo from '@/components/shared/Logo'
import PhysicalMenuGallery from '@/components/customer/PhysicalMenuGallery'
import { TranslationProvider } from '@/lib/contexts/TranslationContext'
import { UtensilsCrossed, RefreshCw, Bell, Check, Loader2, Home, X, ShoppingBag, ChefHat, Search, CreditCard, UserCircle } from 'lucide-react'
import { useCartStore } from '@/lib/stores/cart'
import { requestSessionOpen } from '@/app/api/service-requests/actions'
import ActiveOrderPill from '@/components/customer/ActiveOrderPill'
import ServiceRequestPanel from '@/components/customer/ServiceRequestPanel'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { toast } from 'react-hot-toast'
import CustomerProfileSheet from '@/components/customer/CustomerProfileSheet'

interface TablePageClientProps {
    tableData: {
        id: string
        label: string
        qr_token: string
        restaurant_id: string
        restaurants: { name: string; slug?: string | null; logo_url: string | null; physical_menu_urls: string[] | null } | null
    }
    categories: MenuCategory[]
    menuItems: MenuItem[]
    comboItems: any[]
    sessionToken: string | undefined
    sessionUUID: string | undefined
    isValidSession: boolean
    serviceRequestsEnabled: boolean
    quickServeItems?: string[]
    // When true, a waiter must open the table session before guests can order.
    // When false (default), the session is auto-opened server-side on QR scan.
    waiterSessionEnabled?: boolean
    // Only relevant when waiterSessionEnabled: lets guests ring for the waiter to open it.
    selfOrderRequestEnabled?: boolean
    multiLanguageEnabled: boolean
    menuLayout?: 'grid' | 'list'
    translations: { language_code: string; entity_type: string; entity_id: string; translated_text: string }[]
    supportedLanguages: { code: string; name: string }[]
    isIpRestricted?: boolean
}

const PROMOS = [
    { id: 1, text: "🔥 Flat 10% off on all items! Use code: FLAT10", bg: "from-orange-500 to-amber-500", textCol: "text-white" },
    { id: 2, text: "🎉 Free drink on orders above Rs. 1,000!", bg: "from-red-500 to-rose-500", textCol: "text-white" },
    { id: 3, text: "✨ Happy hour combo deals live now!", bg: "from-indigo-600 to-purple-600", textCol: "text-white" }
]

function PromoBanner() {
    const [current, setCurrent] = useState(0)
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent(c => (c + 1) % PROMOS.length)
        }, 4000)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="h-16 relative w-full overflow-hidden flex items-center justify-center">
            {PROMOS.map((p, idx) => (
                <div
                    key={p.id}
                    className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-all duration-700 ${
                        idx === current
                            ? 'opacity-100 translate-y-0 scale-100'
                            : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
                    }`}
                >
                    <span className="text-[10px] text-orange-300 uppercase tracking-widest font-black mb-1 drop-shadow-sm">Featured Offer</span>
                    <p className="text-white text-xs font-black drop-shadow-md leading-snug max-w-[280px] uppercase tracking-wide">
                        {p.text}
                    </p>
                </div>
            ))}
        </div>
    )
}

export default function TablePageClient({
    tableData,
    categories,
    menuItems,
    comboItems,
    sessionToken,
    sessionUUID,
    serviceRequestsEnabled,
    quickServeItems = [],
    waiterSessionEnabled = false,
    selfOrderRequestEnabled = true,
    menuLayout = 'grid',
    translations,
    supportedLanguages,
    isIpRestricted = false,
}: TablePageClientProps) {
    // Live session state. In self-service mode the session is auto-opened server-side
    // and arrives via props. In waiter-managed mode it may arrive later (the waiter
    // opens it), so we poll and update this reactively.
    const [liveSessionToken, setLiveSessionToken] = useState(sessionToken)
    const [liveSessionUUID, setLiveSessionUUID] = useState(sessionUUID)
    const hasSession = !!liveSessionToken

    const [showMenu, setShowMenu] = useState(true)
    const [requestSent, setRequestSent] = useState(false)
    const [requestLoading, setRequestLoading] = useState(false)
    // Customers can dismiss the "waiting for waiter" popup to browse the menu in
    // view-only mode; a floating button brings it back to ring for service.
    const [popupDismissed, setPopupDismissed] = useState(false)
    // WiFi IP restriction states
    const [isRestricted, setIsRestricted] = useState(isIpRestricted)
    const [verifyingIp, setVerifyingIp] = useState(false)
    const [currentIp, setCurrentIp] = useState<string>('')
    const [isServiceOpen, setIsServiceOpen] = useState(false)
    const [showProfile, setShowProfile] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const searchParams = useSearchParams()
    const isWaiter = searchParams?.get('w') === '1'

    const totalItems = useHydratedStore(useCartStore, (s) => s.totalItems)
    const cartCount = totalItems ? totalItems() : 0

    const allOrders = useHydratedStore(useActiveOrders, (s) => s.orders) || []
    const currentTableOrders = allOrders.filter(o => o.slug === tableData.qr_token && o.type === 'dine_in' && (!o.sessionToken || o.sessionToken === liveSessionToken))

    const checkIpStatus = async () => {
        setVerifyingIp(true)
        try {
            const res = await fetch(`/api/verify-ip?restaurantId=${encodeURIComponent(tableData.restaurant_id)}&role=customer`, {
                cache: 'no-store'
            })
            if (res.ok) {
                const data = await res.json()
                if (data.clientIp) setCurrentIp(data.clientIp)
                // Self-service: the IP just became allowed but no session exists yet
                // (none was opened during the restricted SSR pass). Reload so the
                // server can auto-open the dining session and enable ordering.
                if (data.allowed && isRestricted && !waiterSessionEnabled && !hasSession) {
                    window.location.reload()
                    return
                }
                setIsRestricted(!data.allowed)
            }
        } catch {
            // Keep existing state if check fails
        } finally {
            setVerifyingIp(false)
        }
    }

    // Run a check on mount if restricted to load current IP for display
    useEffect(() => {
        if (isIpRestricted) {
            checkIpStatus()
        }
    }, [isIpRestricted])

    // Keep the Zustand cart store in sync with the live session so checkout always
    // sees a non-null sessionId regardless of how the session arrived.
    useEffect(() => {
        if (liveSessionToken) {
            useCartStore.getState().setSession(
                liveSessionToken,
                tableData.qr_token,
                tableData.restaurant_id,
            )
        }
    }, [liveSessionToken, tableData.qr_token, tableData.restaurant_id])

    const applySession = (token: string, uuid: string) => {
        setLiveSessionToken(token)
        setLiveSessionUUID(uuid)
    }

    // Fetch the active session for this table via a qr_token-gated server endpoint.
    const fetchActiveSession = async () => {
        try {
            const res = await fetch(
                `/api/session/active?table_id=${encodeURIComponent(tableData.id)}&qr_token=${encodeURIComponent(tableData.qr_token)}`,
                { cache: 'no-store' },
            )
            if (!res.ok) return false
            const { session } = await res.json()
            if (session?.session_token) {
                applySession(session.session_token, session.id)
                return true
            }
        } catch {
            // Transient network error — the polling interval will retry.
        }
        return false
    }

    // Waiter-managed mode only: poll every 3s while no session is detected, so the
    // page enables ordering within ~3s of a waiter opening the session (no refresh).
    // In self-service mode the session always arrives via props, so this never runs.
    useEffect(() => {
        if (!waiterSessionEnabled || hasSession) return
        fetchActiveSession()
        const timer = setInterval(fetchActiveSession, 3000)
        return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tableData.id, hasSession, waiterSessionEnabled])

    const restaurantName = tableData.restaurants?.name || 'Restaurant'
    const logoUrl = tableData.restaurants?.logo_url
    const restaurantSlug = tableData.restaurants?.slug

    // The blurred "waiting for waiter" gate is only shown in waiter-managed mode
    // when there is no active session yet.
    const showWaiterGate = waiterSessionEnabled && !hasSession

    const menuContent = (onBackToHome: (() => void) | null) => (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Sticky header — branded and curved bottom matching wireframe */}
            <header className="relative bg-[#FB6303] text-white rounded-b-[36px] sticky top-0 z-40 pb-6 pt-2 shadow-md flex flex-col gap-2">
                {/* Background image overlay container below the brand row (starts at top-[48px]) */}
                <div className="absolute inset-x-0 bottom-0 top-[48px] rounded-b-[36px] overflow-hidden z-0">
                    {/* Background image overlay for the advertisement portion */}
                    <div 
                        className="absolute inset-0 bg-cover bg-center filter brightness-[0.55] scale-105"
                        style={{ backgroundImage: `url('https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop')` }}
                    />
                    <div className="absolute inset-0 bg-[#FB6303]/15 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
                </div>

                <div className="max-w-2xl mx-auto w-full px-4 flex items-center justify-between gap-3 h-10 relative z-10">
                    {/* Left side: Restaurant logo + Restaurant name */}
                    <div className="flex items-center gap-2 shrink-0">
                        {logoUrl ? (
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-white shrink-0 border border-white/25 shadow-sm">
                                <Image src={logoUrl} alt={restaurantName} fill className="object-cover" sizes="32px" />
                            </div>
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 border border-white/25 shadow-sm">
                                <UtensilsCrossed size={14} className="text-white" />
                            </div>
                        )}
                        <div className="flex flex-col">
                            <span className="text-[8px] text-white/70 uppercase font-black tracking-wide leading-none">Restaurant</span>
                            <span className="text-xs font-black tracking-tight truncate max-w-[120px] leading-tight">
                                {restaurantName}
                            </span>
                        </div>
                    </div>

                    {/* Right side: profile button and platform logo */}
                    <div className="flex items-center gap-3 shrink-0 pr-1">
                        <button 
                            onClick={() => setShowProfile(true)}
                            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center shrink-0 border border-white/25 shadow-sm transition-colors"
                        >
                            <UserCircle size={18} className="text-white" />
                        </button>
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 border-2 border-white overflow-hidden relative shadow-sm">
                            <Image 
                                src="/brand/kkkhane-k-logo.jpg" 
                                alt="kkkhane" 
                                fill 
                                className="object-cover scale-[1.45]" 
                                sizes="32px"
                                priority 
                            />
                        </div>
                    </div>
                </div>
                
                {/* Advertisement Bar content */}
                <div className="w-full text-center pb-1 relative z-10">
                    <PromoBanner />
                </div>

                {/* Overlapping Pill Search Bar at bottom curve */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2 w-[85%] max-w-md z-30">
                    <div className="relative shadow-md rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-[#FB6303]" />
                        </div>
                        <input
                            type="text"
                            placeholder="SEARCH FOR ITEM..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="block w-full pl-10 pr-10 py-2.5 text-[11px] border-0 rounded-full bg-[#FFEAE0] text-[#7A3300] placeholder-[#D68E65] font-extrabold focus:outline-none focus:ring-2 focus:ring-orange-300 focus:bg-white transition-all text-center uppercase tracking-wider"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#FB6303] hover:text-orange-700"
                            >
                                <X className="h-4 w-4 stroke-[3px]" />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-0">
                {/* Waiter-managed mode: blurred fullscreen gate shown when there's no
                    active session. Dismissable so the guest can browse view-only. */}
                {showWaiterGate && !popupDismissed && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A1006]/40 backdrop-blur-md animate-fade-in">
                        <div className="relative bg-white p-6 rounded-3xl max-w-sm w-full border border-[#EDD9C8] shadow-2xl text-center flex flex-col items-center animate-scale-in">
                            <button
                                onClick={() => setPopupDismissed(true)}
                                aria-label="Dismiss and browse the menu"
                                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-[#F7F0E8] hover:bg-[#EDD9C8] flex items-center justify-center text-[#8C6A50] transition active:scale-95"
                            >
                                <X size={16} />
                            </button>
                            {logoUrl ? (
                                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-white border border-[#EDD9C8] mb-4 shadow-sm">
                                    <Image src={logoUrl} alt={restaurantName} fill className="object-cover" sizes="64px" />
                                </div>
                            ) : (
                                <div className="w-16 h-16 rounded-full bg-[#FFF0E6] flex items-center justify-center mb-4 border border-[#EDD9C8] shadow-sm">
                                    <UtensilsCrossed size={28} className="text-[#FB6303]" />
                                </div>
                            )}
                            <h2 className="font-black text-[#1A1006] text-lg mb-2">Welcome to {restaurantName}!</h2>
                            <p className="text-[#8C6A50] text-sm font-semibold mb-6 leading-relaxed">
                                Your waiter will open a session for Table {tableData.label} so you can place orders.
                            </p>
                            {!selfOrderRequestEnabled ? (
                                <p className="text-[#C4A882] text-[11px] font-bold flex items-center justify-center gap-1">
                                    <RefreshCw size={10} className="animate-spin text-[#FB6303]" />
                                    Waiting for your waiter to open the table...
                                </p>
                            ) : requestSent ? (
                                <div className="w-full bg-[#EBFDF2] border border-[#BFF3D4] rounded-2xl py-3 px-4 flex flex-col items-center justify-center gap-1.5 animate-scale-in">
                                    <span className="text-xl">🔔</span>
                                    <p className="text-green-600 text-xs font-black flex items-center gap-1">
                                        <Check size={14} className="stroke-[3px]" /> Waiter Notified!
                                    </p>
                                    <p className="text-green-600/70 text-[10px] font-bold">They'll be right with you.</p>
                                </div>
                            ) : (
                                <div className="w-full space-y-4">
                                    <button
                                        onClick={async () => {
                                            setRequestLoading(true)
                                            const res = await requestSessionOpen(tableData.id, tableData.restaurant_id)
                                            setRequestLoading(false)
                                            if (res.success || res.error?.includes('already')) setRequestSent(true)
                                        }}
                                        disabled={requestLoading}
                                        className="w-full flex items-center justify-center gap-2 text-sm font-black bg-[#FB6303] text-white py-3.5 rounded-2xl active:scale-95 transition disabled:opacity-60 shadow-md shadow-[#FB6303]/15"
                                    >
                                        {requestLoading ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
                                        Ring for Service
                                    </button>
                                    <p className="text-[#C4A882] text-[11px] font-bold flex items-center justify-center gap-1">
                                        <RefreshCw size={10} className="animate-spin text-[#FB6303]" />
                                        Waiting for session to open...
                                    </p>
                                </div>
                            )}

                            {/* Takeout / pickup escape hatch — lets a guest who scanned
                                the table QR self-order for pickup instead of waiting. */}
                            {restaurantSlug && (
                                <div className="w-full mt-5 pt-5 border-t border-[#EDD9C8]">
                                    <p className="text-[#C4A882] text-[11px] font-bold mb-3">Not dining in?</p>
                                    <Link
                                        href={`/takeout/${restaurantSlug}`}
                                        className="w-full flex items-center justify-center gap-2 text-sm font-black bg-white text-[#FB6303] border-2 border-[#FB6303] py-3.5 rounded-2xl active:scale-95 transition"
                                    >
                                        <ShoppingBag size={16} />
                                        Order Takeout / Pickup
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <CustomerProfileSheet 
                    isOpen={showProfile} 
                    onClose={() => setShowProfile(false)} 
                    restaurantId={tableData.restaurant_id}
                />

                {/* Floating re-summon button — shown after the guest dismisses the
                    waiter gate but still has no session. */}
                {showWaiterGate && popupDismissed && (
                    <button
                        onClick={() => setPopupDismissed(false)}
                        className="fixed bottom-16 right-4 z-40 flex items-center gap-2 bg-[#FB6303] text-white text-sm font-black pl-4 pr-5 py-3 rounded-full shadow-lg shadow-[#FB6303]/30 active:scale-95 transition animate-scale-in"
                    >
                        {requestSent
                            ? <><Check size={16} className="stroke-[3px]" /> Waiter notified</>
                            : <><Bell size={16} /> Ring for Service</>}
                    </button>
                )}

                <MenuSection
                    categories={categories}
                    items={menuItems}
                    comboItems={comboItems}
                    sessionId={liveSessionToken}
                    restaurantSlug={tableData.qr_token}
                    restaurantId={tableData.restaurant_id}
                    layout={menuLayout}
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                />

                <PhysicalMenuGallery
                    images={tableData.restaurants?.physical_menu_urls || []}
                    restaurantName={restaurantName}
                />
            </main>

            {/* Floating service-request panel — lets seated guests ring for water,
                a clean table, the bill, etc. once a session exists (no order required). */}
            {hasSession && liveSessionUUID && serviceRequestsEnabled && (
                <ServiceRequestPanel
                    sessionId={liveSessionUUID}
                    restaurantId={tableData.restaurant_id}
                    quickItems={quickServeItems}
                    isOpen={isServiceOpen}
                    onClose={() => setIsServiceOpen(false)}
                />
            )}

            {/* Fixed Bottom Navigation Bar */}
            <div 
                className="fixed bottom-0 left-0 right-0 z-40 bg-[#FB6303] text-white shadow-[0_-4px_16px_rgba(0,0,0,0.1)] px-4 py-1 flex items-center justify-around h-12 border-t border-orange-600/30"
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                {/* Home */}
                <button
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="flex flex-col items-center justify-center text-white/80 hover:text-white transition active:scale-95 w-16"
                >
                    <Home size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Home</span>
                </button>

                {/* Orders */}
                <button
                    onClick={() => {
                        const activeOrder = currentTableOrders && currentTableOrders.length > 0 ? currentTableOrders[currentTableOrders.length - 1] : null
                        if (activeOrder) {
                            window.location.href = `/t/${tableData.qr_token}/order/${activeOrder.id}`
                        } else {
                            toast.error("No active orders placed yet")
                        }
                    }}
                    className="flex flex-col items-center justify-center text-white/80 hover:text-white transition active:scale-95 w-16"
                >
                    <ChefHat size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Orders</span>
                </button>

                {/* Cart */}
                <Link
                    href={`/t/${tableData.qr_token}/cart${isWaiter ? '?w=1' : ''}`}
                    className="flex flex-col items-center justify-center text-white/80 hover:text-white transition active:scale-95 w-16 relative"
                >
                    {cartCount > 0 && (
                        <span className="absolute -top-1.5 right-3 bg-white text-[#FB6303] text-[9px] font-black rounded-full h-[18px] min-w-[18px] px-1 flex items-center justify-center ring-2 ring-[#FB6303]">
                            {cartCount}
                        </span>
                    )}
                    <ShoppingBag size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Cart</span>
                </Link>

                {/* Payment */}
                <Link
                    href={`/t/${tableData.qr_token}/checkout`}
                    className="flex flex-col items-center justify-center text-white/80 hover:text-white transition active:scale-95 w-16"
                >
                    <CreditCard size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Pay</span>
                </Link>
            </div>
        </div>
    )

    return (
        <TranslationProvider
            translations={translations}
            supportedLanguages={supportedLanguages}
            restaurantId={tableData.restaurant_id}
        >
            <HomepageGate
                restaurantId={tableData.restaurant_id}
                onProceed={() => setShowMenu(true)}
            >
                {({ backToHome }) => (
                    <>
                        {showMenu && menuContent(backToHome)}

                        {/* Non-dismissible WiFi Required overlay */}
                        {isRestricted && (
                            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-300">
                                <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-6 shadow-2xl">
                                    <div className="mx-auto w-14 h-14 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center text-rose-500 animate-pulse">
                                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11a13.92 13.92 0 01-2.048-6.978M12 11c0-3.517 1.009-6.799 2.753-9.571m3.44 2.04l-.054.09A13.916 13.916 0 0015 11c0 2.479.643 4.808 1.77 6.824M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>

                                    <div className="space-y-2">
                                        <h2 className="text-xl font-bold text-white tracking-tight">Restaurant WiFi Required</h2>
                                        <p className="text-slate-400 text-xs leading-relaxed">
                                            To browse our menu and place orders, please connect to the restaurant's local WiFi network.
                                        </p>
                                    </div>

                                    {currentIp && (
                                        <div className="bg-slate-950/40 rounded-xl p-3 border border-slate-800 flex justify-between items-center text-[10px]">
                                            <span className="text-slate-500">Your Current IP:</span>
                                            <span className="font-mono text-slate-300 font-medium">{currentIp}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={checkIpStatus}
                                        disabled={verifyingIp}
                                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-gradient-to-r from-rose-500 to-indigo-600 hover:from-rose-600 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-rose-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {verifyingIp ? (
                                            <>
                                                <Loader2 size={13} className="animate-spin" />
                                                Verifying connection…
                                            </>
                                        ) : (
                                            <>
                                                <RefreshCw size={13} />
                                                I am Connected
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </HomepageGate>
        </TranslationProvider>
    )
}
