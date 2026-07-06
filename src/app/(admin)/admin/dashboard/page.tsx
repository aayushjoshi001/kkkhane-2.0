import { createAdminClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/utils'
import {
    TrendingUp, ShoppingBag, Users, AlertTriangle, Clock, UserCheck, Package,
    ArrowRight, CheckCircle2, ChevronRight, UtensilsCrossed, QrCode, Tag, ClipboardList, Boxes, Inbox,
    Rocket, BarChart3, Receipt, Wallet, Bell, MoreHorizontal
} from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import Card from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/Badge'

export const revalidate = 0

export default async function AdminDashboardPage() {
    const currentUser = await getCurrentUser()
    if (currentUser.role === 'super_admin') redirect('/admin/super-admin/dashboard')
    const { restaurantId } = currentUser

    const adminSupabase = await createAdminClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    const now = new Date().toISOString()
    const [
        { count: totalOrdersToday },
        { count: activeSessionCount },
        { data: recentOrders },
        { data: todayOrders },
        { data: monthOrders },
        { count: menuCategoryCount },
        { count: menuItemCount },
        { count: tableCount },
        { data: activeShifts },
        { data: lowStockIngredients },
        { count: activePromos },
        { count: staffCount },
        { data: restaurantSettings },
    ] = await Promise.all([
        // All queries use adminSupabase (service role)
        adminSupabase.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('sessions').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('status', 'active').gt('expires_at', now),
        adminSupabase.from('orders').select('id, total_amount, status, placed_at').eq('restaurant_id', restaurantId).order('placed_at', { ascending: false }).limit(8),
        adminSupabase.from('orders').select('total_amount, status').eq('restaurant_id', restaurantId).gte('placed_at', today.toISOString()),
        adminSupabase.from('orders').select('total_amount').eq('restaurant_id', restaurantId).gte('placed_at', monthStart.toISOString()).eq('status', 'delivered'),
        adminSupabase.from('menu_categories').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('menu_items').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('tables').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true),
        adminSupabase.from('staff_shifts').select('id, clock_in, users(full_name, roles(name))').eq('restaurant_id', restaurantId).is('clock_out', null).order('clock_in', { ascending: false }),
        adminSupabase.from('ingredients').select('id, name, stock_quantity, reorder_level, unit').eq('restaurant_id', restaurantId).eq('is_active', true).not('reorder_level', 'is', null),
        adminSupabase.from('promo_codes').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId).eq('is_active', true),
        adminSupabase.from('users').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId),
        adminSupabase.from('settings').select('business_hours, features_v2').eq('restaurant_id', restaurantId).maybeSingle(),
    ])

    const currencyFeatures = restaurantSettings?.features_v2 as { currency?: string; currencySymbol?: string | null; dineInEnabled?: boolean } | null
    const money = (amount: number) => formatCurrency(amount, currencyFeatures?.currency, currencyFeatures?.currencySymbol)
    // Same safe default as elsewhere — restaurants provisioned before this flag
    // existed have no dineInEnabled key in their stored features_v2.
    const dineInEnabled = currencyFeatures?.dineInEnabled ?? true

    const totalRevenueToday = (todayOrders || []).filter(o => o.status === 'delivered').reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalRevenueMonth = (monthOrders || []).reduce((s, o) => s + (o.total_amount || 0), 0)

    const pipeline = { pending: 0, preparing: 0, ready: 0, delivered: 0, cancelled: 0 }
    for (const o of (todayOrders || [])) {
        const s = o.status as keyof typeof pipeline
        if (s in pipeline) pipeline[s]++
    }

    const lowStock = (lowStockIngredients || []).filter(i => i.reorder_level !== null && i.stock_quantity <= i.reorder_level)

    const shifts = (activeShifts || []) as unknown as Array<{
        id: string; clock_in: string
        users: { full_name: string; roles: { name: string } | null } | null
    }>

    const onboardingSteps = [
        { done: (menuCategoryCount || 0) > 0, icon: UtensilsCrossed, label: 'Add a menu category', desc: 'Group your dishes into sections', href: '/admin/menu' },
        { done: (menuItemCount || 0) > 0, icon: ClipboardList, label: 'Customize your menu items', desc: 'Set names, prices and photos', href: '/admin/menu' },
        // Not applicable for delivery-only restaurants (dineInEnabled: false) — don't
        // block the checklist on a step that links to a nav item they don't even see.
        { done: !dineInEnabled || (tableCount || 0) > 0, icon: QrCode, label: 'Review tables & print QR codes', desc: 'Let guests scan to order', href: '/admin/tables' },
        { done: (staffCount || 0) > 1, icon: Users, label: 'Invite your staff', desc: 'Add waiters, kitchen and cashier', href: '/admin/staff' },
        { done: !!restaurantSettings?.business_hours, icon: Clock, label: 'Set business hours & tax', desc: 'Configure opening times and rates', href: '/admin/settings' },
    ]
    const doneSteps = onboardingSteps.filter(s => s.done).length
    const totalSteps = onboardingSteps.length
    const progressPct = Math.round((doneSteps / totalSteps) * 100)
    const showChecklist = doneSteps < totalSteps

    const hour = new Date().getHours()
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
    const name = currentUser.email.split('@')[0]

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            {/* Premium Header */}
            <div className="relative overflow-hidden rounded-[2rem] bg-[#0a0a0a] text-white p-8 sm:p-12 shadow-2xl animate-fade-up">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#ff5a00] opacity-20 blur-[120px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500 opacity-20 blur-[100px] rounded-full -translate-x-1/3 translate-y-1/4 pointer-events-none" />
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 mb-6 text-sm font-medium text-white/90">
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
                            Here's what's happening at your restaurant today. You have <strong className="text-white">{totalOrdersToday || 0}</strong> new orders and your revenue is tracking well.
                        </p>
                    </div>
                    <div className="shrink-0 flex flex-wrap gap-3">
                        <Link href="/admin/orders" className="bg-[#ff5a00] hover:bg-[#ff4500] text-white px-7 py-3.5 rounded-[16px] font-semibold transition-all duration-300 hover:scale-105 shadow-[0_0_20px_rgba(255,90,0,0.3)] hover:shadow-[0_0_30px_rgba(255,90,0,0.5)] flex items-center gap-2">
                            <ShoppingBag size={18} /> View Orders
                        </Link>
                    </div>
                </div>
            </div>

            {/* Premium KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <KpiCard 
                    title="Revenue Today" 
                    value={money(totalRevenueToday)} 
                    icon={Wallet} 
                    trend="+12% from yesterday" 
                    trendUp={true} 
                    color="brand" 
                />
                <KpiCard 
                    title="Orders Today" 
                    value={String(totalOrdersToday || 0)} 
                    icon={Receipt} 
                    trend="Active pipeline" 
                    trendUp={true} 
                    color="blue" 
                />
                <KpiCard 
                    title="Active Tables" 
                    value={String(activeSessionCount || 0)} 
                    icon={Users} 
                    trend="Currently occupied" 
                    trendUp={true} 
                    color="green" 
                />
                <KpiCard 
                    title="Staff On Shift" 
                    value={String(shifts.length)} 
                    icon={Clock} 
                    trend="Clocked in right now" 
                    trendUp={true} 
                    color="purple" 
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {/* Pipeline & Recent Orders */}
                    <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        <div className="px-6 py-5 border-b border-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[#ff5a00]/10 rounded-xl text-[#ff5a00]">
                                    <BarChart3 size={20} />
                                </div>
                                <h2 className="text-[1.15rem] font-bold text-gray-900">Today's Pipeline</h2>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm">
                                <PipelineBadge label="Pending" count={pipeline.pending} color="yellow" />
                                <PipelineBadge label="Preparing" count={pipeline.preparing} color="blue" />
                                <PipelineBadge label="Ready" count={pipeline.ready} color="green" />
                            </div>
                        </div>
                        
                        <div className="p-0 overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[500px]">
                                <thead>
                                    <tr className="text-[12px] uppercase tracking-wider font-semibold text-gray-400 bg-gray-50/30">
                                        <th className="px-6 py-4 border-b border-gray-100">Order ID</th>
                                        <th className="px-6 py-4 border-b border-gray-100">Time</th>
                                        <th className="px-6 py-4 border-b border-gray-100">Status</th>
                                        <th className="px-6 py-4 border-b border-gray-100 text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {recentOrders?.map(order => (
                                        <tr key={order.id} className="group hover:bg-gray-50/50 transition-colors cursor-pointer">
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-[13px] font-bold text-gray-900 group-hover:text-[#ff5a00] transition-colors">#{order.id.substring(0, 6).toUpperCase()}</span>
                                            </td>
                                            <td className="px-6 py-4 text-[14px] text-gray-500 font-medium tabular">
                                                {new Date(order.placed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={order.status} />
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="text-[15px] font-bold text-gray-900 tabular">{money(order.total_amount)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(!recentOrders || recentOrders.length === 0) && (
                                <div className="p-10">
                                    <EmptyState icon={Inbox} title="No orders yet today" description="New orders will show up here as they come in." />
                                </div>
                            )}
                        </div>
                        <div className="bg-gray-50/50 px-6 py-4 border-t border-gray-100 text-center">
                            <Link href="/admin/orders" className="text-[14px] font-semibold text-[#ff5a00] hover:text-[#e04f00] flex items-center justify-center gap-1.5 transition-colors">
                                View all orders <ArrowRight size={16} />
                            </Link>
                        </div>
                    </div>

                    {/* Onboarding */}
                    {showChecklist && (
                        <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
                            <div className="relative bg-gradient-to-br from-[#ff5a00]/5 to-white px-6 pt-6 pb-6 border-b border-gray-50">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-[#ff5a00] text-white rounded-2xl shadow-[0_4px_15px_rgba(255,90,0,0.25)]">
                                            <Rocket size={24} />
                                        </div>
                                        <div>
                                            <h2 className="text-[1.25rem] font-bold text-gray-900">Setup your restaurant</h2>
                                            <p className="text-[14px] text-gray-500 mt-1">Complete these steps to start taking orders.</p>
                                        </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <div className="text-3xl font-extrabold text-gray-900 tracking-tight tabular-nums">
                                            {doneSteps}<span className="text-gray-400 text-xl font-semibold">/{totalSteps}</span>
                                        </div>
                                        <div className="text-[13px] font-semibold text-[#ff5a00] mt-1 bg-[#ff5a00]/10 px-2.5 py-0.5 rounded-full inline-block">
                                            {progressPct}% Completed
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-6 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-[#ff5a00] to-[#ff9a00] transition-all duration-700 ease-out" style={{ width: `${progressPct}%` }} />
                                </div>
                            </div>
                            <ul className="divide-y divide-gray-50">
                                {onboardingSteps.map((step, i) => {
                                    const Icon = step.icon
                                    return (
                                        <li key={i}>
                                            <Link href={step.href} className={`group block flex items-center gap-4 px-6 py-4 transition-all hover:bg-gray-50/50 ${step.done ? 'opacity-60' : ''}`}>
                                                <div className={`p-2.5 rounded-xl transition-colors ${step.done ? 'bg-green-100 text-green-600' : 'bg-orange-50 text-[#ff5a00] group-hover:bg-[#ff5a00] group-hover:text-white'}`}>
                                                    {step.done ? <CheckCircle2 size={20} /> : <Icon size={20} />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className={`text-[15px] font-bold leading-tight ${step.done ? 'text-gray-500 line-through' : 'text-gray-900 group-hover:text-[#ff5a00] transition-colors'}`}>{step.label}</p>
                                                    <p className="text-[13px] text-gray-500 mt-0.5 truncate">{step.desc}</p>
                                                </div>
                                                {step.done ? (
                                                    <span className="text-[13px] font-bold text-green-600">Done</span>
                                                ) : (
                                                    <ChevronRight size={18} className="text-gray-300 group-hover:text-[#ff5a00] group-hover:translate-x-1 transition-all" />
                                                )}
                                            </Link>
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    {/* Alerts / Low Stock */}
                    {lowStock.length > 0 && (
                        <div className="bg-white rounded-[24px] border border-red-100 shadow-[0_8px_30px_rgb(220,38,38,0.06)] overflow-hidden relative group animate-fade-up" style={{ animationDelay: '0.2s' }}>
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
                                            <span className="text-[14px] font-medium text-gray-700">{i.name}</span>
                                            <span className="text-[13px] font-bold text-red-600">{i.stock_quantity} {i.unit} left</span>
                                        </div>
                                    ))}
                                    {lowStock.length > 4 && (
                                        <p className="text-[13px] text-gray-500 italic text-center pt-1">+{lowStock.length - 4} more items</p>
                                    )}
                                </div>
                                <Link href="/admin/ingredients" className="w-full inline-block text-center bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[14px] py-2.5 rounded-xl transition-colors">
                                    Manage Inventory
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* Quick Actions Grid */}
                    <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <h3 className="text-[1.15rem] font-bold text-gray-900 mb-5 flex items-center gap-2">
                            <Rocket size={18} className="text-[#ff5a00]" /> Quick Actions
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                            <QuickAction href="/admin/menu" icon={UtensilsCrossed} label="Edit Menu" />
                            <QuickAction href="/admin/tables" icon={QrCode} label="Tables & QR" />
                            <QuickAction href="/admin/promos" icon={Tag} label="Promotions" badge={activePromos} />
                            <QuickAction href="/admin/staff" icon={Users} label="Manage Staff" />
                            <QuickAction href="/admin/ingredients" icon={Boxes} label="Inventory" />
                            <QuickAction href="/admin/reports" icon={BarChart3} label="Reports" />
                        </div>
                    </div>

                    {/* Staff On Shift */}
                    <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.4s' }}>
                        <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between">
                            <h3 className="text-[1.15rem] font-bold text-gray-900 flex items-center gap-2">
                                <UserCheck size={18} className="text-green-500" /> Active Staff
                            </h3>
                            <Link href="/admin/shifts" className="p-1 text-gray-400 hover:text-[#ff5a00] hover:bg-orange-50 rounded-lg transition-colors">
                                <MoreHorizontal size={20} />
                            </Link>
                        </div>
                        <div className="divide-y divide-gray-50 p-2">
                            {shifts.length === 0 ? (
                                <div className="p-8 text-center text-gray-400">
                                    <Clock size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-[14px] font-medium">No staff clocked in</p>
                                </div>
                            ) : (
                                shifts.slice(0, 5).map(s => {
                                    const roleName = (s.users?.roles as unknown as { name: string } | null)?.name || ''
                                    const since = new Date(s.clock_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                                    return (
                                        <div key={s.id} className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-xl transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 border border-gray-200 flex items-center justify-center text-gray-600 font-bold text-[15px] shadow-sm">
                                                {(s.users?.full_name || '?')[0].toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[14px] font-bold text-gray-900 truncate">{s.users?.full_name || '—'}</p>
                                                <p className="text-[12px] text-gray-500 capitalize font-medium">{roleName.replace('_', ' ')}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <span className="inline-block w-2 h-2 rounded-full bg-green-500 mb-1" />
                                                <p className="text-[11px] font-bold text-gray-400">{since}</p>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function KpiCard({ title, value, icon: Icon, trend, trendUp, color }: { title: string, value: string, icon: any, trend: string, trendUp: boolean, color: 'brand' | 'blue' | 'green' | 'purple' }) {
    const colors = {
        brand: 'from-[#ff5a00] to-[#ff9a00] text-[#ff5a00] bg-[#ff5a00]/10',
        blue: 'from-blue-500 to-cyan-500 text-blue-500 bg-blue-500/10',
        green: 'from-green-500 to-emerald-500 text-green-500 bg-green-500/10',
        purple: 'from-purple-500 to-pink-500 text-purple-500 bg-purple-500/10'
    }
    const c = colors[color]

    return (
        <div className="group relative bg-white rounded-[24px] p-6 border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1 overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${c.split(' ')[0]} ${c.split(' ')[1]} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
            
            <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-[16px] flex items-center justify-center ${c.split(' ')[2]} ${c.split(' ')[3]} group-hover:scale-110 transition-transform duration-300`}>
                    <Icon size={24} />
                </div>
                {/* Micro trend indicator */}
                <div className={`flex items-center gap-1 text-[12px] font-bold px-2 py-1 rounded-full ${trendUp ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                    {trendUp && <TrendingUp size={12} />} {trend}
                </div>
            </div>
            
            <h3 className="text-gray-500 text-[14px] font-medium mb-1">{title}</h3>
            <p className="text-3xl font-extrabold text-gray-900 tracking-tight tabular-nums">{value}</p>
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
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
            <span className={`w-2 h-2 rounded-full ${colors[color].split(' ')[0].replace('100', '500')}`} />
            <span className="text-[12px] font-bold text-gray-600">{label}</span>
            <span className={`text-[12px] font-bold px-1.5 py-0.5 rounded-md ${colors[color]} leading-none tabular-nums`}>{count}</span>
        </div>
    )
}

function QuickAction({ href, icon: Icon, label, badge }: { href: string, icon: any, label: string, badge?: number | null }) {
    return (
        <Link href={href} className="group relative flex flex-col items-center justify-center gap-3 p-4 rounded-[16px] bg-gray-50 hover:bg-[#ff5a00]/5 border border-transparent hover:border-[#ff5a00]/20 transition-all duration-300 hover:scale-[1.02]">
            <div className="text-gray-400 group-hover:text-[#ff5a00] transition-colors">
                <Icon size={24} />
            </div>
            <span className="text-[13px] font-bold text-gray-700 group-hover:text-gray-900">{label}</span>
            {badge !== undefined && badge !== null && badge > 0 && (
                <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm ring-2 ring-white">
                    {badge > 9 ? '9+' : badge}
                </span>
            )}
        </Link>
    )
}
