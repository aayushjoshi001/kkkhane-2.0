// What each member of staff actually did, over a date range.
//
// The manager's question is per-person and per-day: which cashier took which
// money, which waiter sold what, who cooked, and who gave discounts away. The
// answers were technically in the database and unreachable in practice —
// spread across four tables with no single place that joined them up, and with
// two of the four attribution columns never written at all until now.
//
// Everything here is read-only aggregation. It reports what the operational
// tables already say; it never becomes a second source of truth for money.
//
// A note on which timestamp each figure hangs off, because they differ and it
// matters at the edges of a day:
//   • a waiter's order counts on `placed_at`  — when they took it
//   • a cashier's bill counts on `paid_at`    — when they settled it
//   • a chef's dish counts on `created_at`    — when the line was ordered
// An order taken at 11pm and settled at 1am therefore lands on different days
// for the waiter and the cashier, which is correct: they did their halves of it
// on different days.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Everything one person did in the window. Zeroed rather than absent, so the
 *  report can list a member of staff who did nothing without special-casing. */
export interface StaffActivity {
    userId: string
    fullName: string
    role: string

    // ── As a waiter ──
    /** Orders they took. */
    ordersTaken: number
    /** Value of those orders. */
    ordersValue: number
    /** Items across those orders. */
    itemsSold: number
    /** How many of `ordersTaken` were reconstructed rather than recorded —
     *  see orders.waiter_id_inferred. Shown so a guess never reads as a fact. */
    ordersInferred: number

    // ── As a cashier ──
    /** Bills they settled: orders plus room stays. */
    billsSettled: number
    /** Total money they took across those bills. */
    amountCollected: number
    /** Largest single bill they settled — the one worth a second look. */
    largestBill: number

    // ── At the pass ──
    /** Dishes they cooked. */
    itemsPrepared: number

    // ── Oversight ──
    /** Discounts they applied, and what those cost. */
    discountsGiven: number
    discountTotal: number
    /** Orders or items they cancelled, and bills they reopened. */
    cancellations: number
}

export interface StaffActivityRange {
    /** Inclusive ISO instant. */
    from: string
    /** Exclusive ISO instant. */
    to: string
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Actions in the audit log that mean money was given away or taken back. */
const DISCOUNT_ACTIONS = new Set(['booking_checked_out', 'table_session_checked_out', 'order_checked_out'])
const CANCELLATION_ACTIONS = new Set(['order_cancelled', 'order_item_removed', 'order_rejected'])

/**
 * Per-person activity for one restaurant over a window.
 *
 * Returns a row for every member of staff, including those who did nothing —
 * an empty row is a real answer to "what did they do today", and dropping them
 * would quietly hide the people a manager most wants to notice.
 */
export async function getStaffActivity(
    supabase: SupabaseClient,
    restaurantId: string,
    range: StaffActivityRange,
): Promise<StaffActivity[]> {
    const { from, to } = range

    const [staffRes, waiterRes, cashierRes, bookingRes, chefRes, auditRes] = await Promise.all([
        supabase
            .from('users')
            .select('id, full_name, roles(name)')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true),

        // Orders they took. Cancelled orders are left out — an order that never
        // happened is not work done, and counting it would reward voiding.
        supabase
            .from('orders')
            .select('id, waiter_id, waiter_id_inferred, total_amount, order_items(id, quantity, status)')
            .eq('restaurant_id', restaurantId)
            .not('waiter_id', 'is', null)
            .neq('status', 'cancelled')
            .gte('placed_at', from)
            .lt('placed_at', to),

        // Bills they settled, on the moment the money was taken.
        supabase
            .from('orders')
            .select('id, cashier_id, total_amount')
            .eq('restaurant_id', restaurantId)
            .not('cashier_id', 'is', null)
            .neq('status', 'cancelled')
            .gte('paid_at', from)
            .lt('paid_at', to),

        // Room stays settle through their own table, and count towards the same
        // cashier's day as the orders they rang up.
        supabase
            .from('bookings')
            .select('id, cashier_id, total_amount, checked_out_at, bill_settled_at')
            .eq('restaurant_id', restaurantId)
            .not('cashier_id', 'is', null)
            .neq('status', 'cancelled')
            .gte('created_at', '1970-01-01'),

        supabase
            .from('order_items')
            .select('id, chef_id, quantity, orders!inner(restaurant_id)')
            .not('chef_id', 'is', null)
            .eq('orders.restaurant_id', restaurantId)
            .neq('status', 'cancelled')
            .gte('created_at', from)
            .lt('created_at', to),

        supabase
            .from('audit_logs')
            .select('id, user_id, action, new_value')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', from)
            .lt('created_at', to),
    ])

    const blank = (userId: string, fullName: string, role: string): StaffActivity => ({
        userId, fullName, role,
        ordersTaken: 0, ordersValue: 0, itemsSold: 0, ordersInferred: 0,
        billsSettled: 0, amountCollected: 0, largestBill: 0,
        itemsPrepared: 0,
        discountsGiven: 0, discountTotal: 0, cancellations: 0,
    })

    const byUser = new Map<string, StaffActivity>()
    for (const u of staffRes.data || []) {
        const roleRaw = u.roles as unknown
        const roleRow = Array.isArray(roleRaw) ? roleRaw[0] : (roleRaw as { name?: string } | null)
        byUser.set(u.id as string, blank(
            u.id as string,
            (u.full_name as string) || 'Unnamed staff',
            roleRow?.name || 'staff',
        ))
    }

    // A person who has since been deactivated can still own yesterday's work.
    // Materialise a row for them rather than dropping the numbers on the floor.
    const ensure = (userId: string | null | undefined): StaffActivity | null => {
        if (!userId) return null
        let row = byUser.get(userId)
        if (!row) {
            row = blank(userId, 'Former staff', 'inactive')
            byUser.set(userId, row)
        }
        return row
    }

    for (const o of waiterRes.data || []) {
        const row = ensure(o.waiter_id as string)
        if (!row) continue
        row.ordersTaken += 1
        row.ordersValue += Number(o.total_amount) || 0
        if (o.waiter_id_inferred) row.ordersInferred += 1
        const items = (o.order_items as Array<{ quantity: number; status: string }> | null) || []
        row.itemsSold += items
            .filter(i => i.status !== 'cancelled')
            .reduce((s, i) => s + (Number(i.quantity) || 0), 0)
    }

    for (const o of cashierRes.data || []) {
        const row = ensure(o.cashier_id as string)
        if (!row) continue
        const amount = Number(o.total_amount) || 0
        row.billsSettled += 1
        row.amountCollected += amount
        row.largestBill = Math.max(row.largestBill, amount)
    }

    // Bookings carry two possible settlement moments — an early settlement and
    // the departure — and only one of them is when the money was taken. Filter
    // in code rather than SQL because which column applies varies per row.
    for (const b of bookingRes.data || []) {
        const settledAt = (b.bill_settled_at as string | null) || (b.checked_out_at as string | null)
        if (!settledAt || settledAt < from || settledAt >= to) continue
        const row = ensure(b.cashier_id as string)
        if (!row) continue
        const amount = Number(b.total_amount) || 0
        row.billsSettled += 1
        row.amountCollected += amount
        row.largestBill = Math.max(row.largestBill, amount)
    }

    for (const it of chefRes.data || []) {
        const row = ensure(it.chef_id as string)
        if (!row) continue
        row.itemsPrepared += Number(it.quantity) || 0
    }

    for (const log of auditRes.data || []) {
        const row = ensure(log.user_id as string)
        if (!row) continue
        const action = log.action as string
        if (CANCELLATION_ACTIONS.has(action)) {
            row.cancellations += 1
            continue
        }
        if (DISCOUNT_ACTIONS.has(action)) {
            const value = log.new_value as { discount_amount?: number } | null
            const discount = Number(value?.discount_amount) || 0
            if (discount > 0) {
                row.discountsGiven += 1
                row.discountTotal += discount
            }
        }
    }

    return [...byUser.values()]
        .map(r => ({
            ...r,
            ordersValue: round2(r.ordersValue),
            amountCollected: round2(r.amountCollected),
            largestBill: round2(r.largestBill),
            discountTotal: round2(r.discountTotal),
        }))
        // Busiest first — a manager scanning the page wants the people who
        // handled the most money at the top, and the idle rows at the bottom.
        .sort((a, b) =>
            (b.amountCollected + b.ordersValue) - (a.amountCollected + a.ordersValue)
            || a.fullName.localeCompare(b.fullName))
}
