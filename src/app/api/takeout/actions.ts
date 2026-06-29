'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { CartItem, TakeoutOrder } from '@/types/database'
import { checkAndAlertLowStock } from '@/app/(admin)/admin/ingredients/actions'
import { requireRole } from '@/lib/auth'
import {
    TAKEOUT_ORDER_SELECT,
    TAKEOUT_STATUS_TO_ORDER,
    mapOrderRowToTakeout,
    type TakeoutOrderRow,
    type OrderStatus,
} from '@/lib/takeout'

interface TakeoutInput {
    restaurantId: string
    customerName: string
    customerPhone: string
    customerEmail?: string
    pickupTime: string // ISO string
    items: CartItem[]
    customerNote?: string
    promoCode?: string | null
    loyaltyMemberId?: string | null
    clientRequestId?: string | null
}

interface DeliveryInput {
    restaurantId: string
    customerName: string
    customerPhone: string
    deliveryAddress: string
    customerEmail?: string
    items: CartItem[]
    customerNote?: string
    promoCode?: string | null
    loyaltyMemberId?: string | null
    clientRequestId?: string | null
}

/**
 * Place an online delivery order through the unified orders pipeline
 * (place_delivery_order RPC). Same as takeout, plus a delivery address and a
 * 4-digit verification code the customer reads back to the delivery staff.
 */
export async function createDeliveryOrder(
    input: DeliveryInput
): Promise<{ orderId?: string; total?: number; code?: string; error?: string }> {
    const supabase = await createAdminClient()

    const payload = input.items.map((i) => ({
        menu_item_id: i.menuItemId,
        quantity: i.quantity,
        special_request: i.specialRequest || null,
        modifiers: (i.modifiers || []).map((m) => ({ modifier_id: m.modifierId })),
    }))

    const { data, error } = await supabase.rpc('place_delivery_order', {
        p_restaurant_id: input.restaurantId,
        p_items: payload,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone,
        p_delivery_address: input.deliveryAddress,
        p_customer_email: input.customerEmail || null,
        p_customer_note: input.customerNote || null,
        p_promo_code: input.promoCode || null,
        p_loyalty_member_id: input.loyaltyMemberId || null,
        p_client_request_id: input.clientRequestId || null,
    })

    if (error) {
        console.error('Delivery order RPC error:', error)
        if (error.message?.includes('OUT_OF_STOCK') || error.message?.includes('ITEM_UNAVAILABLE')) {
            return { error: 'Sorry, one or more items just sold out or are unavailable.' }
        }
        if (error.message?.includes('INVALID_RESTAURANT')) {
            return { error: 'This restaurant is not currently accepting orders.' }
        }
        return { error: 'Failed to place delivery order. Please try again.' }
    }

    const result = data as { order_id: string; total: number; code: string }
    if (result.order_id) void checkAndAlertLowStock(input.restaurantId)

    revalidatePath('/kitchen')
    revalidatePath('/waiter')
    revalidatePath('/admin/takeout')

    return { orderId: result.order_id, total: result.total, code: result.code }
}

/**
 * Place a takeout order through the unified orders pipeline (place_takeout_order
 * RPC): real order_items, ingredient deduction, dynamic pricing, promo, tax and
 * loyalty — the same as dine-in, minus the table session.
 */
export async function createTakeoutOrder(
    input: TakeoutInput
): Promise<{ orderId?: string; total?: number; error?: string }> {
    const supabase = await createAdminClient()

    const payload = input.items.map((i) => ({
        menu_item_id: i.menuItemId,
        quantity: i.quantity,
        special_request: i.specialRequest || null,
        modifiers: (i.modifiers || []).map((m) => ({ modifier_id: m.modifierId })),
    }))

    const { data, error } = await supabase.rpc('place_takeout_order', {
        p_restaurant_id: input.restaurantId,
        p_items: payload,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone,
        p_customer_email: input.customerEmail || null,
        p_pickup_time: input.pickupTime,
        p_customer_note: input.customerNote || null,
        p_promo_code: input.promoCode || null,
        p_loyalty_member_id: input.loyaltyMemberId || null,
        p_client_request_id: input.clientRequestId || null,
    })

    if (error) {
        console.error('Takeout order RPC error:', error)
        if (error.message?.includes('OUT_OF_STOCK') || error.message?.includes('ITEM_UNAVAILABLE')) {
            return { error: 'Sorry, one or more items just sold out or are unavailable.' }
        }
        if (error.message?.includes('INVALID_RESTAURANT')) {
            return { error: 'This restaurant is not currently accepting orders.' }
        }
        return { error: 'Failed to place takeout order. Please try again.' }
    }

    const result = data as { order_id: string; total: number }

    // Low-stock check in the background (never blocks the order).
    if (result.order_id) void checkAndAlertLowStock(input.restaurantId)

    revalidatePath('/takeout')
    revalidatePath('/kitchen')
    revalidatePath('/waiter')
    revalidatePath('/admin/takeout')

    return { orderId: result.order_id, total: result.total }
}

// Active (kitchen-relevant) takeout statuses.
const ACTIVE_TAKEOUT_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready']

export async function getTakeoutOrders(
    restaurantId: string,
    status?: string,
    limit = 100,
): Promise<TakeoutOrder[]> {
    const supabase = await createAdminClient()

    let query = supabase
        .from('orders')
        .select(TAKEOUT_ORDER_SELECT)
        .eq('restaurant_id', restaurantId)
        .in('order_type', ['takeout', 'delivery'])
        .order('pickup_time', { ascending: true })
        .limit(limit)

    if (status) {
        const mapped = TAKEOUT_STATUS_TO_ORDER[status as keyof typeof TAKEOUT_STATUS_TO_ORDER]
        if (mapped) query = query.eq('status', mapped)
    } else {
        // No status filter = the kitchen's live queue: only active orders, never
        // the entire (unbounded) takeout history.
        query = query.in('status', ACTIVE_TAKEOUT_ORDER_STATUSES)
    }

    const { data } = await query
    return ((data || []) as unknown as TakeoutOrderRow[]).map(mapOrderRowToTakeout)
}

export async function updateTakeoutStatus(
    orderId: string,
    status: 'confirmed' | 'preparing' | 'ready_for_pickup' | 'picked_up' | 'cancelled'
): Promise<{ error?: string }> {
    const supabase = await createAdminClient()

    const orderStatus: OrderStatus = TAKEOUT_STATUS_TO_ORDER[status]
    const updateData: Record<string, unknown> = { status: orderStatus }
    const now = new Date().toISOString()

    if (orderStatus === 'confirmed') updateData.confirmed_at = now
    if (orderStatus === 'ready') updateData.ready_at = now
    if (orderStatus === 'delivered') updateData.delivered_at = now

    const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .in('order_type', ['takeout', 'delivery'])

    if (error) return { error: 'Failed to update status.' }

    revalidatePath('/takeout')
    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    revalidatePath('/admin/takeout')
    return {}
}

/**
 * Complete a takeout order: mark picked up (delivered) + paid.
 * Used by the waiter/cashier when the customer arrives to pay and collect.
 */
export async function completeTakeoutOrder(
    orderId: string
): Promise<{ error?: string }> {
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('orders')
        .update({
            status: 'delivered',
            payment_status: 'paid',
            delivered_at: new Date().toISOString(),
            paid_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('order_type', 'takeout')

    if (error) return { error: 'Failed to complete order.' }

    revalidatePath('/waiter')
    revalidatePath('/admin/takeout')
    revalidatePath('/takeout')
    return {}
}

// ===== Online delivery: staff claim + code-verified completion =====

export interface DeliveryOrderRow {
    id: string
    customer_name: string | null
    customer_phone: string | null
    delivery_address: string | null
    total_amount: number | string | null
    placed_at: string
    ready_at: string | null
    status: string
    delivery_staff_id: string | null
    order_items?: { id: string; quantity: number; menu_items: { name: string } | { name: string }[] | null }[] | null
}

const DELIVERY_SELECT = `
    id, customer_name, customer_phone, delivery_address, total_amount, placed_at, ready_at,
    status, delivery_staff_id,
    order_items ( id, quantity, menu_items ( name ) )
`

/** Ready delivery orders awaiting a delivery person. */
export async function getReadyDeliveries(restaurantId: string): Promise<DeliveryOrderRow[]> {
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('orders')
        .select(DELIVERY_SELECT)
        .eq('restaurant_id', restaurantId)
        .eq('order_type', 'delivery')
        .eq('status', 'ready')
        .order('ready_at', { ascending: true })
        .limit(30)
    return (data || []) as unknown as DeliveryOrderRow[]
}

/** "I am going" — claim a ready delivery; first to act owns it. */
export async function claimDelivery(orderId: string): Promise<{ success?: boolean; error?: string; conflict?: boolean }> {
    const user = await requireRole('waiter', 'manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('orders')
        .update({ delivery_staff_id: user.id })
        .eq('id', orderId)
        .eq('order_type', 'delivery')
        .eq('status', 'ready')
        .is('delivery_staff_id', null)
        .select('id')
    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Another delivery person already took this' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function releaseDelivery(orderId: string): Promise<{ success?: boolean; error?: string }> {
    const user = await requireRole('waiter', 'manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()
    await supabase
        .from('orders')
        .update({ delivery_staff_id: null })
        .eq('id', orderId)
        .eq('delivery_staff_id', user.id)
    revalidatePath('/waiter')
    return { success: true }
}

/** Mark delivered after verifying the customer's secret code. Owner-only. */
export async function markDeliveryDelivered(
    orderId: string,
    code: string
): Promise<{ success?: boolean; error?: string; conflict?: boolean; wrongCode?: boolean }> {
    const user = await requireRole('waiter', 'manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()

    const { data: order } = await supabase
        .from('orders')
        .select('delivery_verification_code, delivery_staff_id, status')
        .eq('id', orderId)
        .eq('order_type', 'delivery')
        .single()

    if (!order) return { error: 'Order not found' }
    if (order.status === 'delivered') return { error: 'Already delivered' }
    if (order.delivery_staff_id && order.delivery_staff_id !== user.id) {
        return { error: 'This delivery is assigned to someone else' }
    }
    if ((code || '').trim() !== (order.delivery_verification_code || '')) {
        return { wrongCode: true, error: 'Incorrect code — check with the customer' }
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
        .from('orders')
        .update({ status: 'delivered', delivered_at: now, delivery_staff_id: user.id })
        .eq('id', orderId)
        .eq('status', 'ready')
        .select('id')
    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Order changed — please refresh' }

    await supabase.from('order_items').update({ status: 'served' }).eq('order_id', orderId).neq('status', 'cancelled')

    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    return { success: true }
}
