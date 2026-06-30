'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { requireRole } from '@/lib/auth'
import { rollUpOrderStatus } from '@/lib/orderRollup'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'
import { checkAndAlertLowStock } from '@/app/(admin)/admin/ingredients/actions'
import type { OrderStatus, OrderItemStatus } from '@/types/database'

/**
 * Soft-claim a ready order ("On my way"). Advisory only — it doesn't block
 * another waiter from delivering, but it lets the floor see who's handling it.
 * The claim is atomic: it succeeds only if the order is still `ready` AND
 * unclaimed, so two waiters tapping at once can't both win.
 */
export async function claimOrder(
    orderId: string
): Promise<{ success?: boolean; error?: string; conflict?: boolean; claimedById?: string }> {
    const currentUser = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: rows, error } = await supabase
        .from('orders')
        .update({ claimed_by: currentUser.id, claimed_at: new Date().toISOString() })
        .eq('id', orderId)
        // A partially-ready order sits at 'preparing' but already has servable
        // items, so it must be claimable too — not just fully 'ready' orders.
        .in('status', ['preparing', 'ready'])
        .is('claimed_by', null)
        .select('id')

    if (error) {
        console.error('Failed to claim order:', error)
        return { error: error.message }
    }
    if (!rows || rows.length === 0) {
        // Someone already claimed it (or it left the ready state). Report who.
        const { data: current } = await supabase
            .from('orders')
            .select('claimed_by')
            .eq('id', orderId)
            .single()
        return { conflict: true, error: 'Already claimed', claimedById: current?.claimed_by ?? undefined }
    }

    revalidatePath('/waiter')
    return { success: true, claimedById: currentUser.id }
}

/**
 * Release a claim you hold (or that any manager wants to free up), so another
 * waiter can pick the order up. Only clears the claim if the order is still
 * ready — once delivered it leaves the feed anyway.
 */
export async function releaseOrder(
    orderId: string
): Promise<{ success?: boolean; error?: string }> {
    await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('orders')
        .update({ claimed_by: null, claimed_at: null })
        .eq('id', orderId)
        .in('status', ['preparing', 'ready'])

    if (error) {
        console.error('Failed to release order:', error)
        return { error: error.message }
    }

    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Waiter marks an order as delivered.
 * Step 7 of the Golden Path: Waiter picks up ready food & delivers.
 */
export async function markOrderDelivered(orderId: string) {
    const currentUser = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const adminSupabase = await createAdminClient()

    // Only a 'ready' order can be delivered. Guarding on the prior status means
    // two waiters racing to deliver the same order — or a stale screen acting on
    // an order already delivered/cancelled — don't both write delivered_at.
    const { data: rows, error } = await adminSupabase
        .from('orders')
        .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('status', 'ready')
        .select('restaurant_id')

    if (error) {
        console.error('Failed to mark order delivered:', error)
        return { error: error.message }
    }
    if (!rows || rows.length === 0) {
        return { conflict: true, error: 'Order is no longer awaiting delivery' }
    }
    const order = rows[0]

    // Delivering the whole order serves every (non-cancelled) line item, keeping
    // item-level state consistent with the rolled-up order status.
    await adminSupabase
        .from('order_items')
        .update({ status: 'served' })
        .eq('order_id', orderId)
        .neq('status', 'cancelled')

    void logAudit({
        restaurantId: order.restaurant_id,
        userId: currentUser.id,
        action: 'order_delivered',
        entityType: 'order',
        entityId: orderId,
        newValue: { status: 'delivered' },
    })

    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Waiter records cash payment for a delivered order.
 * Creates a verified payment_verification record (cash method) and marks the
 * order paid. Closes the session automatically if all orders are now settled.
 */
export async function markCashPaid(
    orderId: string
): Promise<{ error?: string; success?: boolean; tableClosed?: boolean }> {
    const currentUser = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    // 1. Fetch order details
    const { data: order, error: orderFetchError } = await supabase
        .from('orders')
        .select('id, restaurant_id, session_id, total_amount, payment_status')
        .eq('id', orderId)
        .single()

    if (orderFetchError || !order) return { error: 'Order not found' }
    if (order.payment_status === 'paid') return { error: 'Order is already marked as paid' }

    // 2. Mark the order as paid. The fetch above is a check-then-act TOCTOU:
    // two staff collecting the same cash could both pass it. The `.neq` makes
    // the flip atomic — only the call that actually changes the row proceeds to
    // record a payment (otherwise we'd double-count revenue + audit).
    const { data: paidRows, error: updateError } = await supabase
        .from('orders')
        .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', orderId)
        .neq('payment_status', 'paid')
        .select('id')

    if (updateError) return { error: updateError.message }
    if (!paidRows || paidRows.length === 0) {
        // Lost the race — another staff member already settled this order.
        return { error: 'Order is already marked as paid' }
    }

    // 3. Insert a verified cash payment_verification record
    await supabase.from('payment_verifications').insert({
        restaurant_id: order.restaurant_id,
        order_id: orderId,
        amount: order.total_amount,
        payment_method: 'cash',
        staff_verified: true,
        staff_rejected: false,
        staff_verified_by: currentUser.id,
        staff_verified_at: new Date().toISOString(),
    })

    void logAudit({
        restaurantId: order.restaurant_id,
        userId: currentUser.id,
        action: 'payment_verified',
        entityType: 'payment',
        entityId: orderId,
        newValue: { payment_method: 'cash', amount: order.total_amount },
    })

    // 4. Close session if all orders in session are now paid
    let tableClosed = false
    if (order.session_id) {
        // The customer's "send a waiter to collect cash" request is now fulfilled.
        await supabase
            .from('service_requests')
            .update({ status: 'completed', completed_at: new Date().toISOString() })
            .eq('session_id', order.session_id)
            .eq('request_type', 'request_bill')
            .in('status', ['pending', 'acknowledged'])

        const { count: unresolvedCount } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', order.session_id)
            .neq('status', 'cancelled')
            .or('payment_status.not.in.(paid,refunded),status.neq.delivered')

        if (unresolvedCount === 0) {
            await supabase
                .from('sessions')
                .update({ status: 'closed', closed_at: new Date().toISOString() })
                .eq('id', order.session_id)
                .eq('status', 'active')

            await markTableDirtyForSession(supabase, order.session_id)

            void logAudit({
                restaurantId: order.restaurant_id,
                userId: currentUser.id,
                action: 'session_closed',
                entityType: 'session',
                entityId: order.session_id,
                newValue: { reason: 'all_orders_paid' },
            })

            tableClosed = true
        }
    }

    revalidatePath('/waiter')
    return { success: true, tableClosed }
}

/**
 * Waiter marks a ready order as delivered AND collected cash in one step.
 * Combines markOrderDelivered + markCashPaid so the waiter doesn't need two taps.
 */
export async function markDeliveredAndCashPaid(
    orderId: string
): Promise<{ error?: string; success?: boolean; tableClosed?: boolean }> {
    const currentUser = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('id, restaurant_id, session_id, total_amount, payment_status, status')
        .eq('id', orderId)
        .single()

    if (fetchError || !order) return { error: 'Order not found' }
    if (order.payment_status === 'paid') return { error: 'Order is already marked as paid' }

    const now = new Date().toISOString()

    // Atomic paid-flip (see markCashPaid) — guards against two waiters taking
    // cash for the same order at once, which would double-count revenue.
    const { data: paidRows, error: updateError } = await supabase
        .from('orders')
        .update({ status: 'delivered', delivered_at: now, payment_status: 'paid', paid_at: now })
        .eq('id', orderId)
        .neq('payment_status', 'paid')
        .in('status', ['ready', 'delivered'])
        .select('id')

    if (updateError) return { error: updateError.message }
    if (!paidRows || paidRows.length === 0) {
        return { error: 'Order is not ready for delivery or is already paid' }
    }

    // Mark every line item served — this order was delivered in this same step.
    await supabase
        .from('order_items')
        .update({ status: 'served' })
        .eq('order_id', orderId)
        .neq('status', 'cancelled')

    await supabase.from('payment_verifications').insert({
        restaurant_id: order.restaurant_id,
        order_id: orderId,
        amount: order.total_amount,
        payment_method: 'cash',
        staff_verified: true,
        staff_rejected: false,
        staff_verified_by: currentUser.id,
        staff_verified_at: now,
    })

    void logAudit({
        restaurantId: order.restaurant_id,
        userId: currentUser.id,
        action: 'payment_verified',
        entityType: 'payment',
        entityId: orderId,
        newValue: { payment_method: 'cash', amount: order.total_amount, combined_deliver: true },
    })

    let tableClosed = false
    if (order.session_id) {
        // The customer's "send a waiter to collect cash" request is now fulfilled.
        await supabase
            .from('service_requests')
            .update({ status: 'completed', completed_at: now })
            .eq('session_id', order.session_id)
            .eq('request_type', 'request_bill')
            .in('status', ['pending', 'acknowledged'])

        const { count: unresolvedCount } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', order.session_id)
            .neq('status', 'cancelled')
            .or('payment_status.not.in.(paid,refunded),status.neq.delivered')

        if (unresolvedCount === 0) {
            await supabase
                .from('sessions')
                .update({ status: 'closed', closed_at: now })
                .eq('id', order.session_id)
                .eq('status', 'active')

            await markTableDirtyForSession(supabase, order.session_id)

            void logAudit({
                restaurantId: order.restaurant_id,
                userId: currentUser.id,
                action: 'session_closed',
                entityType: 'session',
                entityId: order.session_id,
                newValue: { reason: 'all_orders_paid' },
            })

            tableClosed = true
        }
    }

    revalidatePath('/waiter')
    return { success: true, tableClosed }
}

/**
 * Waiter serves a selected subset of an order's READY items (partial serving
 * across multiple trips), then recomputes the parent order's status. When the
 * last item is served the order rolls up to 'delivered' and leaves the feed.
 *
 * Only items currently 'ready' can be served — guarding on that prior state
 * means two waiters tapping the same item can't both "serve" it.
 */
export async function markOrderItemsServed(
    orderId: string,
    itemIds: string[]
): Promise<{ success?: boolean; error?: string; conflict?: boolean; delivered?: boolean }> {
    if (itemIds.length === 0) return { error: 'No items selected' }
    const currentUser = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: served, error } = await supabase
        .from('order_items')
        .update({ status: 'served' })
        .eq('order_id', orderId)
        .in('id', itemIds)
        .eq('status', 'ready')
        .select('id')

    if (error) {
        console.error('Failed to mark items served:', error)
        return { error: error.message }
    }
    if (!served || served.length === 0) {
        return { conflict: true, error: 'Those items were already served by someone else' }
    }

    // Recompute the order's rolled-up status from ALL its items, written once.
    const { data: allItems } = await supabase
        .from('order_items')
        .select('status')
        .eq('order_id', orderId)

    const rolled = rollUpOrderStatus((allItems || []).map(i => i.status as OrderItemStatus))
    let delivered = false
    if (rolled) {
        const patch: { status: OrderStatus; ready_at?: string; delivered_at?: string } = { status: rolled }
        const nowIso = new Date().toISOString()
        if (rolled === 'ready') patch.ready_at = nowIso
        if (rolled === 'delivered') { patch.delivered_at = nowIso; delivered = true }
        await supabase
            .from('orders')
            .update(patch)
            .eq('id', orderId)
            .not('status', 'in', '("delivered","cancelled")')
    }

    if (delivered) {
        const { data: ord } = await supabase
            .from('orders')
            .select('restaurant_id')
            .eq('id', orderId)
            .single()
        if (ord?.restaurant_id) {
            void logAudit({
                restaurantId: ord.restaurant_id,
                userId: currentUser.id,
                action: 'order_delivered',
                entityType: 'order',
                entityId: orderId,
                newValue: { via: 'item_serve' },
            })
        }
    }

    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    return { success: true, delivered }
}

/**
 * Mode 2 — waiter order confirmation.
 *
 * confirmOrder: the customer is really seated → release the order to the kitchen
 * and deduct stock now (deduction was deferred at placement). Atomic on
 * needs_confirmation so two waiters can't both confirm/reject the same order.
 *
 * rejectOrder: not a real order → cancel it with a reason shown to the customer.
 * No stock to restore (it was never deducted).
 */
export async function confirmOrder(
    orderId: string
): Promise<{ success?: boolean; error?: string; conflict?: boolean }> {
    const currentUser = await requireRole('waiter', 'manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('orders')
        .update({ needs_confirmation: false, status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('needs_confirmation', true)
        .select('id, restaurant_id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) {
        return { conflict: true, error: 'This order was already handled by someone else' }
    }

    // Deduction was deferred to confirmation — do it now (best-effort, never blocks).
    const { error: deductError } = await supabase.rpc('deduct_ingredients_for_order', { p_order_id: orderId })
    if (deductError) {
        console.error('[confirmOrder] deduct_ingredients failed:', deductError)
    } else if (data[0].restaurant_id) {
        void checkAndAlertLowStock(data[0].restaurant_id)
    }

    void logAudit({
        restaurantId: data[0].restaurant_id,
        userId: currentUser.id,
        action: 'order_confirmed',
        entityType: 'order',
        entityId: orderId,
        newValue: { mode: 'waiter_confirmation' },
    })

    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    return { success: true }
}

export async function rejectOrder(
    orderId: string,
    reason: string
): Promise<{ success?: boolean; error?: string; conflict?: boolean }> {
    const currentUser = await requireRole('waiter', 'manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()

    const cleanReason = (reason || '').trim().slice(0, 200) || 'Rejected by waiter'

    const { data, error } = await supabase
        .from('orders')
        .update({ status: 'cancelled', needs_confirmation: false, cancellation_reason: cleanReason })
        .eq('id', orderId)
        .eq('needs_confirmation', true)
        .neq('status', 'cancelled')
        .select('id, restaurant_id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) {
        return { conflict: true, error: 'This order was already handled by someone else' }
    }

    void logAudit({
        restaurantId: data[0].restaurant_id,
        userId: currentUser.id,
        action: 'order_rejected',
        entityType: 'order',
        entityId: orderId,
        newValue: { reason: cleanReason },
    })

    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    return { success: true }
}
