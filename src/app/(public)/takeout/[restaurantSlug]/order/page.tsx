'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useActiveOrders, trackHref } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { Loader2 } from 'lucide-react'

export default function TakeoutOrderRedirectPage() {
    const router = useRouter()
    const params = useParams()
    const restaurantSlug = params.restaurantSlug as string
    const orders = useHydratedStore(useActiveOrders, (s) => s.orders)

    useEffect(() => {
        if (!restaurantSlug) return

        // Find most recent active takeout order for this restaurant
        const activeOrder = (orders || []).find(
            (o) => o.type === 'takeout' && o.slug === restaurantSlug
        )

        if (activeOrder) {
            router.replace(trackHref(activeOrder))
        } else {
            // No active order found, redirect back to menu
            router.replace(`/takeout/${restaurantSlug}`)
        }
    }, [orders, restaurantSlug, router])

    return (
        <div className="min-h-screen bg-surface-muted flex flex-col items-center justify-center p-4">
            <div className="text-center">
                <Loader2 className="w-10 h-10 text-ink-subtle animate-spin mx-auto mb-4" />
                <h2 className="text-lg font-semibold text-ink mb-1">Locating your order...</h2>
                <p className="text-sm text-ink-subtle">Redirecting you shortly.</p>
            </div>
        </div>
    )
}
