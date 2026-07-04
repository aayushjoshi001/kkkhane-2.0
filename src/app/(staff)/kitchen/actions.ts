'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import type { OrderStatus, OrderItemStatus } from '@/types/database'
import { rollUpOrderStatus } from '@/lib/orderRollup'

// Shared SELECT shape for kitchen orders — mirrors what OrderQueue.tsx expects.
const KITCHEN_ORDER_SELECT = `
  id, status, order_type, needs_confirmation, total_amount, placed_at, customer_note,
  sessions ( tables ( label ) ),
  order_items (
    id, menu_item_id, quantity, unit_price, special_request, status, claimed_by, claimed_at,
    menu_items ( id, name, is_combo ),
    order_item_modifiers ( modifier_name, price_adjustment )
  )
` as const

/**
 * Fetch the current active kitchen orders for a restaurant, applying the same
 * server-side filter that page.tsx uses. Called by the kitchen client on mount
 * and whenever the realtime channel reconnects, to catch up on missed events.
 */
export async function getKitchenOrders(restaurantId: string) {
    await requireRole('kitchen', 'manager', 'super_admin', 'cashier')
    const adminSupabase = await createAdminClient()
    const { data, error } = await adminSupabase
        .from('orders')
        .select(KITCHEN_ORDER_SELECT)
        .eq('restaurant_id', restaurantId)
        .in('order_type', ['dine_in', 'takeout', 'delivery'])
        .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
        .order('placed_at', { ascending: true })

    if (error) {
        console.error('[getKitchenOrders] fetch error:', error)
        return []
    }

    // Apply same filter as page.tsx:
    //   dine_in  → exclude orders still awaiting waiter confirmation
    //   takeout/delivery → exclude pending (not yet confirmed by cashier)
    return (data || []).filter(o => {
        if (o.order_type === 'dine_in') return !o.needs_confirmation
        return o.status !== 'pending'
    })
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
    await requireRole('kitchen', 'manager', 'super_admin', 'cashier')
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
    } else if (nextStatus === 'ready') {
        updateData.claimed_by = null
        updateData.claimed_at = null
    }

    let query = adminSupabase
        .from('order_items')
        .update(updateData)
        .eq('order_id', orderId)
        .in('id', itemIds)

    if (nextStatus === 'preparing') {
        query = query.eq('status', 'pending').is('claimed_by', null)
    } else if (nextStatus === 'ready') {
        // Workaround for PostgREST / Supabase JS bug: .or() fails with "column does not exist" on .update()
        // We verify ownership atomically with a .select() first.
        let validItemIds = itemIds
        if (actorUserId) {
            const { data: validItems } = await adminSupabase
                .from('order_items')
                .select('id')
                .in('id', itemIds)
                .eq('status', 'preparing')
                .or(`claimed_by.eq.${actorUserId},claimed_by.is.null`)
                
            validItemIds = (validItems || []).map(i => i.id)
            if (validItemIds.length === 0) {
                return {
                    conflict: true,
                    error: 'Only the chef who started a dish can mark it ready'
                }
            }
        }
        
        query = adminSupabase
            .from('order_items')
            .update(updateData)
            .eq('order_id', orderId)
            .in('id', validItemIds)
            .eq('status', 'preparing')
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
