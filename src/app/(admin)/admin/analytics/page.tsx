import { createServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import AnalyticsDashboard from '@/components/admin/AnalyticsDashboard'

export const revalidate = 60

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function AnalyticsPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createServerClient()

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const d7  = new Date(today); d7.setDate(d7.getDate() - 7)
    const d14 = new Date(today); d14.setDate(d14.getDate() - 14)
    const d30 = new Date(today); d30.setDate(d30.getDate() - 30)
    const d60 = new Date(today); d60.setDate(d60.getDate() - 60)

    const [
        { data: delivered30d },
        { data: prevDelivered30d },
        { data: cancelledOrders },
        { data: recentFeedback },
        { count: totalRoomsCount },
        { data: bookings30d },
        { data: bargainExpenses },
        { data: cancellationExpenses }
    ] = await Promise.all([
        supabase.from('orders').select('id, total_amount, placed_at')
            .eq('restaurant_id', restaurantId).eq('status', 'delivered')
            .gte('placed_at', d30.toISOString()),

        supabase.from('orders').select('id, total_amount, placed_at')
            .eq('restaurant_id', restaurantId).eq('status', 'delivered')
            .gte('placed_at', d60.toISOString()).lt('placed_at', d30.toISOString()),

        supabase.from('orders').select('id, total_amount, placed_at, customer_note')
            .eq('restaurant_id', restaurantId).eq('status', 'cancelled')
            .gte('placed_at', d30.toISOString())
            .order('placed_at', { ascending: false }).limit(50),

        supabase.from('feedback').select('rating, comment, created_at')
            .eq('restaurant_id', restaurantId).gte('created_at', d30.toISOString())
            .order('created_at', { ascending: false }).limit(100),

        supabase.from('rooms').select('*', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId).eq('is_active', true),

        supabase.from('bookings').select('id, check_in, check_out, total_amount, discount_amount, status')
            .eq('restaurant_id', restaurantId)
            .neq('status', 'cancelled')
            .gte('check_out', d30.toISOString()),

        supabase.from('expenses').select('amount, created_at, expense_categories!inner(name)')
            .eq('restaurant_id', restaurantId)
            .eq('expense_categories.name', 'Bargain Discounts')
            .gte('created_at', d30.toISOString()),

        supabase.from('expenses').select('amount, created_at, expense_categories!inner(name)')
            .eq('restaurant_id', restaurantId)
            .eq('expense_categories.name', 'Order Cancellation')
            .gte('created_at', d30.toISOString())
    ])

    // Top suppliers by spend — the Resources ledger (Suppliers/Stock/Vouchers)
    // records vendor_name on every expense, but nothing in Intelligence
    // surfaced it until now.
    const { data: recentExpenses } = await supabase
        .from('expenses')
        .select('amount, vendor_name')
        .eq('restaurant_id', restaurantId)
        .not('vendor_name', 'is', null)
        .gte('created_at', d30.toISOString())

    const supplierSpend: Record<string, number> = {}
    for (const row of recentExpenses ?? []) {
        if (!row.vendor_name) continue
        supplierSpend[row.vendor_name] = (supplierSpend[row.vendor_name] ?? 0) + Number(row.amount)
    }
    const topSuppliers = Object.entries(supplierSpend)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8)

    // Top ordered items
    let topItems: { name: string; count: number; revenue: number }[] = []
    const orderIds = (delivered30d ?? []).map(o => o.id).slice(0, 500)
    if (orderIds.length > 0) {
        const { data: itemData } = await supabase
            .from('order_items').select('quantity, unit_price, menu_items(name)')
            .in('order_id', orderIds)

        const agg: Record<string, { count: number; revenue: number }> = {}
        for (const row of itemData ?? []) {
            const name = (row.menu_items as unknown as { name: string } | null)?.name ?? 'Unknown'
            if (!agg[name]) agg[name] = { count: 0, revenue: 0 }
            agg[name].count += row.quantity
            agg[name].revenue += row.unit_price * row.quantity
        }
        topItems = Object.entries(agg)
            .map(([name, d]) => ({ name, ...d }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
    }

    // Build 30 daily buckets for restaurant revenue
    const daily = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(d30); d.setDate(d.getDate() + i)
        return {
            date: d.toISOString().slice(0, 10),
            label: DAY_NAMES[d.getDay()],
            dayNum: d.getDate(),
            monthStr: MONTH_SHORT[d.getMonth()],
            revenue: 0,
            orders: 0,
            bargainDiscount: 0,
            cancellationCost: 0,
            occupiedRoomsCount: 0
        }
    })

    // Map restaurant orders to daily buckets
    for (const o of delivered30d ?? []) {
        const b = daily.find(d => d.date === o.placed_at.slice(0, 10))
        if (b) { b.revenue += o.total_amount ?? 0; b.orders++ }
    }

    // Map bargain discounts to daily buckets
    for (const exp of bargainExpenses ?? []) {
        const dateStr = exp.created_at.slice(0, 10)
        const b = daily.find(d => d.date === dateStr)
        if (b) {
            b.bargainDiscount += Number(exp.amount)
        }
    }

    // Map order cancellation costs to daily buckets
    for (const exp of cancellationExpenses ?? []) {
        const dateStr = exp.created_at.slice(0, 10)
        const b = daily.find(d => d.date === dateStr)
        if (b) {
            b.cancellationCost += Number(exp.amount)
        }
    }

    // Calculate occupied rooms per day for the last 30 days
    const totalRooms = totalRoomsCount || 1
    for (const b of daily) {
        const bucketDateStr = b.date
        const bucketDate = new Date(bucketDateStr)

        // Find bookings active on this date
        const activeBookings = (bookings30d ?? []).filter(booking => {
            const start = new Date(booking.check_in.slice(0, 10))
            const end = new Date(booking.check_out.slice(0, 10))
            return bucketDate >= start && bucketDate < end
        })

        b.occupiedRoomsCount = activeBookings.length
    }

    // Rush hour buckets (24h)
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }))
    for (const o of delivered30d ?? []) {
        hourly[new Date(o.placed_at).getHours()].orders++
    }

    // KPIs — current periods
    const d7iso  = d7.toISOString()
    const d14iso = d14.toISOString()
    const rev7d  = (delivered30d ?? []).filter(o => o.placed_at >= d7iso).reduce((s, o) => s + (o.total_amount ?? 0), 0)
    const ord7d  = (delivered30d ?? []).filter(o => o.placed_at >= d7iso).length
    const rev30d = (delivered30d ?? []).reduce((s, o) => s + (o.total_amount ?? 0), 0)
    const ord30d = (delivered30d ?? []).length

    // KPIs — previous periods
    const prevRev7d  = (delivered30d ?? []).filter(o => o.placed_at >= d14iso && o.placed_at < d7iso).reduce((s, o) => s + (o.total_amount ?? 0), 0)
    const prevOrd7d  = (delivered30d ?? []).filter(o => o.placed_at >= d14iso && o.placed_at < d7iso).length
    const prevRev30d = (prevDelivered30d ?? []).reduce((s, o) => s + (o.total_amount ?? 0), 0)
    const prevOrd30d = (prevDelivered30d ?? []).length

    // Feedback
    const avgRating = recentFeedback?.length
        ? recentFeedback.reduce((s, f) => s + f.rating, 0) / recentFeedback.length
        : null
    const ratingCounts = [1, 2, 3, 4, 5].map(r => ({
        star: r,
        count: recentFeedback?.filter(f => f.rating === r).length ?? 0,
    }))
    const topComments = (recentFeedback ?? []).filter(f => f.comment).slice(0, 5)

    // Hotel Metrics Summary
    // Calculate total room revenue in last 30 days
    const totalRoomRev30d = (bookings30d ?? [])
        .filter(b => b.status === 'checked_out')
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0)

    const totalDiscount30d = (bookings30d ?? [])
        .filter(b => b.status === 'checked_out')
        .reduce((sum, b) => sum + Number(b.discount_amount || 0), 0)

    return (
        <div className="space-y-6">
            <AnalyticsDashboard
                daily={daily}
                hourly={hourly}
                topItems={topItems}
                cancelled={(cancelledOrders ?? []).map(o => ({
                    id: o.id,
                    note: o.customer_note,
                    placed_at: o.placed_at,
                    total: o.total_amount ?? 0,
                }))}
                kpis={{
                    rev7d, ord7d, aov7d: ord7d > 0 ? rev7d / ord7d : 0,
                    rev30d, ord30d, aov30d: ord30d > 0 ? rev30d / ord30d : 0,
                    prevRev7d, prevOrd7d,
                    prevRev30d, prevOrd30d,
                    avgRating, ratingCount: recentFeedback?.length ?? 0,
                }}
                ratingCounts={ratingCounts}
                topComments={topComments}
                topSuppliers={topSuppliers}
                hotelMetrics={{
                    totalRooms,
                    totalRoomRev30d,
                    totalDiscount30d,
                    bargainLeakage30d: bargainExpenses?.reduce((s, exp) => s + Number(exp.amount), 0) || 0
                }}
            />
        </div>
    )
}
