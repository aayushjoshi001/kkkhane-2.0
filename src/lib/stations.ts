// lib/stations.ts
// A station is the physical place a dish is made: the kitchen or the bar.
// One order can straddle both — a burger and a beer arrive on one ticket from
// the customer's side, but the kitchen must never see the beer and the bar must
// never see the burger.
//
// Routing is resolved once, when the order line is written (see the
// stamp_order_item_station trigger), and frozen on order_items.station. Nothing
// downstream re-resolves it from the menu, so re-tagging a category tomorrow
// leaves yesterday's tickets alone.

import { ChefHat, Martini, type LucideIcon } from 'lucide-react'

export type StationKind = 'kitchen' | 'bar'

export const STATIONS: readonly StationKind[] = ['kitchen', 'bar'] as const

interface StationMeta {
    /** Header badge + empty-state wording. */
    label: string
    /** Printed across the top of the physical ticket. */
    ticketTitle: string
    /** Short form used on the ticket type badge and in toasts. */
    ticketAbbr: string
    icon: LucideIcon
    /** Which per-device printer slot this station prints to. */
    printerRole: 'kot' | 'bot'
    /** Landing route for the staff who work it. */
    route: string
    accent: string
    soft: string
}

export const STATION_META: Record<StationKind, StationMeta> = {
    kitchen: {
        label: 'Kitchen',
        ticketTitle: 'KITCHEN ORDER TICKET',
        ticketAbbr: 'KOT',
        icon: ChefHat,
        printerRole: 'kot',
        route: '/kitchen',
        accent: '#FB6303',
        soft: '#FFEAD9',
    },
    bar: {
        label: 'Bar',
        ticketTitle: 'BAR ORDER TICKET',
        ticketAbbr: 'BOT',
        icon: Martini,
        printerRole: 'bot',
        route: '/bar',
        accent: '#7C3AED',
        soft: '#EDE9FE',
    },
}

/**
 * Resolve where a menu item is made. Mirrors the SQL in
 * stamp_order_item_station() — used by the admin menu screen to show an item's
 * effective station before any order exists.
 */
export function resolveStation(
    itemStation: StationKind | null | undefined,
    categoryStation: StationKind | null | undefined
): StationKind {
    return itemStation ?? categoryStation ?? 'kitchen'
}

/** Keep only the lines this station makes. */
export function itemsForStation<T extends { station?: StationKind | null }>(
    items: T[] | null | undefined,
    station: StationKind
): T[] {
    return (items || []).filter(i => (i.station ?? 'kitchen') === station)
}
