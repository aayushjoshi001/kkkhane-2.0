'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrderStatus, OrderItemStatus } from '@/types/database'
import { rollUpOrderStatus } from '@/lib/orderRollup'

/**
 * Kitchen updates order status: pending → preparing → ready
 * Steps 5-6 of the Golden Path.
 */
// A kitchen screen can hold stale state when several cooks work the same queue.
// Each target status may only be reached from its expected prior status, so the
// DB — not the client's view — decides whether a transition is legal. This stops
// a lagging tab from regressing an order (ready → preparing) or skipping a step.
const ALLOWED_PRIOR: Partial<Record<OrderStatus, OrderStatus[]>> = {
    preparing: ['pending', 'confirmed'],
    ready: ['preparing'],
}

export async function updateOrderStatus(
    orderId: string,
    nextStatus: OrderStatus
): Promise<{ success?: boolean; error?: string; conflict?: boolean }> {
    const adminSupabase = await createAdminClient()

    const updateData: { status: OrderStatus; ready_at?: string } = { status: nextStatus }
    if (nextStatus === 'ready') {
        updateData.ready_at = new Date().toISOString()
    }

    let query = adminSupabase.from('orders').update(updateData).eq('id', orderId)
    const priorStates = ALLOWED_PRIOR[nextStatus]
    if (priorStates) query = query.in('status', priorStates)

    const { data, error } = await query.select('id')

    if (error) {
        console.error('Failed to update order status:', error)
        return { error: error.message }
    }
    if (priorStates && (!data || data.length === 0)) {
        // Another cook already advanced this order; tell the caller to resync.
        return { conflict: true, error: 'Order was already updated by someone else' }
    }

    revalidatePath('/kitchen')
    return { success: true }
}

// Item-level transitions are guarded the same way as whole-order ones: each
// target may only be reached from its expected prior status, so the DB — not a
// lagging tab — decides whether a transition is legal. This is what stops two
// cooks selecting the same item from both "starting" it.
const ALLOWED_ITEM_PRIOR: Partial<Record<OrderItemStatus, OrderItemStatus[]>> = {
    preparing: ['pending'],
    ready: ['preparing'],
    served: ['ready'],
}

/**
 * Advance a selected subset of an order's items to the next status
 * (pending → preparing → ready → served), then recompute and persist the
 * parent order's rolled-up status.
 *
 * The order recompute is done here in the action — not a DB trigger — so the
 * whole change lands as a single orders UPDATE (one realtime event the floor
 * reacts to) and stays easy to reason about.
 */
export async function setOrderItemsStatus(
    orderId: string,
    itemIds: string[],
    nextStatus: OrderItemStatus,
    actorUserId?: string
): Promise<{ success?: boolean; error?: string; conflict?: boolean }> {
    if (itemIds.length === 0) return { error: 'No items selected' }
    const adminSupabase = await createAdminClient()

    // Build the write, then constrain it so only legal transitions land — the DB,
    // not a lagging tab, decides who wins. Each transition has its own guard:
    //   • Cook (→preparing): claim the dish for this chef, but only if it is still
    //     pending AND unclaimed, so two cooks can't both "start" the same item.
    //   • Mark Ready (→ready): only the owning chef (or an unclaimed dish) may
    //     advance it — enforced here so a non-owner's click changes nothing.
    //   • Anything else (e.g. served): plain prior-state guard.
    const updateData: { status: OrderItemStatus; claimed_by?: string | null; claimed_at?: string | null } = {
        status: nextStatus,
    }
    if (nextStatus === 'preparing') {
        updateData.claimed_by = actorUserId ?? null
        updateData.claimed_at = new Date().toISOString()
    }

    let query = adminSupabase
        .from('order_items')
        .update(updateData)
        .eq('order_id', orderId)
        .in('id', itemIds)

    if (nextStatus === 'preparing') {
        query = query.eq('status', 'pending').is('claimed_by', null)
    } else if (nextStatus === 'ready') {
        query = query.eq('status', 'preparing')
        // Owner-only: the claiming chef, or a dish that was never claimed (legacy).
        if (actorUserId) query = query.or(`claimed_by.eq.${actorUserId},claimed_by.is.null`)
    } else {
        const priorStates = ALLOWED_ITEM_PRIOR[nextStatus]
        if (priorStates) query = query.in('status', priorStates)
    }

    const { data: updated, error } = await query.select('id')

    if (error) {
        console.error('Failed to update order item status:', error)
        return { error: error.message }
    }
    if (!updated || updated.length === 0) {
        // Either someone else advanced these, or (for Mark Ready) the actor doesn't
        // own them. Both are surfaced as a conflict so the caller resyncs.
        return {
            conflict: true,
            error: nextStatus === 'ready'
                ? 'Only the chef who started a dish can mark it ready'
                : 'Those items were already updated by someone else',
        }
    }

    // Recompute the order's status from ALL of its items and write it once.
    const { data: allItems } = await adminSupabase
        .from('order_items')
        .select('status')
        .eq('order_id', orderId)

    const rolled = rollUpOrderStatus((allItems || []).map(i => i.status as OrderItemStatus))
    if (rolled) {
        const patch: { status: OrderStatus; ready_at?: string; delivered_at?: string } = { status: rolled }
        const nowIso = new Date().toISOString()
        if (rolled === 'ready') patch.ready_at = nowIso
        if (rolled === 'delivered') patch.delivered_at = nowIso
        // Never drag a finished order back to an earlier state.
        await adminSupabase
            .from('orders')
            .update(patch)
            .eq('id', orderId)
            .not('status', 'in', '("delivered","cancelled")')
    }

    revalidatePath('/kitchen')
    revalidatePath('/waiter')
    return { success: true }
}
