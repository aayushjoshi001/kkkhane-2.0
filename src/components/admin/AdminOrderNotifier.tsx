'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { playNewOrder, setCustomNotificationSound } from '@/lib/audio'
import { toast } from 'react-hot-toast'
import { useCurrency, useFeatures } from '@/lib/contexts/FeatureContext'

export default function AdminOrderNotifier({ restaurantId }: { restaurantId: string }) {
    const supabaseRef = useRef(createClient())
    const money = useCurrency()

    // Apply the restaurant's configured notification sound so the admin/manager
    // dashboard rings with the same sound as the kitchen/waiter/cashier screens.
    const soundUrl = useFeatures().notificationSoundUrl ?? null
    useEffect(() => {
        setCustomNotificationSound(soundUrl)
    }, [soundUrl])

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        if (payload.eventType !== 'INSERT') return
        const supabase = supabaseRef.current
        playNewOrder().catch(() => {})
        const { data } = await supabase
            .from('orders')
            .select('total_amount, sessions ( tables ( label ) )')
            .eq('id', payload.new.id)
            .single()
        const tableLabel = (data?.sessions as unknown as { tables?: { label?: string } } | null)?.tables?.label
        const amount = data?.total_amount ?? payload.new.total_amount
        toast.custom((t) => (
            <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-surface shadow-2xl rounded-xl px-4 py-3 flex items-start gap-3 border border-brand-200`}>
                <span className="text-xl mt-0.5">🛎️</span>
                <div className="min-w-0">
                    <p className="font-bold text-sm text-orange-700">New Order!</p>
                    <p className="text-xs text-ink-subtle mt-0.5 truncate">
                        {tableLabel ? `Table ${tableLabel}` : 'Takeout'} · {money(amount)}
                    </p>
                </div>
            </div>
        ), { duration: 6000, position: 'top-right' })
    })

    return null
}
