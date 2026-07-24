import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import RowLink from '@/components/admin/RowLink'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { formatCurrency, NEPAL_TZ } from '@/lib/utils'
import { cookies } from 'next/headers'
import { CALENDAR_COOKIE, formatDateShort, parseCalendar, type Calendar } from '@/lib/calendar'
import {
    TrendingUp, ShoppingBag, Users, AlertTriangle, Clock, UserCheck,
    ArrowRight, CheckCircle2, ChevronRight, UtensilsCrossed, QrCode, Tag, ClipboardList, Boxes, Inbox,
    Rocket, BarChart3, Receipt, Wallet, MoreHorizontal, Bed, CalendarRange, Hotel, Settings
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import EmptyState from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/Badge'
import { StatCardSkeleton, RowSkeleton } from '@/components/ui/Skeleton'
import { getBusinessMode } from '@/lib/businessMode'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

type Money = (amount: number) => string

export default async function AdminDashboardPage() {
    const currentUser = await getCurrentUser()
    if (currentUser.role === 'super_admin') redirect('/admin/super-admin/dashboard')
    const { restaurantId } = currentUser
    // Server component: the user's calendar choice arrives by cookie, so these
    // server-rendered dates match what the client would render.
    const calendar = parseCalendar((await cookies()).get(CALENDAR_COOKIE)?.value)
    const features = await getRestaurantFeatures(restaurantId)

    // One fast, single-row query gates the whole shell — everything else below
    // streams in independently instead of blocking on 13 queries up front.
    const adminSupabase = await createAdminClient()
    const [restaurantSettingsRes, restaurantRes, turnoverRes] = await Promise.all([
        adminSupabase
            .from('settings')
            .select('business_hours, features_v2')
            .eq('restaurant_id', restaurantId)
            .maybeSingle(),
        adminSupabase
            .from('restaurants')
            .select('business_type, vat_registered')
            .eq('id', restaurantId)
            .single(),
        adminSupabase
            .from('income_entries')
            .select('amount')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'posted')
    ])

    const restaurantSettings = restaurantSettingsRes.data
    const restaurant = restaurantRes.data
    const businessMode = restaurant?.business_type ? getBusinessMode(restaurant.business_type) : 'dine_in'
    const isHotel = businessMode === 'hotel'

    const totalTurnover = (turnoverRes.data || []).reduce((sum, r) => sum + Number(r.amount), 0)
    const showVatWarning = totalTurnover > 2000000 && !restaurant?.vat_registered

    const currencyFeatures = restaurantSettings?.features_v2 as { currency?: string; currencySymbol?: string | null; dineInEnabled?: boolean } | null
    const money: Money = (amount) => formatCurrency(amount, currencyFeatures?.currency, currencyFeatures?.currencySymbol)
    // Same safe default as elsewhere — restaurants provisioned before this flag
    // existed have no dineInEnabled key in their stored features_v2.
    const dineInEnabled = currencyFeatures?.dineInEnabled ?? true

    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const name = currentUser.email.split('@')[0]

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            {/* Every section below is a separate server-side aggregate, so this
                refreshes on a long fuse — the numbers should track service, not
                re-run a dozen counts per order during a dinner rush. */}
            <RealtimeRefresh
                restaurantId={restaurantId}
                tables={isHotel ? ['orders', 'sessions', 'rooms', 'bookings'] : ['orders', 'sessions']}
                debounceMs={5000}
            />
            {/* Premium Header */}
            <div className="relative overflow-hidden rounded-[2rem] bg-[#0a0a0a] text-white p-8 sm:p-12 shadow-2xl animate-fade-up">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-brand-500 opacity-20 blur-[120px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500 opacity-20 blur-[100px] rounded-full -translate-x-1/3 translate-y-1/4 pointer-events-none" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/10 backdrop-blur-md border border-white/10 mb-6 text-sm font-medium text-white/90">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                            </span>
                            Live Dashboard
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 leading-tight">
                            {greeting}, <span className="capitalize">{name}</span>.
                        </h1>
                        <p className="text-white/60 text-[16px] max-w-xl leading-relaxed">
                            Here&apos;s what&apos;s happening at your {isHotel ? 'hotel' : 'restaurant'} today.
                        </p>
                    </div>
                    <div className="shrink-0 flex flex-wrap gap-3">
                        <Link href="/admin/orders" className="bg-brand-500 hover:bg-brand-600 text-white px-7 py-3.5 rounded-[16px] font-semibold transition-all duration-300 hover:scale-105 shadow-[0_0_20px_rgba(255,90,0,0.3)] hover:shadow-[0_0_30px_rgba(255,90,0,0.5)] flex items-center gap-2">
                            <ShoppingBag size={18} /> View {isHotel ? 'Room Service' : 'Orders'}
                        </Link>
                    </div>
                </div>
            </div>

            {showVatWarning && (
                <div className="p-6 bg-rose-50/70 border border-rose-100 rounded-[2rem] flex items-start gap-4 animate-fade-up shadow-sm">
                    <AlertTriangle className="text-rose-600 shrink-0 w-5 h-5 mt-0.5 animate-bounce" />
                    <div className="space-y-1 text-left">
                        <h4 className="font-extrabold text-sm text-rose-900">⚠️ Mandatory VAT Registration Warning (Inland Revenue Department Compliance)</h4>
                        <p className="text-xs text-rose-700 leading-relaxed font-semibold">
                            Your sales turnover has reached <strong className="text-rose-900">{money(totalTurnover)}</strong>, which exceeds the Inland Revenue Department (IRD) mandatory VAT threshold of <strong className="text-rose-900">Rs. 20 Lakhs</strong>. According to IRD regulations, your business is required to register for VAT.
                        </p>
                        <div className="pt-1.5 flex gap-3 text-xs">
                            <Link href="/admin/finance/tax" className="font-extrabold text-rose-900 underline hover:text-rose-950 flex items-center gap-1">
                                Update Tax Settings & Configure VAT
                                <ChevronRight size={14} />
                            </Link>
                        </div>
                    </div>
                </div>
            )}

            {/* KPI Cards — own query, own boundary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <Suspense fallback={<KpiGridSkeleton />}>
                    <KpiCardsSection restaurantId={restaurantId} money={money} isHotel={isHotel} />
                </Suspense>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Suspense fallback={<PipelineCardSkeleton />}>
                        <PipelineTableSection restaurantId={restaurantId} money={money} isHotel={isHotel} calendar={calendar} />
                    </Suspense>

                    <Suspense fallback={null}>
                        {!isHotel && (
                            <OnboardingChecklistSection
                                restaurantId={restaurantId}
                                dineInEnabled={dineInEnabled}
                                hasBusinessHours={!!restaurantSettings?.business_hours}
                            />
                        )}
                    </Suspense>
                </div>

                <div className="space-y-6">
                    <Suspense fallback={null}>
                        {!isHotel && <LowStockAlertSection restaurantId={restaurantId} />}
                    </Suspense>

                    {/* Quick Actions Grid — static; only the Promotions badge needs a query */}
                    <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <h3 className="text-[1.15rem] font-bold text-ink mb-5 flex items-center gap-2">
                            <Rocket size={18} className="text-brand-500" /> Quick Actions
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            {isHotel ? (
                                <>
                                    <QuickAction href="/admin/rooms" icon={Bed} label="Edit Rooms" />
                                    <QuickAction href="/admin/bookings" icon={CalendarRange} label="Bookings" />
                                    {features?.irdSyncEnabled && (
                                        <QuickAction href="/admin/payments" icon={Receipt} label="Room Billing" />
                                    )}
                                    <QuickAction href="/admin/staff" icon={Users} label="Manage Staff" />
                                    <QuickAction href="/admin/reports" icon={BarChart3} label="Reports" />
                                    <QuickAction href="/admin/settings" icon={Settings} label="Settings" />
                                </>
                            ) : (
                                <>
                                    <QuickAction href="/admin/menu" icon={UtensilsCrossed} label="Edit Menu" />
                                    <QuickAction href="/admin/tables" icon={QrCode} label="Tables & QR" />
                                    <Suspense fallback={<QuickAction href="/admin/promos" icon={Tag} label="Promotions" />}>
                                        <PromoQuickAction restaurantId={restaurantId} />
                                    </Suspense>
                                    <QuickAction href="/admin/staff" icon={Users} label="Manage Staff" />
                                    <QuickAction href="/admin/ingredients" icon={Boxes} label="Inventory" />
                                    <QuickAction href="/admin/reports" icon={BarChart3} label="Reports" />
                                </>
                            )}
                        </div>
                    </div>

                    <Suspense fallback={<ActiveStaffCardSkeleton />}>
                        <ActiveStaffSection restaurantId={restaurantId} />
                    </Suspense>
                </div>
            </div>
        </div>
    )
}

async function KpiCardsSection({ restaurantId, money, isHotel = false }: { restaurantId: string; money: Money; isHotel?: boolean }) {
    const adminSupabase = await createAdminClient()
    const now = new Date().toISOString()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
        ordersCountRes,
        sessionsCountRes,
        todayOrdersRes,
        activeShiftCountRes,
    ] = await Promise.all([
        adminSupabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('sessions').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'active'),
        adminSupabase.from('orders').select('total_amount, status').eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('staff_shifts').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).is('clock_out', null),
    ])

    const totalOrdersToday = ordersCountRes.count || 0
    const activeSessionCount = sessionsCountRes.count || 0
    const todayOrders = todayOrdersRes.data || []
    const activeShiftCount = activeShiftCountRes.count || 0

    const totalRevenueToday = todayOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total_amount || 0), 0)

    if (isHotel) {
        let occupiedRooms = 0
        let totalRooms = 0
        let checkedInBookings = 0
        try {
            const [roomsOcc, roomsTotal, bookingsActive] = await Promise.all([
                adminSupabase.from('rooms').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'occupied'),
                adminSupabase.from('rooms').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
                adminSupabase.from('bookings').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'checked_in')
            ])
            occupiedRooms = roomsOcc.count || 0
            totalRooms = roomsTotal.count || 0
            checkedInBookings = bookingsActive.count || 0
        } catch (e) {}

        return (
            <>
                <KpiCard title="Revenue Today" value={money(totalRevenueToday)} icon={Wallet} trend="Room service + POS" trendUp={true} color="brand" />
                <KpiCard title="Checked In" value={String(checkedInBookings)} icon={UserCheck} trend="Active stays" trendUp={true} color="blue" />
                <KpiCard title="Occupancy" value={`${occupiedRooms}/${totalRooms}`} icon={Bed} trend="Occupied / Total" trendUp={true} color="green" />
                <KpiCard title="Staff On Shift" value={String(activeShiftCount || 0)} icon={Clock} trend="Clocked in right now" trendUp={true} color="purple" />
            </>
        )
    }

    return (
        <>
            <KpiCard title="Revenue Today" value={money(totalRevenueToday)} icon={Wallet} trend="+12% from yesterday" trendUp={true} color="brand" />
            <KpiCard title="Orders Today" value={String(totalOrdersToday || 0)} icon={Receipt} trend="Active pipeline" trendUp={true} color="blue" />
            <KpiCard title="Active Tables" value={String(activeSessionCount || 0)} icon={Users} trend="Currently occupied" trendUp={true} color="green" />
            <KpiCard title="Staff On Shift" value={String(activeShiftCount || 0)} icon={Clock} trend="Clocked in right now" trendUp={true} color="purple" />
        </>
    )
}

function KpiGridSkeleton() {
    return (
        <>
            <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
        </>
    )
}

async function PipelineTableSection({ restaurantId, money, isHotel = false, calendar }: { restaurantId: string; money: Money; isHotel?: boolean; calendar: Calendar }) {
    const adminSupabase = await createAdminClient()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (isHotel) {
        let recentBookings: any[] = []
        try {
            const { data } = await adminSupabase
                .from('bookings')
                .select('id, guest_name, check_in, check_out, status, total_amount, rooms(room_number)')
                .eq('restaurant_id', restaurantId)
                .order('created_at', { ascending: false })
                .limit(8)
            recentBookings = data || []
        } catch (e) {}

        const bookingPipeline = { pending: 0, checked_in: 0, checked_out: 0, cancelled: 0 }
        for (const b of recentBookings) {
            const s = b.status as keyof typeof bookingPipeline
            if (s in bookingPipeline) bookingPipeline[s]++
        }

        return (
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-muted/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand-500/10 rounded-xl text-brand-500">
                            <CalendarRange size={20} />
                        </div>
                        <h2 className="text-[1.15rem] font-bold text-ink">Recent Bookings</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2 rounded-xl border border-hairline shadow-sm">
                        <PipelineBadge label="Pending" count={bookingPipeline.pending} color="yellow" />
                        <PipelineBadge label="Checked In" count={bookingPipeline.checked_in} color="blue" />
                        <PipelineBadge label="Checked Out" count={bookingPipeline.checked_out} color="green" />
                    </div>
                </div>

                <div className="p-0 overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                            <tr className="text-[12px] uppercase tracking-wider font-semibold text-ink-subtle bg-surface-muted/30">
                                <th className="px-6 py-4 border-b border-hairline">Guest Name</th>
                                <th className="px-6 py-4 border-b border-hairline">Room</th>
                                <th className="px-6 py-4 border-b border-hairline">Stay Dates</th>
                                <th className="px-6 py-4 border-b border-hairline">Status</th>
                                <th className="px-6 py-4 border-b border-hairline text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {recentBookings.map(booking => {
                                const roomNumber = (booking.rooms as unknown as { room_number: string } | null)?.room_number || '—'
                                const chIn = new Date(booking.check_in)
                                const chOut = new Date(booking.check_out)
                                const checkInDate = formatDateShort(chIn, calendar)
                                const checkOutDate = formatDateShort(chOut, calendar)
                                return (
                                    <RowLink key={booking.id} href={`/admin/bookings?booking=${booking.id}`} className="group">
                                        <td className="px-6 py-4">
                                            <span className="font-bold text-ink group-hover:text-brand-500 transition-colors">{booking.guest_name}</span>
                                        </td>
                                        <td className="px-6 py-4 text-[14px] text-ink-subtle font-medium">
                                            Room {roomNumber}
                                        </td>
                                        <td className="px-6 py-4 text-[13px] text-ink-subtle font-medium">
                                            {checkInDate} - {checkOutDate}
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={booking.status === 'checked_in' ? 'ready' : booking.status === 'checked_out' ? 'delivered' : booking.status} />
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[15px] font-bold text-ink tabular">{money(booking.total_amount)}</span>
                                        </td>
                                    </RowLink>
                                )
                            })}
                        </tbody>
                    </table>
                    {recentBookings.length === 0 && (
                        <div className="p-10">
                            <EmptyState icon={CalendarRange} title="No bookings yet" description="All room reservations will show up here." />
                        </div>
                    )}
                </div>
                <div className="bg-surface-muted/50 px-6 py-4 border-t border-hairline text-center">
                    <Link href="/admin/bookings" className="text-[14px] font-semibold text-brand-500 hover:text-[#e04f00] flex items-center justify-center gap-1.5 transition-colors">
                        View all bookings <ArrowRight size={16} />
                    </Link>
                </div>
            </div>
        )
    }

    const [{ data: todayOrders }, { data: recentOrders }] = await Promise.all([
        adminSupabase.from('orders').select('status').eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('orders').select('id, total_amount, status, placed_at').eq('restaurant_id', restaurantId).order('placed_at', { ascending: false }).limit(8),
    ])

    const pipeline = { pending: 0, preparing: 0, ready: 0, delivered: 0, cancelled: 0 }
    for (const o of (todayOrders || [])) {
        const s = o.status as keyof typeof pipeline
        if (s in pipeline) pipeline[s]++
    }

    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
            <div className="px-6 py-5 border-b border-hairline flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-muted/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-500/10 rounded-xl text-brand-500">
                        <BarChart3 size={20} />
                    </div>
                    <h2 className="text-[1.15rem] font-bold text-ink">Today&apos;s Pipeline</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-surface px-3 py-2 rounded-xl border border-hairline shadow-sm">
                    <PipelineBadge label="Pending" count={pipeline.pending} color="yellow" />
                    <PipelineBadge label="Preparing" count={pipeline.preparing} color="blue" />
                    <PipelineBadge label="Ready" count={pipeline.ready} color="green" />
                </div>
            </div>

            <div className="p-0 overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[500px]">
                    <thead>
                        <tr className="text-[12px] uppercase tracking-wider font-semibold text-ink-subtle bg-surface-muted/30">
                            <th className="px-6 py-4 border-b border-hairline">Order ID</th>
                            <th className="px-6 py-4 border-b border-hairline">Time</th>
                            <th className="px-6 py-4 border-b border-hairline">Status</th>
                            <th className="px-6 py-4 border-b border-hairline text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {recentOrders?.map(order => (
                            <RowLink key={order.id} href={`/admin/orders?order=${order.id}`} className="group">
                                <td className="px-6 py-4">
                                    <span className="font-mono text-[13px] font-bold text-ink group-hover:text-brand-500 transition-colors">#{order.id.substring(0, 6).toUpperCase()}</span>
                                </td>
                                <td className="px-6 py-4 text-[14px] text-ink-subtle font-medium tabular">
                                    {new Date(order.placed_at).toLocaleTimeString('en-US', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="px-6 py-4">
                                    <StatusBadge status={order.status} />
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="text-[15px] font-bold text-ink tabular">{money(order.total_amount)}</span>
                                </td>
                            </RowLink>
                        ))}
                    </tbody>
                </table>
                {(!recentOrders || recentOrders.length === 0) && (
                    <div className="p-10">
                        <EmptyState icon={Inbox} title="No orders yet today" description="New orders will show up here as they come in." />
                    </div>
                )}
            </div>
            <div className="bg-surface-muted/50 px-6 py-4 border-t border-hairline text-center">
                <Link href="/admin/orders" className="text-[14px] font-semibold text-brand-500 hover:text-[#e04f00] flex items-center justify-center gap-1.5 transition-colors">
                    View all orders <ArrowRight size={16} />
                </Link>
            </div>
        </div>
    )
}

function PipelineCardSkeleton() {
    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 space-y-3">
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
        </div>
    )
}

async function OnboardingChecklistSection({
    restaurantId, dineInEnabled, hasBusinessHours,
}: { restaurantId: string; dineInEnabled: boolean; hasBusinessHours: boolean }) {
    const adminSupabase = await createAdminClient()
    const [
        { count: menuCategoryCount },
        { count: menuItemCount },
        { count: tableCount },
        { count: staffCount },
    ] = await Promise.all([
        adminSupabase.from('menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true),
        adminSupabase.from('users').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).is('deleted_at', null),
    ])

    const onboardingSteps = [
        { done: (menuCategoryCount || 0) > 0, icon: UtensilsCrossed, label: 'Add a menu category', desc: 'Group your dishes into sections', href: '/admin/menu' },
        { done: (menuItemCount || 0) > 0, icon: ClipboardList, label: 'Customize your menu items', desc: 'Set names, prices and photos', href: '/admin/menu' },
        // Not applicable for delivery-only restaurants (dineInEnabled: false) — don't
        // block the checklist on a step that links to a nav item they don't even see.
        { done: !dineInEnabled || (tableCount || 0) > 0, icon: QrCode, label: 'Review tables & print QR codes', desc: 'Let guests scan to order', href: '/admin/tables' },
        { done: (staffCount || 0) > 1, icon: Users, label: 'Invite your staff', desc: 'Add waiters, kitchen and cashier', href: '/admin/staff' },
        { done: hasBusinessHours, icon: Clock, label: 'Set business hours & tax', desc: 'Configure opening times and rates', href: '/admin/settings' },
    ]
    const doneSteps = onboardingSteps.filter(s => s.done).length
    const totalSteps = onboardingSteps.length
    const progressPct = Math.round((doneSteps / totalSteps) * 100)
    if (doneSteps >= totalSteps) return null

    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <div className="relative bg-gradient-to-br from-brand-500/5 to-surface px-6 pt-6 pb-6 border-b border-hairline">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-brand-500 text-white rounded-2xl shadow-[0_4px_15px_rgba(255,90,0,0.25)]">
                            <Rocket size={24} />
                        </div>
                        <div>
                            <h2 className="text-[1.25rem] font-bold text-ink">Setup your restaurant</h2>
                            <p className="text-[14px] text-ink-subtle mt-1">Complete these steps to start taking orders.</p>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-3xl font-extrabold text-ink tracking-tight tabular-nums">
                            {doneSteps}<span className="text-ink-subtle text-xl font-semibold">/{totalSteps}</span>
                        </div>
                        <div className="text-[13px] font-semibold text-brand-500 mt-1 bg-brand-500/10 px-2.5 py-0.5 rounded-full inline-block">
                            {progressPct}% Completed
                        </div>
                    </div>
                </div>
                <div className="mt-6 h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all duration-700 ease-out" style={{ width: `${progressPct}%` }} />
                </div>
            </div>
            <ul className="divide-y divide-hairline">
                {onboardingSteps.map((step, i) => {
                    const Icon = step.icon
                    return (
                        <li key={i}>
                            <Link href={step.href} className={`group block flex items-center gap-4 px-6 py-4 transition-all hover:bg-surface-muted/50 ${step.done ? 'opacity-60' : ''}`}>
                                <div className={`p-2.5 rounded-xl transition-colors ${step.done ? 'bg-green-100 text-green-600' : 'bg-orange-50 text-brand-500 group-hover:bg-brand-500 group-hover:text-white'}`}>
                                    {step.done ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[15px] font-bold leading-tight ${step.done ? 'text-ink-subtle line-through' : 'text-ink group-hover:text-brand-500 transition-colors'}`}>{step.label}</p>
                                    <p className="text-[13px] text-ink-subtle mt-0.5 truncate">{step.desc}</p>
                                </div>
                                {step.done ? (
                                    <span className="text-[13px] font-bold text-green-600">Done</span>
                                ) : (
                                    <ChevronRight size={18} className="text-ink-subtle group-hover:text-brand-500 group-hover:translate-x-1 transition-all" />
                                )}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

async function LowStockAlertSection({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { data: lowStockIngredients } = await adminSupabase
        .from('ingredients')
        .select('id, name, stock_quantity, reorder_level, unit')
        .eq('restaurant_id', restaurantId).eq('is_active', true).not('reorder_level', 'is', null)

    const lowStock = (lowStockIngredients || []).filter(i => i.reorder_level !== null && i.stock_quantity <= i.reorder_level)
    if (lowStock.length === 0) return null

    return (
        <div className="bg-surface rounded-[24px] border border-red-100 shadow-[0_8px_30px_rgb(220,38,38,0.06)] overflow-hidden relative group animate-fade-up" style={{ animationDelay: '0.2s' }}>
            <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
            <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-red-600">
                        <AlertTriangle size={20} className="animate-pulse" />
                        <h3 className="font-bold text-[15px]">Inventory Alert</h3>
                    </div>
                    <span className="bg-red-100 text-red-700 text-[12px] font-bold px-2.5 py-0.5 rounded-full">{lowStock.length} items</span>
                </div>
                <div className="space-y-3 mb-4">
                    {lowStock.slice(0, 4).map(i => (
                        <div key={i.id} className="flex items-center justify-between">
                            <span className="text-[14px] font-medium text-ink">{i.name}</span>
                            <span className="text-[13px] font-bold text-red-600">{i.stock_quantity} {i.unit} left</span>
                        </div>
                    ))}
                    {lowStock.length > 4 && (
                        <p className="text-[13px] text-ink-subtle italic text-center pt-1">+{lowStock.length - 4} more items</p>
                    )}
                </div>
                <Link href="/admin/ingredients" className="w-full inline-block text-center bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[14px] py-2.5 rounded-xl transition-colors">
                    Manage Inventory
                </Link>
            </div>
        </div>
    )
}

async function PromoQuickAction({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { count: activePromos } = await adminSupabase
        .from('promo_codes').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true)

    return <QuickAction href="/admin/promos" icon={Tag} label="Promotions" badge={activePromos} />
}

async function ActiveStaffSection({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { data: activeShifts } = await adminSupabase
        .from('staff_shifts')
        .select('id, clock_in, users(full_name, roles(name))')
        .eq('restaurant_id', restaurantId).is('clock_out', null).order('clock_in', { ascending: false })

    const shifts = (activeShifts || []) as unknown as Array<{
        id: string; clock_in: string
        users: { full_name: string; roles: { name: string } | null } | null
    }>

    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.4s' }}>
            <div className="px-6 py-5 border-b border-hairline flex items-center justify-between">
                <h3 className="text-[1.15rem] font-bold text-ink flex items-center gap-2">
                    <UserCheck size={18} className="text-green-500" /> Active Staff
                </h3>
                <Link href="/admin/shifts" className="p-1 text-ink-subtle hover:text-brand-500 hover:bg-orange-50 rounded-lg transition-colors">
                    <MoreHorizontal size={20} />
                </Link>
            </div>
            <div className="divide-y divide-hairline p-2">
                {shifts.length === 0 ? (
                    <div className="p-8 text-center text-ink-subtle">
                        <Clock size={32} className="mx-auto mb-3 opacity-20" />
                        <p className="text-[14px] font-medium">No staff clocked in</p>
                    </div>
                ) : (
                    shifts.slice(0, 5).map(s => {
                        const roleName = (s.users?.roles as unknown as { name: string } | null)?.name || ''
                        const since = new Date(s.clock_in).toLocaleTimeString('en-IN', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit' })
                        return (
                            <div key={s.id} className="flex items-center gap-4 p-3 hover:bg-surface-muted rounded-xl transition-colors">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 border border-hairline flex items-center justify-center text-ink-subtle font-bold text-[15px] shadow-sm">
                                    {(s.users?.full_name || '?')[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] font-bold text-ink truncate">{s.users?.full_name || '—'}</p>
                                    <p className="text-[12px] text-ink-subtle capitalize font-medium">{roleName.replace('_', ' ')}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mb-1" />
                                    <p className="text-[11px] font-bold text-ink-subtle">{since}</p>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

function ActiveStaffCardSkeleton() {
    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 space-y-3">
            <RowSkeleton /><RowSkeleton />
        </div>
    )
}

function KpiCard({ title, value, icon: Icon, trend, trendUp, color }: { title: string, value: string, icon: any, trend: string, trendUp: boolean, color: 'brand' | 'blue' | 'green' | 'purple' }) {
    const colors = {
        brand: 'from-brand-500 to-brand-300 text-brand-500 bg-brand-500/10',
        blue: 'from-blue-500 to-cyan-500 text-blue-500 bg-blue-500/10',
        green: 'from-green-500 to-emerald-500 text-green-500 bg-green-500/10',
        purple: 'from-purple-500 to-pink-500 text-purple-500 bg-purple-500/10'
    }
    const c = colors[color]

    return (
        <div className="group relative bg-surface rounded-[24px] p-6 border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1 overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${c.split(' ')[0]} ${c.split(' ')[1]} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

            <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-[16px] flex items-center justify-center ${c.split(' ')[2]} ${c.split(' ')[3]} group-hover:scale-110 transition-transform duration-300`}>
                    <Icon size={24} />
                </div>
                {/* Micro trend indicator */}
                <div className={`flex items-center gap-1 text-[12px] font-bold px-2 py-1 rounded-full ${trendUp ? 'bg-green-50 text-green-600' : 'bg-surface-muted text-ink-subtle'}`}>
                    {trendUp && <TrendingUp size={12} />} {trend}
                </div>
            </div>

            <h3 className="text-ink-subtle text-[14px] font-medium mb-1">{title}</h3>
            <p className="text-3xl font-extrabold text-ink tracking-tight tabular-nums">{value}</p>
        </div>
    )
}

function PipelineBadge({ label, count, color }: { label: string, count: number, color: string }) {
    const colors: Record<string, string> = {
        yellow: 'bg-yellow-100 text-yellow-800',
        blue: 'bg-blue-100 text-blue-800',
        green: 'bg-green-100 text-green-800',
    }
    return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-muted border border-hairline">
            <span className={`w-2 h-2 rounded-full ${colors[color].split(' ')[0].replace('100', '500')}`} />
            <span className="text-[12px] font-bold text-ink-subtle">{label}</span>
            <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-md ${colors[color]} leading-none tabular-nums`}>{count}</span>
        </div>
    )
}

function QuickAction({ href, icon: Icon, label, badge }: { href: string, icon: any, label: string, badge?: number | null }) {
    return (
        <Link href={href} className="group relative flex flex-col items-center justify-center gap-3 p-4 rounded-[16px] bg-surface-muted hover:bg-brand-500/5 border border-transparent hover:border-brand-500/20 transition-all duration-300 hover:scale-[1.02]">
            <div className="text-ink-subtle group-hover:text-brand-500 transition-colors">
                <Icon size={24} />
            </div>
            <span className="text-[13px] font-bold text-ink group-hover:text-ink">{label}</span>
            {badge !== undefined && badge !== null && badge > 0 && (
                <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm ring-2 ring-white">
                    {badge > 9 ? '9+' : badge}
                </span>
            )}
        </Link>
    )
}
