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
import { UtensilsCrossed, RefreshCw, Bell, Check, Loader2, Home, X, ShoppingBag, ChefHat } from 'lucide-react'
import { useCartStore } from '@/lib/stores/cart'
import { requestSessionOpen } from '@/app/api/service-requests/actions'
import ActiveOrderPill from '@/components/customer/ActiveOrderPill'
import ServiceRequestPanel from '@/components/customer/ServiceRequestPanel'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { toast } from 'react-hot-toast'

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
        <div className="h-10 overflow-hidden relative flex items-center justify-center border-t border-gray-50 shadow-sm shrink-0">
            {PROMOS.map((p, idx) => (
                <div
                    key={p.id}
                    className={`absolute inset-0 flex items-center justify-center text-[11px] font-extrabold px-4 text-center transition-all duration-700 ${
                        idx === current
                            ? 'opacity-100 translate-y-0 scale-100'
                            : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
                    } bg-gradient-to-r ${p.bg} ${p.textCol}`}
                >
                    {p.text}
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
    const searchParams = useSearchParams()
    const isWaiter = searchParams?.get('w') === '1'

    const totalItems = useHydratedStore(useCartStore, (s) => s.totalItems)
    const cartCount = totalItems ? totalItems() : 0

    const orders = useHydratedStore(useActiveOrders, (s) => s.orders) || []

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
        <div className="min-h-screen bg-gray-50 pb-28">
            <ActiveOrderPill />
            {/* Sticky header — compact, restaurant-branded */}
            <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
                <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
                    {/* Left side: Restaurant logo (in circle format) + optional back button */}
                    <div className="flex items-center gap-2.5 shrink-0">
                        {onBackToHome && (
                            <button
                                onClick={onBackToHome}
                                aria-label="Back to homepage"
                                title="Back to homepage"
                                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center shrink-0 transition active:scale-95"
                            >
                                <Home size={14} className="text-[var(--color-secondary)]" />
                            </button>
                        )}
                        {logoUrl ? (
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gray-100 shrink-0 border border-gray-100 shadow-sm">
                                <Image src={logoUrl} alt={restaurantName} fill className="object-cover" sizes="32px" />
                            </div>
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0 border border-gray-100 shadow-sm">
                                <UtensilsCrossed size={14} className="text-[var(--color-primary)]" />
                            </div>
                        )}
                        <span className="text-sm font-bold text-gray-800 truncate max-w-[100px] md:max-w-[150px]">
                            {restaurantName}
                        </span>
                    </div>


                    {/* Right side: platform logo */}
                    <div className="flex items-center shrink-0 pr-2">
                        <Logo className="h-5" />
                    </div>
                </div>
                <PromoBanner />
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-4">
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

                {/* Floating re-summon button — shown after the guest dismisses the
                    waiter gate but still has no session. */}
                {showWaiterGate && popupDismissed && (
                    <button
                        onClick={() => setPopupDismissed(false)}
                        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 bg-[#FB6303] text-white text-sm font-black pl-4 pr-5 py-3 rounded-full shadow-lg shadow-[#FB6303]/30 active:scale-95 transition animate-scale-in"
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
                className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] px-4 py-2 flex items-center justify-around h-16"
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
                {/* Home */}
                <button
                    onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                    className="flex flex-col items-center justify-center text-gray-500 hover:text-[var(--color-primary)] transition active:scale-95 w-16"
                >
                    <Home size={18} className="stroke-[2.5px]" />
                    <span className="text-[10px] font-extrabold mt-1">Home</span>
                </button>

                {/* Orders */}
                <button
                    onClick={() => {
                        const activeOrder = orders && orders.length > 0 ? orders[orders.length - 1] : null
                        if (activeOrder) {
                            window.location.href = `/t/${tableData.qr_token}/order/${activeOrder.id}`
                        } else {
                            toast.error("No active orders placed yet")
                        }
                    }}
                    className="flex flex-col items-center justify-center text-gray-500 hover:text-[var(--color-primary)] transition active:scale-95 w-16"
                >
                    <ChefHat size={18} className="stroke-[2.5px]" />
                    <span className="text-[10px] font-extrabold mt-1">Orders</span>
                </button>

                {/* Cart */}
                <Link
                    href={`/t/${tableData.qr_token}/cart${isWaiter ? '?w=1' : ''}`}
                    className="flex flex-col items-center justify-center text-gray-500 hover:text-[var(--color-primary)] transition active:scale-95 w-16 relative"
                >
                    {cartCount > 0 && (
                        <span className="absolute -top-1.5 right-3.5 bg-[#FB6303] text-white text-[9px] font-black rounded-full h-4.5 min-w-[18px] px-1 flex items-center justify-center ring-2 ring-white">
                            {cartCount}
                        </span>
                    )}
                    <ShoppingBag size={18} className="stroke-[2.5px]" />
                    <span className="text-[10px] font-extrabold mt-1">Cart</span>
                </Link>

                {/* Call Waiter */}
                <button
                    onClick={() => setIsServiceOpen(prev => !prev)}
                    className={`flex flex-col items-center justify-center transition active:scale-95 w-16 ${
                        isServiceOpen ? 'text-[var(--color-primary)] font-black' : 'text-gray-500 hover:text-[var(--color-primary)]'
                    }`}
                >
                    <Bell size={18} className="stroke-[2.5px]" />
                    <span className="text-[10px] font-extrabold mt-1">Call Waiter</span>
                </button>
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
