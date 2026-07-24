'use client'

import { useRestaurantCatchUp } from '@/lib/realtime/useRestaurantCatchUp'

/**
 * Mount once per live panel (kitchen, bar, waiter, cashier, admin) to resync the
 * whole page from the server whenever the realtime channel reconnects.
 *
 * Renders nothing - it exists so a server component can opt its panel into
 * catch-up without becoming a client component itself.
 */
export default function RealtimeCatchUp({ restaurantId }: { restaurantId: string | undefined | null }) {
    useRestaurantCatchUp(restaurantId)
    return null
}
