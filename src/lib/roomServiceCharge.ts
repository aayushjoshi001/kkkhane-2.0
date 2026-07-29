// The room service charge as the cashier screens see it.
//
// The authoritative figure is computed server-side in computeFolioForStays
// (src/lib/folio.ts) and that is what /api/bookings/checkout actually bills.
// This is the client's preview of the same rule, so the number the cashier
// reads on screen matches the one the guest is charged. Both sides gate on the
// same two settings — a tenant with the feature off, or a room not on the
// allowlist, is charged nothing — which is why neither screen may go on
// hardcoding a flat 10%.

/** 10% on kitchen items, matching folio.ts. */
export const ROOM_SERVICE_CHARGE_RATE = 0.10

const round2 = (n: number) => Math.round(n * 100) / 100

export interface RoomServiceChargeFeatures {
    roomServiceChargeEnabled?: boolean
    roomServiceChargeRooms?: string[]
}

/** An order item as the cashier screens carry it — station lives either on the
 *  row itself or on the joined menu item, depending on which query loaded it.
 *  `menu_items` is left as `unknown` because each screen selects a different
 *  shape for it, and only the station is read here. */
export interface RoomServiceChargeItem {
    status?: string | null
    quantity?: number | null
    unit_price?: number | string | null
    station?: string | null
    menu_items?: unknown
    is_room_order?: boolean | null
}

const isKitchen = (it: RoomServiceChargeItem): boolean => {
    if (it.station === 'kitchen') return true
    const joined = it.menu_items as { station?: string | null } | null | undefined
    return joined?.station === 'kitchen'
}

/** Whether this room is charged a service charge at all. */
export function roomServiceChargeApplies(
    features: RoomServiceChargeFeatures | null | undefined,
    roomId: string | null | undefined,
): boolean {
    if (!features?.roomServiceChargeEnabled || !roomId) return false
    const rooms = Array.isArray(features.roomServiceChargeRooms) ? features.roomServiceChargeRooms : []
    return rooms.includes(roomId)
}

/**
 * What the service charge works out to before anyone edits it: the rate applied
 * to the room's own kitchen items. Returns 0 when the room isn't charged one,
 * so callers can render the line off a falsy total without repeating the gate.
 */
export function autoRoomServiceCharge(
    items: RoomServiceChargeItem[],
    features: RoomServiceChargeFeatures | null | undefined,
    roomId: string | null | undefined,
): number {
    if (!roomServiceChargeApplies(features, roomId)) return 0
    const foodSubtotal = items
        .filter(it => it.is_room_order && it.status !== 'cancelled' && isKitchen(it))
        .reduce((sum, it) => sum + (Number(it.unit_price ?? 0) * (Number(it.quantity) || 0)), 0)
    return round2(foodSubtotal * ROOM_SERVICE_CHARGE_RATE)
}

/**
 * Reconcile the auto figure with whatever the cashier typed. `delta` is the
 * only part that moves the bill — the auto charge is already inside the order
 * totals both the folio and the cashier screens add up.
 */
export function resolveRoomServiceCharge(auto: number, override: string): {
    auto: number
    charged: number
    isOverridden: boolean
    delta: number
} {
    const isOverridden = override.trim() !== ''
    const charged = isOverridden ? round2(Math.max(0, parseFloat(override) || 0)) : auto
    return { auto, charged, isOverridden, delta: round2(charged - auto) }
}
