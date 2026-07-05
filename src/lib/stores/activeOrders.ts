// lib/stores/activeOrders.ts
// Tracks the customer's in-progress orders (dine-in + takeout) in localStorage so
// a "View your order" pill can take them back to tracking after they navigate away.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ActiveOrder {
    id: string
    type: 'dine_in' | 'takeout'
    slug: string        // table qr_token (dine-in) or restaurant slug (takeout)
    placedAt: number
    sessionToken?: string
}

interface ActiveOrdersState {
    orders: ActiveOrder[]
    addActiveOrder: (o: Omit<ActiveOrder, 'placedAt'>) => void
    removeActiveOrder: (id: string) => void
}

export const useActiveOrders = create<ActiveOrdersState>()(
    persist(
        (set) => ({
            orders: [],
            addActiveOrder: (o) =>
                set((state) => ({
                    orders: [
                        { ...o, placedAt: Date.now() },
                        ...state.orders.filter((x) => x.id !== o.id),
                    ].slice(0, 5),
                })),
            removeActiveOrder: (id) =>
                set((state) => ({ orders: state.orders.filter((x) => x.id !== id) })),
        }),
        { name: 'srms-active-orders' },
    ),
)

/** Tracking URL for an active order. */
export function trackHref(o: ActiveOrder): string {
    return o.type === 'takeout'
        ? `/takeout/${o.slug}/order/${o.id}`
        : `/t/${o.slug}/order/${o.id}`
}
