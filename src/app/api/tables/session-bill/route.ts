import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

/**
 * The authoritative, still-billable orders of one table session — exactly the
 * set /api/tables/checkout settles against (same restaurant scope, same
 * "not cancelled, not already paid" filter).
 *
 * The cashier screen otherwise bills off its own long-lived local lists, which
 * are seeded once on page load and patched by realtime events. Anything those
 * lists miss — an order dropped by a fetch cap, a realtime event that arrived
 * while the tab was asleep, an order placed by a waiter seconds before the
 * bill was compiled — makes the printed estimate smaller than what checkout
 * charges, and the settlement then bounces off the server's reconciliation
 * check ("Cash + QR + Credit must add up to the total") with no way for the
 * cashier to fix it from the screen. Re-reading the bill from here right
 * before the invoice is compiled closes that whole class of failure.
 */
export async function GET(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const sessionId = searchParams.get('session_id')
        if (!sessionId) {
            return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id, status, payment_status, total_amount, service_charge_amount, tax_amount, placed_at,
                session_id, booking_id, order_type, customer_name, customer_phone,
                order_items ( id, quantity, status, unit_price, special_request, needs_confirmation, menu_items ( name ), menu_item_variations:menu_item_variation_id ( id, name ) )
            `)
            .eq('session_id', sessionId)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid')
            .order('placed_at', { ascending: true })

        if (error) throw error

        const rows = orders || []
        const total = Math.round(rows.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) * 100) / 100
        const serviceCharge = Math.round(rows.reduce((sum, o) => sum + (Number(o.service_charge_amount) || 0), 0) * 100) / 100

        return NextResponse.json({ success: true, orders: rows, total, serviceCharge })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
