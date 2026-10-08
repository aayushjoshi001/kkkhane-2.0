import RealtimeRefresh from '@/components/shared/RealtimeRefresh'
import MobileMenuButton from '@/components/admin/MobileMenuButton'
import AdSpace from '@/components/shared/AdSpace'
import BusinessSessionControl from '@/components/shared/BusinessSessionControl'
import { resolveActiveDayBookSession } from '@/lib/ledger'
import { getNstDateString } from '@/lib/timezone'
import RowLink from '@/components/admin/RowLink'
import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { formatCurrency, NEPAL_TZ } from '@/lib/utils'
import { cookies } from 'next/headers'
import { CALENDAR_COOKIE, formatDateParts, parseCalendar, type Calendar } from '@/lib/calendar'
import {
    TrendingUp, TrendingDown, ShoppingBag, Users, AlertTriangle, Clock, UserCheck,
    ArrowRight, CheckCircle2, ChevronRight, UtensilsCrossed, QrCode, Tag, ClipboardList,
    Boxes, Inbox, Rocket, BarChart3, Receipt, Wallet, MoreHorizontal, Bed, CalendarRange,
    Settings, Package, Zap, Flame, Star, CalendarDays, Activity,
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
type Change = { pct: number; up: boolean } | null

export default async function AdminDashboardPage() {
    const currentUser = await getCurrentUser()
    if (currentUser.role === 'super_admin') redirect('/admin/super-admin/dashboard')
    const { restaurantId } = currentUser
    const calendar = parseCalendar((await cookies()).get(CALENDAR_COOKIE)?.value)
    const features = await getRestaurantFeatures(restaurantId)

    const adminSupabase = await createAdminClient()
    const [restaurantSettingsRes, restaurantRes, turnoverRes, openSession] = await Promise.all([
        adminSupabase.from('settings').select('business_hours, features_v2').eq('restaurant_id', restaurantId).maybeSingle(),
        adminSupabase.from('restaurants').select('business_type, vat_registered').eq('id', restaurantId).maybeSingle(),
        adminSupabase.from('income_entries').select('amount').eq('restaurant_id', restaurantId).eq('status', 'posted'),
        resolveActiveDayBookSession(adminSupabase, restaurantId, currentUser.id),
    ])

    const restaurantSettings = restaurantSettingsRes.data
    const restaurant = restaurantRes.data
    const businessMode = restaurant?.business_type ? getBusinessMode(restaurant.business_type) : 'dine_in'
    const isHotel = businessMode === 'hotel'

    const totalTurnover = (turnoverRes.data || []).reduce((sum, r) => sum + Number(r.amount), 0)
    const showVatWarning = totalTurnover > 2000000 && !restaurant?.vat_registered

    const currencyFeatures = restaurantSettings?.features_v2 as { currency?: string; currencySymbol?: string | null } | null
    const money: Money = (amount) => formatCurrency(amount, currencyFeatures?.currency, currencyFeatures?.currencySymbol)
    const dineInEnabled = features?.dineInEnabled ?? true

    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const name = currentUser.email.split('@')[0]
    const todayDate = getNstDateString()

    // Friendly date for the hero badge
    const now = new Date()
    const todayLabel = now.toLocaleDateString('en-US', {
        timeZone: NEPAL_TZ, weekday: 'long', month: 'short', day: 'numeric'
    })

    return (
        <div className="space-y-5 max-w-[1400px] mx-auto pb-12">
            <RealtimeRefresh
                restaurantId={restaurantId}
                tables={isHotel ? ['orders', 'sessions', 'rooms', 'bookings'] : ['orders', 'sessions']}
                debounceMs={5000}
            />

            {/* ── Hero ──────────────────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-[2rem] bg-brand-500 text-white p-8 sm:p-10 shadow-2xl animate-fade-up min-h-[200px] flex flex-col justify-center">
                {/* Mobile hamburger */}
                <div className="absolute top-4 right-4 z-20">
                    <MobileMenuButton />
                </div>
                {/* Herringbone texture */}
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'%3E%3Cpath d='M0 20 L10 10 L20 20' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M20 20 L30 10 L40 20' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M0 0 L10 10 L20 0' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M20 0 L30 10 L40 0' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3C/svg%3E")`, backgroundSize: '40px 20px' }} />
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white opacity-5 blur-[120px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-black opacity-10 blur-[100px] rounded-full -translate-x-1/3 translate-y-1/4 pointer-events-none" />

                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        {/* Live + Date badges */}
                        <div className="flex items-center gap-2 mb-5 flex-wrap">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 text-[13px] font-medium">
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                                </span>
                                Live
                            </div>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[12px] font-medium text-white/80">
                                <CalendarDays size={12} />
                                {todayLabel}
                            </div>
                        </div>
                        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3 leading-tight">
                            {greeting}, <span className="capitalize">{name}</span>.
                        </h1>
                        <p className="text-white/75 text-[15px] max-w-xl leading-relaxed">
                            Here&apos;s what&apos;s happening at your {isHotel ? 'hotel' : 'restaurant'} today.
                        </p>
                    </div>
                    <div className="shrink-0 flex flex-col sm:flex-row gap-2">
                        <Link href="/admin/orders" className="bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white border border-white/25 px-5 py-2.5 rounded-[14px] font-semibold transition-all duration-200 hover:scale-105 flex items-center gap-2 text-[14px]">
                            <ShoppingBag size={15} /> View {isHotel ? 'Room Service' : 'Orders'}
                        </Link>
                        <Link href="/admin/reports" className="bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white border border-white/15 px-5 py-2.5 rounded-[14px] font-semibold transition-all duration-200 hover:scale-105 flex items-center gap-2 text-[14px]">
                            <BarChart3 size={15} /> Reports
                        </Link>
                    </div>
                </div>
            </div>

            {/* ── Session + Ad ──────────────────────────────────────────────── */}
            <BusinessSessionControl
                initialSession={openSession ? {
                    id: openSession.id,
                    date: openSession.date,
                    status: openSession.status as 'open' | 'closed',
                    opening_balance: Number(openSession.opening_balance),
                    opening_bank_balance: Number(openSession.opening_bank_balance)
                } : null}
                userRole={currentUser.role || ''}
                todayDate={todayDate}
            />
            <AdSpace />

            {/* ── VAT Warning ───────────────────────────────────────────────── */}
            {showVatWarning && (
                <div className="relative overflow-hidden rounded-[1.5rem] border border-rose-100 bg-rose-50/60 p-5 flex items-start gap-3.5 animate-fade-up">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-400 rounded-l-[1.5rem]" />
                    <AlertTriangle className="text-rose-500 shrink-0 mt-0.5" size={17} />
                    <div className="space-y-1">
                        <h4 className="font-bold text-[13px] text-rose-900">VAT Registration Required — IRD Compliance</h4>
                        <p className="text-[12px] text-rose-700 leading-relaxed">
                            Turnover has reached <strong>{money(totalTurnover)}</strong> — above the Rs.&nbsp;20&nbsp;Lakh threshold.
                        </p>
                        <Link href="/admin/finance/tax" className="inline-flex items-center gap-1 text-[12px] font-bold text-rose-800 underline underline-offset-2">
                            Update Tax Settings <ChevronRight size={12} />
                        </Link>
                    </div>
                </div>
            )}

            {/* ── Section label ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#A8896F]">Today&apos;s Overview</span>
                <div className="flex-1 h-px bg-[#f2c878]" />
            </div>

            {/* ── KPI Cards ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up" style={{ animationDelay: '0.05s' }}>
                <Suspense fallback={<KpiGridSkeleton />}>
                    <KpiCardsSection restaurantId={restaurantId} money={money} isHotel={isHotel} />
                </Suspense>
            </div>

            {/* ── Revenue Trend ─────────────────────────────────────────────── */}
            <Suspense fallback={null}>
                <RevenueTrendSection restaurantId={restaurantId} money={money} isHotel={isHotel} />
            </Suspense>

            {/* ── Main Grid ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* Left col: live status + pipeline + onboarding */}
                <div className="lg:col-span-2 space-y-5">
                    <Suspense fallback={null}>
                        <LiveStatusSection restaurantId={restaurantId} isHotel={isHotel} />
                    </Suspense>

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

                {/* Right col: quick actions + top items + low stock + staff */}
                <div className="space-y-5">
                    <Card>
                        <CardHeader icon={<Zap size={15} />} title="Quick Actions">
                            <Link href="/admin/orders/new" className="text-[10px] font-bold text-brand-500 hover:text-[#D95A00] flex items-center gap-1 transition-colors">
                                + New
                            </Link>
                        </CardHeader>
                        <div className="grid grid-cols-3 gap-2 p-4 pt-3">
                            {isHotel ? (
                                <>
                                    <QuickAction href="/admin/rooms" icon={Bed} label="Rooms" />
                                    <QuickAction href="/admin/bookings" icon={CalendarRange} label="Bookings" />
                                    {features?.irdSyncEnabled && <QuickAction href="/admin/payments" icon={Receipt} label="Billing" />}
                                    <QuickAction href="/admin/staff" icon={Users} label="Staff" />
                                    <QuickAction href="/admin/reports" icon={BarChart3} label="Reports" />
                                    <QuickAction href="/admin/settings" icon={Settings} label="Settings" />
                                </>
                            ) : (
                                <>
                                    <QuickAction href="/admin/menu" icon={UtensilsCrossed} label="Menu" />
                                    <QuickAction href="/admin/tables" icon={QrCode} label="Tables" />
                                    <Suspense fallback={<QuickAction href="/admin/promos" icon={Tag} label="Promos" />}>
                                        <PromoQuickAction restaurantId={restaurantId} />
                                    </Suspense>
                                    <QuickAction href="/admin/staff" icon={Users} label="Staff" />
                                    <QuickAction href="/admin/ingredients" icon={Boxes} label="Inventory" />
                                    <QuickAction href="/admin/reports" icon={BarChart3} label="Reports" />
                                </>
                            )}
                        </div>
                    </Card>

                    {!isHotel && (
                        <Suspense fallback={null}>
                            <TopItemsSection restaurantId={restaurantId} />
                        </Suspense>
                    )}

                    <Suspense fallback={null}>
                        {!isHotel && <LowStockAlertSection restaurantId={restaurantId} />}
                    </Suspense>

                    <Suspense fallback={<ActiveStaffCardSkeleton />}>
                        <ActiveStaffSection restaurantId={restaurantId} />
                    </Suspense>
                </div>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI cards with yesterday comparison
// ─────────────────────────────────────────────────────────────────────────────

async function KpiCardsSection({ restaurantId, money, isHotel = false }: { restaurantId: string; money: Money; isHotel?: boolean }) {
    const adminSupabase = await createAdminClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayEnd = new Date(yesterday)
    yesterdayEnd.setHours(23, 59, 59, 999)

    const [
        ordersCountRes, sessionsCountRes, todayOrdersRes, activeShiftCountRes, todayBookingsRes,
        yesterdayOrdersCountRes, yesterdayOrdersRes,
    ] = await Promise.all([
        adminSupabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('sessions').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'active'),
        adminSupabase.from('orders').select('total_amount, status, payment_status').eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('staff_shifts').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).is('clock_out', null),
        isHotel
            ? adminSupabase.from('bookings').select('total_amount').eq('restaurant_id', restaurantId)
                .or(`and(bill_settled_at.gte.${today.toISOString()}),and(bill_settled_at.is.null,checked_out_at.gte.${today.toISOString()})`)
            : Promise.resolve({ data: [] }),
        adminSupabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId)
            .gte('placed_at', yesterday.toISOString()).lte('placed_at', yesterdayEnd.toISOString()),
        adminSupabase.from('orders').select('total_amount, status, payment_status').eq('restaurant_id', restaurantId)
            .gte('placed_at', yesterday.toISOString()).lte('placed_at', yesterdayEnd.toISOString()),
    ])

    const totalOrdersToday = ordersCountRes.count || 0
    const activeSessionCount = sessionsCountRes.count || 0
    const todayOrders = todayOrdersRes.data || []
    const todayBookings = (todayBookingsRes.data || []) as { total_amount: number }[]
    const activeShiftCount = activeShiftCountRes.count || 0
    const yesterdayOrdersCount = yesterdayOrdersCountRes.count || 0
    const yesterdayOrders = yesterdayOrdersRes.data || []

    const paidRevenue = (orders: typeof todayOrders) =>
        orders.filter(o => o.payment_status === 'paid' || o.status === 'delivered' || o.status === 'completed')
              .reduce((s, o) => s + (o.total_amount || 0), 0)

    const roomRevenueToday = todayBookings.reduce((s, b) => s + (Number(b.total_amount) || 0), 0)
    const totalRevenueToday = paidRevenue(todayOrders) + roomRevenueToday
    const totalRevenueYesterday = paidRevenue(yesterdayOrders)

    const pctChange = (current: number, previous: number): Change => {
        if (previous === 0) return null
        const pct = Math.round(((current - previous) / previous) * 100)
        return { pct: Math.abs(pct), up: pct >= 0 }
    }

    const revChange = pctChange(totalRevenueToday, totalRevenueYesterday)
    const ordChange = pctChange(totalOrdersToday, yesterdayOrdersCount)

    if (isHotel) {
        let occupiedRooms = 0, totalRooms = 0, checkedInBookings = 0
        try {
            const [roomsOcc, roomsTotal, bookingsActive] = await Promise.all([
                adminSupabase.from('rooms').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'occupied'),
                adminSupabase.from('rooms').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
                adminSupabase.from('bookings').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'checked_in'),
            ])
            occupiedRooms = roomsOcc.count || 0
            totalRooms = roomsTotal.count || 0
            checkedInBookings = bookingsActive.count || 0
        } catch (_) {}
        const occPct = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0
        return (
            <>
                <KpiCard title="Revenue Today" value={money(totalRevenueToday)} icon={Wallet} change={revChange} accent="orange" />
                <KpiCard title="Checked In" value={String(checkedInBookings)} icon={UserCheck} change={null} accent="blue" />
                <KpiCard title="Occupancy" value={`${occPct}%`} icon={Bed} change={null} accent="purple" sub={`${occupiedRooms}/${totalRooms} rooms`} />
                <KpiCard title="Staff On Shift" value={String(activeShiftCount || 0)} icon={Clock} change={null} accent="green" />
            </>
        )
    }

    return (
        <>
            <KpiCard title="Revenue Today" value={money(totalRevenueToday)} icon={Wallet} change={revChange} accent="orange" />
            <KpiCard title="Orders Today" value={String(totalOrdersToday || 0)} icon={Receipt} change={ordChange} accent="blue" />
            <KpiCard title="Active Tables" value={String(activeSessionCount || 0)} icon={Users} change={null} accent="purple" />
            <KpiCard title="Staff On Shift" value={String(activeShiftCount || 0)} icon={Clock} change={null} accent="green" />
        </>
    )
}

function KpiGridSkeleton() {
    return <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
}

// ─────────────────────────────────────────────────────────────────────────────
// 7-day revenue trend chart
// ─────────────────────────────────────────────────────────────────────────────

async function RevenueTrendSection({ restaurantId, money, isHotel }: { restaurantId: string; money: Money; isHotel: boolean }) {
    const adminSupabase = await createAdminClient()

    // Fetch 8 days of orders so we can group into 7 NST days
    const eightDaysAgo = new Date()
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8)

    const { data: orders } = await adminSupabase
        .from('orders')
        .select('placed_at, total_amount, payment_status, status')
        .eq('restaurant_id', restaurantId)
        .gte('placed_at', eightDaysAgo.toISOString())
        .in('payment_status', ['paid'])

    // Group paid orders by NST day (UTC+5:45 = +345 min)
    const NST_OFFSET = 345 * 60 * 1000
    const dayMap = new Map<string, number>()
    for (const o of orders || []) {
        const nstMs = new Date(o.placed_at).getTime() + NST_OFFSET
        const nstDate = new Date(nstMs).toISOString().slice(0, 10)
        dayMap.set(nstDate, (dayMap.get(nstDate) || 0) + (Number(o.total_amount) || 0))
    }

    const weekDays: { label: string; shortLabel: string; revenue: number; isToday: boolean }[] = []
    for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const nstMs = d.getTime() + NST_OFFSET
        const key = new Date(nstMs).toISOString().slice(0, 10)
        weekDays.push({
            label: d.toLocaleDateString('en-US', { timeZone: NEPAL_TZ, weekday: 'short' }),
            shortLabel: d.toLocaleDateString('en-US', { timeZone: NEPAL_TZ, day: 'numeric' }),
            revenue: dayMap.get(key) || 0,
            isToday: i === 0,
        })
    }

    const maxRevenue = Math.max(...weekDays.map(d => d.revenue), 1)
    const totalWeek = weekDays.reduce((s, d) => s + d.revenue, 0)
    const todayRevenue = weekDays[6]?.revenue || 0
    const bestDay = weekDays.reduce((a, b) => a.revenue > b.revenue ? a : b)

    // SVG dimensions
    const barW = 32
    const barGap = 10
    const chartH = 72
    const totalW = (barW + barGap) * 7 - barGap

    return (
        <div className="bg-[#fef0cc] rounded-[20px] border border-[#f2c878] shadow-[0_2px_8px_rgba(43,26,14,0.05)] p-5 animate-fade-up" style={{ animationDelay: '0.12s' }}>
            <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Activity size={14} className="text-brand-500" />
                        <span className="text-[13px] font-bold text-[#2B1A0E]">Revenue — Last 7 Days</span>
                    </div>
                    <p className="text-[11px] text-[#A8896F]">Week total: <span className="font-bold text-[#2B1A0E]">{money(totalWeek)}</span></p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#A8896F]">Today</p>
                        <p className="text-[15px] font-black text-[#2B1A0E] tabular-nums leading-tight">{money(todayRevenue)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#A8896F]">Best Day</p>
                        <p className="text-[15px] font-black text-[#2B1A0E] tabular-nums leading-tight">{money(bestDay.revenue)}</p>
                    </div>
                </div>
            </div>

            {/* SVG bar chart */}
            <svg viewBox={`0 0 ${totalW} ${chartH + 28}`} className="w-full overflow-visible" style={{ maxHeight: '120px' }}>
                {weekDays.map((day, i) => {
                    const barH = maxRevenue > 0 ? Math.max((day.revenue / maxRevenue) * chartH, day.revenue > 0 ? 4 : 0) : 0
                    const x = i * (barW + barGap)
                    const y = chartH - barH
                    const isToday = day.isToday
                    const isBest = day.revenue === bestDay.revenue && day.revenue > 0

                    return (
                        <g key={i}>
                            {/* Background track */}
                            <rect x={x} y={0} width={barW} height={chartH} rx="8" fill="rgba(43,26,14,0.04)" />
                            {/* Revenue bar */}
                            {barH > 0 && (
                                <rect x={x} y={y} width={barW} height={barH} rx="8"
                                    fill={isToday ? '#F96A00' : isBest ? '#FB8B3A' : '#F96A00'}
                                    opacity={isToday ? 1 : isBest ? 0.55 : 0.3}
                                />
                            )}
                            {/* Today glow */}
                            {isToday && barH > 0 && (
                                <rect x={x} y={y} width={barW} height={barH} rx="8"
                                    fill="url(#todayGlow)" opacity={0.4}
                                />
                            )}
                            {/* Day label */}
                            <text x={x + barW / 2} y={chartH + 16} textAnchor="middle"
                                fontSize="9" fill={isToday ? '#F96A00' : '#A8896F'}
                                fontWeight={isToday ? '700' : '500'} fontFamily="inherit">
                                {isToday ? 'Today' : day.label}
                            </text>
                            {/* Date number */}
                            <text x={x + barW / 2} y={chartH + 26} textAnchor="middle"
                                fontSize="8" fill={isToday ? '#F96A00' : '#C4AE97'}
                                fontFamily="inherit">
                                {day.shortLabel}
                            </text>
                        </g>
                    )
                })}
                <defs>
                    <linearGradient id="todayGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="white" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                </defs>
            </svg>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Live table / room status grid
// ─────────────────────────────────────────────────────────────────────────────

async function LiveStatusSection({ restaurantId, isHotel }: { restaurantId: string; isHotel: boolean }) {
    const adminSupabase = await createAdminClient()

    if (isHotel) {
        const { data: rooms } = await adminSupabase
            .from('rooms').select('id, room_number, status, floor')
            .eq('restaurant_id', restaurantId).order('room_number')
        const roomList = rooms || []
        if (roomList.length === 0) return null

        const occupied = roomList.filter(r => r.status === 'occupied').length
        const available = roomList.filter(r => r.status === 'available' || !r.status).length
        const reserved = roomList.filter(r => r.status === 'reserved').length
        const cleaning = roomList.filter(r => r.status === 'cleaning').length

        return (
            <Card>
                <CardHeader icon={<Bed size={15} />} title="Room Status — Live">
                    <span className="text-[11px] font-semibold text-[#7A5F4A]">
                        <span className="text-brand-500 font-bold">{occupied}</span> occupied ·{' '}
                        <span className="font-bold text-[#2B1A0E]">{available}</span> free
                    </span>
                </CardHeader>
                <div className="p-4">
                    <div className="grid grid-cols-4 gap-2 mb-4">
                        <StatChip label="Occupied" value={occupied} accent="brand" />
                        <StatChip label="Available" value={available} accent="green" />
                        <StatChip label="Reserved" value={reserved} accent="yellow" />
                        <StatChip label="Cleaning" value={cleaning} accent="sky" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {roomList.map(room => {
                            const isOccupied = room.status === 'occupied'
                            const isReserved = room.status === 'reserved'
                            const isCleaning = room.status === 'cleaning'
                            return (
                                <Link key={room.id} href="/admin/rooms" title={`Room ${room.room_number} — ${room.status || 'available'}`}
                                    className={`flex items-center justify-center min-w-[48px] h-9 px-2 rounded-xl text-[11px] font-bold transition-all duration-200 hover:scale-105 ${
                                        isOccupied ? 'bg-brand-500 text-white shadow-sm' :
                                        isReserved ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                                        isCleaning ? 'bg-sky-50 text-sky-700 border border-sky-100' :
                                        'bg-[#fad9a0] text-[#7A5F4A] border border-[#f2c878]'
                                    }`}>
                                    {room.room_number}
                                </Link>
                            )
                        })}
                    </div>
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#f2c878]">
                        <StatusLegend color="bg-brand-500" label="Occupied" />
                        <StatusLegend color="bg-yellow-200 border border-yellow-300" label="Reserved" />
                        <StatusLegend color="bg-sky-100 border border-sky-200" label="Cleaning" />
                        <StatusLegend color="bg-[#fad9a0] border border-[#f2c878]" label="Free" />
                    </div>
                </div>
            </Card>
        )
    }

    const [{ data: tables }, { data: activeSessions }] = await Promise.all([
        adminSupabase.from('tables').select('id, name, capacity')
            .eq('restaurant_id', restaurantId).eq('is_active', true).order('name'),
        adminSupabase.from('sessions').select('table_id')
            .eq('restaurant_id', restaurantId).eq('status', 'active'),
    ])

    const tableList = tables || []
    if (tableList.length === 0) return null

    const activeTableIds = new Set((activeSessions || []).map(s => s.table_id))
    const activeCount = tableList.filter(t => activeTableIds.has(t.id)).length
    const freeCount = tableList.length - activeCount
    const occPct = tableList.length > 0 ? Math.round((activeCount / tableList.length) * 100) : 0

    return (
        <Card>
            <CardHeader icon={<QrCode size={15} />} title="Table Status — Live">
                <span className="text-[11px] font-semibold text-[#7A5F4A]">
                    <span className="text-brand-500 font-bold">{activeCount}</span> occupied ·{' '}
                    <span className="font-bold text-[#2B1A0E]">{freeCount}</span> free
                </span>
            </CardHeader>
            <div className="p-4">
                <div className="grid grid-cols-3 gap-2 mb-4">
                    <StatChip label="Occupied" value={activeCount} accent="brand" />
                    <StatChip label="Free" value={freeCount} accent="green" />
                    <StatChip label="Occupancy" value={`${occPct}%`} accent="neutral" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {tableList.map(t => {
                        const isActive = activeTableIds.has(t.id)
                        return (
                            <Link key={t.id} href="/cashier" title={`${t.name} — ${isActive ? 'occupied' : 'free'}`}
                                className={`flex items-center justify-center min-w-[52px] h-9 px-2 rounded-xl text-[11px] font-bold transition-all duration-200 hover:scale-105 ${
                                    isActive ? 'bg-brand-500 text-white shadow-sm' : 'bg-[#fad9a0] text-[#7A5F4A] border border-[#f2c878]'
                                }`}>
                                {t.name}
                            </Link>
                        )
                    })}
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#f2c878]">
                    <StatusLegend color="bg-brand-500" label="Occupied" />
                    <StatusLegend color="bg-[#fad9a0] border border-[#f2c878]" label="Free" />
                </div>
            </div>
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline table
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
    pending:   'bg-yellow-400',
    preparing: 'bg-orange-400',
    ready:     'bg-green-400',
    delivered: 'bg-emerald-400',
    completed: 'bg-emerald-400',
    cancelled: 'bg-rose-400',
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
                .eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(6)
            recentBookings = data || []
        } catch (_) {}

        const bookingPipeline = { pending: 0, checked_in: 0, checked_out: 0, cancelled: 0 }
        for (const b of recentBookings) {
            const s = b.status as keyof typeof bookingPipeline
            if (s in bookingPipeline) bookingPipeline[s]++
        }

        return (
            <Card>
                <CardHeader icon={<CalendarRange size={15} />} title="Recent Bookings">
                    <div className="flex gap-1.5">
                        <PipelineBadge label="Pending" count={bookingPipeline.pending} color="yellow" />
                        <PipelineBadge label="In" count={bookingPipeline.checked_in} color="green" />
                    </div>
                </CardHeader>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[480px]">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-[0.12em] font-bold text-[#A8896F] bg-[#fde8bb]/60 border-b border-[#f2c878]">
                                <th className="px-5 py-3">Guest</th>
                                <th className="px-5 py-3">Room</th>
                                <th className="px-5 py-3">Dates</th>
                                <th className="px-5 py-3">Status</th>
                                <th className="px-5 py-3 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f2c878]/60">
                            {recentBookings.map(booking => {
                                const roomNumber = (booking.rooms as unknown as { room_number: string } | null)?.room_number || '—'
                                const chIn = new Date(booking.check_in)
                                const chOut = new Date(booking.check_out)
                                const inParts = formatDateParts(chIn, calendar, { withYear: false })
                                const outParts = formatDateParts(chOut, calendar, { withYear: false })
                                const colorDot = STATUS_COLORS[booking.status] || 'bg-[#f2c878]'
                                return (
                                    <RowLink key={booking.id} href={`/admin/bookings?booking=${booking.id}`} className="group">
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-2.5">
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorDot}`} />
                                                <span className="font-semibold text-[13px] text-[#2B1A0E] group-hover:text-brand-500 transition-colors">{booking.guest_name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3.5 text-[12px] text-[#7A5F4A]">Room {roomNumber}</td>
                                        <td className="px-5 py-3.5 text-[11px] text-[#7A5F4A]">
                                            <span className="block">{inParts.primary} – {outParts.primary}</span>
                                            {inParts.secondary && outParts.secondary && (
                                                <span className="block text-[10px] text-[#A8896F] mt-0.5">{inParts.secondary} – {outParts.secondary}</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3.5"><StatusBadge status={booking.status === 'checked_in' ? 'ready' : booking.status === 'checked_out' ? 'delivered' : booking.status} /></td>
                                        <td className="px-5 py-3.5 text-right">
                                            <span className="text-[13px] font-bold text-[#2B1A0E] tabular-nums">{money(booking.total_amount)}</span>
                                        </td>
                                    </RowLink>
                                )
                            })}
                        </tbody>
                    </table>
                    {recentBookings.length === 0 && (
                        <div className="p-8"><EmptyState icon={CalendarRange} title="No bookings yet" description="All room reservations will appear here." /></div>
                    )}
                </div>
                <CardFooter href="/admin/bookings" label="View all bookings" />
            </Card>
        )
    }

    const [{ data: todayOrders }, { data: recentOrders }] = await Promise.all([
        adminSupabase.from('orders').select('status').eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('orders').select('id, total_amount, status, placed_at').eq('restaurant_id', restaurantId).order('placed_at', { ascending: false }).limit(6),
    ])

    const pipeline = { pending: 0, preparing: 0, ready: 0, delivered: 0, cancelled: 0 }
    for (const o of (todayOrders || [])) {
        const s = o.status as keyof typeof pipeline
        if (s in pipeline) pipeline[s]++
    }

    return (
        <Card>
            <CardHeader icon={<BarChart3 size={15} />} title="Today's Pipeline">
                <div className="flex gap-1.5 flex-wrap">
                    <PipelineBadge label="Pending" count={pipeline.pending} color="yellow" />
                    <PipelineBadge label="Preparing" count={pipeline.preparing} color="orange" />
                    <PipelineBadge label="Ready" count={pipeline.ready} color="green" />
                </div>
            </CardHeader>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[400px]">
                    <thead>
                        <tr className="text-[10px] uppercase tracking-[0.12em] font-bold text-[#A8896F] bg-[#fde8bb]/60 border-b border-[#f2c878]">
                            <th className="px-5 py-3">Order</th>
                            <th className="px-5 py-3">Time</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3 text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f2c878]/60">
                        {recentOrders?.map(order => {
                            const colorDot = STATUS_COLORS[order.status] || 'bg-[#f2c878]'
                            return (
                                <RowLink key={order.id} href={`/admin/orders?order=${order.id}`} className="group">
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-2.5">
                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorDot}`} />
                                            <span className="font-mono text-[12px] font-bold text-[#2B1A0E] group-hover:text-brand-500 transition-colors">
                                                #{order.id.substring(0, 6).toUpperCase()}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-[12px] text-[#7A5F4A] tabular-nums">
                                        {new Date(order.placed_at).toLocaleTimeString('en-US', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-5 py-3.5"><StatusBadge status={order.status} /></td>
                                    <td className="px-5 py-3.5 text-right">
                                        <span className="text-[13px] font-bold text-[#2B1A0E] tabular-nums">{money(order.total_amount)}</span>
                                    </td>
                                </RowLink>
                            )
                        })}
                    </tbody>
                </table>
                {(!recentOrders || recentOrders.length === 0) && (
                    <div className="p-8"><EmptyState icon={Inbox} title="No orders yet today" description="New orders will show up here as they come in." /></div>
                )}
            </div>
            <CardFooter href="/admin/orders" label="View all orders" />
        </Card>
    )
}

function PipelineCardSkeleton() {
    return (
        <div className="bg-[#fef0cc] rounded-[20px] border border-[#f2c878] p-5 space-y-3">
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Top selling items today
// ─────────────────────────────────────────────────────────────────────────────

async function TopItemsSection({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Join order_items → orders (today only) → menu_items
    const { data: items } = await adminSupabase
        .from('order_items')
        .select('quantity, menu_items(name), orders!inner(placed_at, restaurant_id, status)')
        .eq('orders.restaurant_id', restaurantId)
        .gte('orders.placed_at', today.toISOString())
        .not('orders.status', 'eq', 'cancelled')

    if (!items || items.length === 0) return null

    // Aggregate by item name
    const countMap = new Map<string, number>()
    for (const row of items) {
        const name = (row.menu_items as unknown as { name: string } | null)?.name
        if (name) countMap.set(name, (countMap.get(name) || 0) + (row.quantity || 1))
    }

    const sorted = Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)

    if (sorted.length === 0) return null

    const maxCount = sorted[0][1]

    return (
        <Card>
            <CardHeader icon={<Flame size={15} />} title="Top Selling Today">
                <span className="text-[10px] font-bold text-[#A8896F]">{sorted.length} items</span>
            </CardHeader>
            <div className="p-4 space-y-3">
                {sorted.map(([name, count], i) => {
                    const pct = Math.round((count / maxCount) * 100)
                    return (
                        <div key={name} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {i === 0 && <Star size={11} className="text-yellow-500 shrink-0 fill-yellow-400" />}
                                    <span className="text-[12px] font-semibold text-[#2B1A0E] truncate">{name}</span>
                                </div>
                                <span className="text-[11px] font-bold text-brand-500 shrink-0 tabular-nums">{count}×</span>
                            </div>
                            <div className="h-1.5 bg-[#fad9a0] rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-brand-500 transition-all duration-700"
                                    style={{ width: `${pct}%`, opacity: i === 0 ? 1 : 0.4 + (1 - i * 0.12) }}
                                />
                            </div>
                        </div>
                    )
                })}
            </div>
            <CardFooter href="/admin/menu" label="View full menu" />
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding checklist
// ─────────────────────────────────────────────────────────────────────────────

async function OnboardingChecklistSection({ restaurantId, dineInEnabled, hasBusinessHours }: { restaurantId: string; dineInEnabled: boolean; hasBusinessHours: boolean }) {
    const adminSupabase = await createAdminClient()
    const [{ count: menuCategoryCount }, { count: menuItemCount }, { count: tableCount }, { count: staffCount }] = await Promise.all([
        adminSupabase.from('menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true),
        adminSupabase.from('users').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).is('deleted_at', null),
    ])

    const steps = [
        { done: (menuCategoryCount || 0) > 0, icon: UtensilsCrossed, label: 'Add a menu category', desc: 'Group dishes into sections', href: '/admin/menu' },
        { done: (menuItemCount || 0) > 0, icon: ClipboardList, label: 'Add menu items', desc: 'Set names, prices and photos', href: '/admin/menu' },
        // Skip tables step for delivery-only restaurants (dineInEnabled: false)
        { done: !dineInEnabled || (tableCount || 0) > 0, icon: QrCode, label: 'Set up tables & QR codes', desc: 'Let guests scan to order', href: '/admin/tables' },
        { done: (staffCount || 0) > 1, icon: Users, label: 'Invite your staff', desc: 'Add waiters, kitchen and cashier', href: '/admin/staff' },
        { done: hasBusinessHours, icon: Clock, label: 'Set business hours & tax', desc: 'Configure opening times', href: '/admin/settings' },
    ]
    const doneSteps = steps.filter(s => s.done).length
    const totalSteps = steps.length
    const progressPct = Math.round((doneSteps / totalSteps) * 100)
    if (doneSteps >= totalSteps) return null

    return (
        <Card>
            <div className="px-5 py-4 border-b border-[#f2c878] bg-[#fde8bb]/50">
                <div className="flex items-center justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-brand-500 text-white flex items-center justify-center">
                            <Rocket size={14} />
                        </div>
                        <div>
                            <p className="text-[13px] font-bold text-[#2B1A0E]">Setup your restaurant</p>
                            <p className="text-[11px] text-[#A8896F]">Complete these steps to go live</p>
                        </div>
                    </div>
                    <span className="text-[13px] font-black text-[#2B1A0E] tabular-nums">
                        {doneSteps}<span className="text-[#A8896F] font-semibold">/{totalSteps}</span>
                    </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#f2c878] overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${progressPct}%` }} />
                </div>
            </div>
            <ul className="divide-y divide-[#f2c878]/60">
                {steps.map((step, i) => {
                    const Icon = step.icon
                    return (
                        <li key={i}>
                            <Link href={step.href} className={`group flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-[#fde8bb] ${step.done ? 'opacity-55' : ''}`}>
                                <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors ${step.done ? 'bg-green-100 text-green-600' : 'bg-[#fad9a0] text-brand-500 group-hover:bg-brand-500 group-hover:text-white'}`}>
                                    {step.done ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[13px] font-semibold ${step.done ? 'text-[#A8896F] line-through' : 'text-[#2B1A0E] group-hover:text-brand-500 transition-colors'}`}>{step.label}</p>
                                    <p className="text-[11px] text-[#A8896F] truncate">{step.desc}</p>
                                </div>
                                {step.done
                                    ? <span className="text-[11px] font-bold text-green-600">Done</span>
                                    : <ChevronRight size={14} className="text-[#CEBCA8] group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                                }
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </Card>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Low stock
// ─────────────────────────────────────────────────────────────────────────────

async function LowStockAlertSection({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { data: lowStockIngredients } = await adminSupabase
        .from('ingredients').select('id, name, stock_quantity, reorder_level, unit')
        .eq('restaurant_id', restaurantId).eq('is_active', true).not('reorder_level', 'is', null)

    const lowStock = (lowStockIngredients || []).filter(i => i.reorder_level !== null && i.stock_quantity <= i.reorder_level)
    if (lowStock.length === 0) return null

    return (
        <div className="rounded-[20px] border border-red-100 bg-red-50/50 overflow-hidden animate-fade-up">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-red-100/80">
                <div className="flex items-center gap-2">
                    <Package size={14} className="text-red-500" />
                    <span className="text-[13px] font-bold text-red-900">Inventory Alert</span>
                </div>
                <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{lowStock.length} low</span>
            </div>
            <div className="p-4 space-y-2">
                {lowStock.slice(0, 4).map(i => (
                    <div key={i.id} className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium text-red-900 truncate">{i.name}</span>
                        <span className="text-[11px] font-bold text-red-600 shrink-0">{i.stock_quantity} {i.unit}</span>
                    </div>
                ))}
                {lowStock.length > 4 && <p className="text-[11px] text-red-400 text-center">+{lowStock.length - 4} more</p>}
                <Link href="/admin/ingredients" className="mt-1 w-full flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600 text-white font-semibold text-[12px] py-2 rounded-xl transition-colors">
                    Manage Inventory <ArrowRight size={12} />
                </Link>
            </div>
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Promo quick action
// ─────────────────────────────────────────────────────────────────────────────

async function PromoQuickAction({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { count: activePromos } = await adminSupabase
        .from('promo_codes').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true)
    return <QuickAction href="/admin/promos" icon={Tag} label="Promos" badge={activePromos} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Active staff
// ─────────────────────────────────────────────────────────────────────────────

async function ActiveStaffSection({ restaurantId }: { restaurantId: string }) {
    const adminSupabase = await createAdminClient()
    const { data: activeShifts } = await adminSupabase
        .from('staff_shifts').select('id, clock_in, users(full_name, roles(name))')
        .eq('restaurant_id', restaurantId).is('clock_out', null).order('clock_in', { ascending: false })

    const shifts = (activeShifts || []) as unknown as Array<{
        id: string; clock_in: string
        users: { full_name: string; roles: { name: string } | null } | null
    }>

    return (
        <Card>
            <div className="px-5 py-3.5 border-b border-[#f2c878] flex items-center justify-between bg-[#fde8bb]/50">
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${shifts.length > 0 ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-[#CEBCA8]'}`} />
                    <span className="text-[13px] font-bold text-[#2B1A0E]">Active Staff</span>
                    {shifts.length > 0 && (
                        <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">{shifts.length}</span>
                    )}
                </div>
                <Link href="/admin/shifts" className="text-[#A8896F] hover:text-brand-500 transition-colors p-1 rounded-lg hover:bg-[#fad9a0]">
                    <MoreHorizontal size={15} />
                </Link>
            </div>
            <div className="p-3 space-y-1">
                {shifts.length === 0 ? (
                    <div className="py-6 text-center">
                        <div className="w-10 h-10 rounded-full bg-[#fad9a0] flex items-center justify-center mx-auto mb-2">
                            <Clock size={18} className="text-[#CEBCA8]" />
                        </div>
                        <p className="text-[12px] text-[#A8896F] font-medium">No staff clocked in</p>
                        <Link href="/admin/staff" className="text-[11px] text-brand-500 hover:underline mt-0.5 inline-block">Manage staff</Link>
                    </div>
                ) : (
                    shifts.slice(0, 5).map(s => {
                        const roleName = (s.users?.roles as unknown as { name: string } | null)?.name || ''
                        const since = new Date(s.clock_in).toLocaleTimeString('en-IN', { timeZone: NEPAL_TZ, hour: '2-digit', minute: '2-digit' })
                        const initials = (s.users?.full_name || '?')[0].toUpperCase()
                        // Each staff avatar gets a deterministic warm hue so the right column has subtle life
                        const hues = ['bg-orange-100 text-orange-700', 'bg-amber-100 text-amber-700', 'bg-yellow-100 text-yellow-700', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700']
                        const avatarColor = hues[s.id.charCodeAt(0) % hues.length]
                        return (
                            <div key={s.id} className="flex items-center gap-3 px-2 py-2.5 rounded-[12px] hover:bg-[#fad9a0]/60 transition-colors">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[13px] shrink-0 ${avatarColor}`}>
                                    {initials}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-semibold text-[#2B1A0E] truncate">{s.users?.full_name || '—'}</p>
                                    <p className="text-[11px] text-[#A8896F] capitalize">{roleName.replace('_', ' ')}</p>
                                </div>
                                <p className="text-[11px] text-[#A8896F] tabular-nums shrink-0">{since}</p>
                            </div>
                        )
                    })
                )}
            </div>
        </Card>
    )
}

function ActiveStaffCardSkeleton() {
    return (
        <div className="bg-[#fef0cc] rounded-[20px] border border-[#f2c878] p-4 space-y-3">
            <RowSkeleton /><RowSkeleton />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// UI primitives
// ─────────────────────────────────────────────────────────────────────────────

type KpiAccent = 'orange' | 'blue' | 'purple' | 'green'

const KPI_ACCENT: Record<KpiAccent, { bg: string; icon: string }> = {
    orange: { bg: 'bg-brand-500/10', icon: 'text-brand-500' },
    blue:   { bg: 'bg-sky-50',       icon: 'text-sky-600'   },
    purple: { bg: 'bg-violet-50',    icon: 'text-violet-600' },
    green:  { bg: 'bg-emerald-50',   icon: 'text-emerald-600' },
}

function KpiCard({ title, value, icon: Icon, sub, change, accent = 'orange' }: {
    title: string; value: string; icon: any; sub?: string; change: Change; accent?: KpiAccent
}) {
    const { bg, icon: iconColor } = KPI_ACCENT[accent]
    return (
        <div className="relative bg-[#fef0cc] rounded-[20px] p-5 border border-[#f2c878] shadow-[0_2px_8px_rgba(43,26,14,0.05)] hover:shadow-[0_4px_16px_rgba(43,26,14,0.09)] hover:-translate-y-0.5 transition-all duration-200 overflow-hidden group">
            {/* Subtle accent strip at top */}
            <div className={`absolute top-0 left-0 right-0 h-0.5 ${accent === 'orange' ? 'bg-brand-500' : accent === 'blue' ? 'bg-sky-400' : accent === 'purple' ? 'bg-violet-400' : 'bg-emerald-400'} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
            <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 rounded-[13px] ${bg} flex items-center justify-center`}>
                    <Icon size={18} className={iconColor} />
                </div>
                {change !== null && (
                    <div className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg ${change.up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                        {change.up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {change.pct}% vs yesterday
                    </div>
                )}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#A8896F] mb-1.5">{title}</p>
            <p className="text-[2rem] font-black text-[#2B1A0E] tracking-tight tabular-nums leading-none mb-1.5">{value}</p>
            {sub && <p className="text-[11px] text-[#A8896F]">{sub}</p>}
        </div>
    )
}

function QuickAction({ href, icon: Icon, label, badge }: { href: string; icon: any; label: string; badge?: number | null }) {
    return (
        <Link href={href} className="group relative flex flex-col items-center justify-center gap-2 p-3 rounded-[14px] bg-[#fad9a0]/60 hover:bg-brand-500 border border-[#f2c878] hover:border-brand-500 transition-all duration-200">
            <Icon size={20} className="text-[#7A5F4A] group-hover:text-white transition-colors" />
            <span className="text-[10px] font-bold text-[#2B1A0E] group-hover:text-white text-center leading-tight transition-colors">{label}</span>
            {badge !== undefined && badge !== null && badge > 0 && (
                <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[9px] font-black flex items-center justify-center rounded-full ring-1 ring-white" style={{ width: '16px', height: '16px' }}>
                    {badge > 9 ? '9+' : badge}
                </span>
            )}
        </Link>
    )
}

function PipelineBadge({ label, count, color }: { label: string; count: number; color: string }) {
    const c: Record<string, string> = {
        yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
        orange: 'bg-orange-50 text-brand-500 border-orange-100',
        green:  'bg-green-50 text-green-700 border-green-100',
    }
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${c[color] ?? c.yellow}`}>
            {label} <span className="tabular-nums">{count}</span>
        </span>
    )
}

type StatChipAccent = 'brand' | 'green' | 'yellow' | 'sky' | 'neutral'

function StatChip({ label, value, accent }: { label: string; value: string | number; accent: StatChipAccent }) {
    const styles: Record<StatChipAccent, string> = {
        brand:   'bg-brand-500/8 text-brand-500 border-brand-500/15',
        green:   'bg-green-50 text-green-700 border-green-100',
        yellow:  'bg-yellow-50 text-yellow-700 border-yellow-100',
        sky:     'bg-sky-50 text-sky-700 border-sky-100',
        neutral: 'bg-[#fad9a0] text-[#7A5F4A] border-[#f2c878]',
    }
    return (
        <div className={`rounded-xl border px-3 py-2 text-center ${styles[accent]}`}>
            <p className="text-[1rem] font-black tabular-nums leading-none mb-0.5">{value}</p>
            <p className="text-[9px] font-bold uppercase tracking-wider opacity-70">{label}</p>
        </div>
    )
}

function StatusLegend({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-md ${color}`} />
            <span className="text-[10px] font-semibold text-[#A8896F]">{label}</span>
        </div>
    )
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="bg-[#fef0cc] rounded-[20px] border border-[#f2c878] shadow-[0_2px_8px_rgba(43,26,14,0.05)] overflow-hidden animate-fade-up">
            {children}
        </div>
    )
}

function CardHeader({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#f2c878] bg-[#fde8bb]/50">
            <div className="flex items-center gap-2">
                <span className="text-brand-500">{icon}</span>
                <span className="text-[13px] font-bold text-[#2B1A0E]">{title}</span>
            </div>
            {children && <div className="flex items-center gap-1.5 flex-wrap">{children}</div>}
        </div>
    )
}

function CardFooter({ href, label }: { href: string; label: string }) {
    return (
        <div className="px-5 py-3.5 border-t border-[#f2c878] bg-[#fde8bb]/40 text-center">
            <Link href={href} className="text-[12px] font-bold text-brand-500 hover:text-[#D95A00] inline-flex items-center gap-1 transition-colors group">
                {label} <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
        </div>
    )
}
