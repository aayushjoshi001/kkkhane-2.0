// Builds the ESC/POS byte stream for a station order ticket — a KOT for the
// kitchen, a BOT for the bar. Same layout, different heading and item set: each
// station only ever sees the lines it makes. No prices; a station ticket is a
// prep instruction, not a bill.

import { EscPosBuilder } from '../escpos'
import type { KitchenOrder, KitchenOrderItem } from '@/components/kitchen/OrderQueue'
import { STATION_META, itemsForStation, type StationKind } from '@/lib/stations'
import { getKOTSourceLabel, getItemKOTDisplay } from '@/lib/utils'

export function buildStationTicket(
    order: KitchenOrder,
    station: StationKind,
    restaurantName = 'KKHANE'
): Uint8Array {
    const b = new EscPosBuilder().init()
    const meta = STATION_META[station]

    b.align('center').bold(true).line(restaurantName).bold(false)
    b.line(meta.ticketTitle)
    b.divider()

    const sourceLabel = getKOTSourceLabel(order).toUpperCase()

    b.size({ doubleHeight: true, doubleWidth: true }).bold(true)
    b.line(sourceLabel)
    b.size({}).bold(false)

    b.align('left')
    b.line(`Order: #${order.id.slice(0, 8).toUpperCase()}`)
    b.line(`Time: ${new Date(order.placed_at).toLocaleTimeString()}`)
    b.divider()

    const items = itemsForStation<KitchenOrderItem>(order.order_items, station)
    for (const item of items) {
        const { name, note } = getItemKOTDisplay(item, order.order_type)
        b.bold(true)
        b.line(`${item.quantity} x ${name}`)
        b.bold(false)
        if (note) b.line(`   Note: ${note}`)
        for (const mod of item.order_item_modifiers || []) {
            if (mod.modifier_name) b.line(`   + ${mod.modifier_name}`)
        }
    }

    if (order.customer_note) {
        b.divider()
        b.line(`Order note: ${order.customer_note}`)
    }

    b.divider()
    b.line(station === 'bar' ? 'Bartender: __________' : 'Chef: ______________')

    return b.cut().build()
}
