// lib/takeout.ts
// Adapter between the unified `orders` table (order_type='takeout') and the
// legacy TakeoutOrder shape the takeout UI components still render. Lets us
// route takeout through the orders pipeline (KOT, inventory, loyalty) without
// rewriting every takeout component.

import type { TakeoutOrder, TakeoutStatus, PaymentStatus, CartItem } from '@/types/database'

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'

// Takeout's terminal "picked up" maps to order_status 'delivered' (see migration
// 20260622180000_unify_takeout — no enum change).
export const ORDER_STATUS_TO_TAKEOUT: Record<OrderStatus, TakeoutStatus> = {
    pending: 'placed',
    confirmed: 'confirmed',
    preparing: 'preparing',
    ready: 'ready_for_pickup',
    delivered: 'picked_up',
    cancelled: 'cancelled',
}

export const TAKEOUT_STATUS_TO_ORDER: Record<TakeoutStatus, OrderStatus> = {
    placed: 'pending',
    confirmed: 'confirmed',
    preparing: 'preparing',
    ready_for_pickup: 'ready',
    picked_up: 'delivered',
    cancelled: 'cancelled',
}

// SELECT used to read takeout orders (orders + their items) for the adapter.
export const TAKEOUT_ORDER_SELECT = `
    id, restaurant_id, loyalty_member_id, customer_name, customer_phone, customer_email,
    pickup_time, status, subtotal_amount, tax_amount, service_charge_amount, total_amount, payment_status,
    stripe_payment_intent_id, promo_code_id, discount_amount, customer_note,
    placed_at, confirmed_at, ready_at, delivered_at,
    order_type, delivery_address, delivery_verification_code,
    order_items ( menu_item_id, quantity, unit_price, special_request, menu_items ( name ) )
`

interface OrderItemRow {
    menu_item_id: string
    quantity: number
    unit_price: number | string | null
    special_request: string | null
    menu_items: { name: string } | { name: string }[] | null
}

export interface TakeoutOrderRow {
    id: string
    restaurant_id: string
    loyalty_member_id: string | null
    customer_name: string | null
    customer_phone: string | null
    customer_email: string | null
    pickup_time: string | null
    status: OrderStatus
    subtotal_amount: number | string | null
    tax_amount: number | string | null
    service_charge_amount?: number | string | null
    total_amount: number | string | null
    payment_status: PaymentStatus
    stripe_payment_intent_id: string | null
    promo_code_id: string | null
    discount_amount: number | string | null
    customer_note: string | null
    placed_at: string
    confirmed_at: string | null
    ready_at: string | null
    delivered_at: string | null
    order_type?: 'dine_in' | 'takeout' | 'delivery'
    delivery_address?: string | null
    delivery_verification_code?: string | null
    order_items?: OrderItemRow[] | null
}

function itemName(mi: OrderItemRow['menu_items']): string {
    if (!mi) return 'Item'
    return Array.isArray(mi) ? (mi[0]?.name ?? 'Item') : mi.name
}

/** Map a unified orders row (with order_items) into the legacy TakeoutOrder shape. */
export function mapOrderRowToTakeout(row: TakeoutOrderRow): TakeoutOrder {
    const items: CartItem[] = (row.order_items || []).map(oi => ({
        menuItemId: oi.menu_item_id,
        name: itemName(oi.menu_items),
        price: Number(oi.unit_price ?? 0),
        quantity: oi.quantity,
        specialRequest: oi.special_request ?? undefined,
    }))

    return {
        id: row.id,
        restaurant_id: row.restaurant_id,
        loyalty_member_id: row.loyalty_member_id ?? null,
        customer_name: row.customer_name ?? '',
        customer_phone: row.customer_phone ?? '',
        customer_email: row.customer_email ?? null,
        pickup_time: row.pickup_time ?? row.placed_at,
        estimated_prep_minutes: null,
        status: ORDER_STATUS_TO_TAKEOUT[row.status] ?? 'placed',
        items,
        subtotal_amount: Number(row.subtotal_amount ?? 0),
        tax_amount: Number(row.tax_amount ?? 0),
        service_charge_amount: Number(row.service_charge_amount ?? 0),
        total_amount: Number(row.total_amount ?? 0),
        payment_status: row.payment_status,
        stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
        promo_code_id: row.promo_code_id ?? null,
        discount_amount: Number(row.discount_amount ?? 0),
        customer_note: row.customer_note ?? null,
        kitchen_note: null,
        placed_at: row.placed_at,
        confirmed_at: row.confirmed_at ?? null,
        ready_at: row.ready_at ?? null,
        picked_up_at: row.delivered_at ?? null,
        cancelled_at: null,
        order_type: row.order_type ?? 'takeout',
        delivery_address: row.delivery_address ?? null,
        delivery_verification_code: row.delivery_verification_code ?? null,
    }
}
