// Builds the ESC/POS byte stream for a Kitchen Order Ticket (KOT) — printed
// automatically the instant a new order lands in the kitchen queue. No
// prices: a KOT is a cooking instruction, not a bill.

import { EscPosBuilder } from '../escpos'
import type { KitchenOrder } from '@/components/kitchen/OrderQueue'

export function buildKotTicket(order: KitchenOrder, restaurantName = 'KKHANE'): Uint8Array {
    const b = new EscPosBuilder().init()

    b.align('center').bold(true).line(restaurantName).bold(false)
    b.line('KITCHEN ORDER TICKET')
    b.divider()

    const table = order.sessions?.tables?.label
    const isTakeout = order.order_type === 'takeout'
    const isDelivery = order.order_type === 'delivery'
    const sourceLabel = isTakeout ? 'TAKEAWAY' : isDelivery ? 'DELIVERY' : table ? `TABLE ${table}` : 'ORDER'

    b.size({ doubleHeight: true, doubleWidth: true }).bold(true)
    b.line(sourceLabel)
    b.size({}).bold(false)

    b.align('left')
    b.line(`Order: #${order.id.slice(0, 8).toUpperCase()}`)
    b.line(`Time: ${new Date(order.placed_at).toLocaleTimeString()}`)
    b.divider()

    const items = order.order_items || []
    for (const item of items) {
        b.bold(true)
        b.line(`${item.quantity} x ${item.menu_items?.name || 'Item'}`)
        b.bold(false)
        if (item.special_request) b.line(`   Note: ${item.special_request}`)
        for (const mod of item.order_item_modifiers || []) {
            if (mod.modifier_name) b.line(`   + ${mod.modifier_name}`)
        }
    }

    if (order.customer_note) {
        b.divider()
        b.line(`Order note: ${order.customer_note}`)
    }

    b.divider()
    b.line('Chef: ______________')

    return b.cut().build()
}
