import type { OrderStatus, OrderItemStatus } from '@/types/database'

/**
 * Roll a set of order_item statuses up to a single order status.
 *
 * Only ever advances the order through the cooking/serving lifecycle. Returns
 * null when every item is still pending, so callers leave orders.status
 * untouched (a manual 'confirmed' must not be clobbered back to 'pending').
 *
 * Shared by the kitchen + waiter server actions (the source of truth) and the
 * client feeds (optimistic re-bucketing before realtime confirms), so the
 * aggregation rule lives in exactly one place.
 */
export function rollUpOrderStatus(statuses: OrderItemStatus[]): OrderStatus | null {
    const active = statuses.filter(s => s !== 'cancelled')
    if (active.length === 0) return 'cancelled'
    if (active.every(s => s === 'served')) return 'delivered'
    if (active.every(s => s === 'ready' || s === 'served')) return 'ready'
    if (active.some(s => s === 'preparing' || s === 'ready' || s === 'served')) return 'preparing'
    return null
}
