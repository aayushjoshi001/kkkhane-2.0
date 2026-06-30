'use client'

import { useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { Users, Package, Bell, ChefHat } from 'lucide-react'
import { StatCard } from '@/components/ui'
import type { StatCardProps } from '@/components/ui'

interface Props {
    occupiedTables: number
    totalTables: number
    readyOrders: number
    kitchenOrders: number
    pendingRequests: number
    restaurantId: string
    onStatClick?: (key: string) => void
}

export default function FloorStats({
    occupiedTables: initOccupied,
    totalTables,
    readyOrders: initReady,
    kitchenOrders: initKitchen,
    pendingRequests: initPending,
    restaurantId,
    onStatClick,
}: Props) {
    const [occupied, setOccupied] = useState(initOccupied)
    const [ready, setReady] = useState(initReady)
    const [kitchen, setKitchen] = useState(initKitchen)
    const [pending, setPending] = useState(initPending)

    useRestaurantTable(restaurantId, 'sessions', (payload) => {
        if (payload.eventType === 'INSERT') {
            setOccupied(n => n + 1)
        } else if (payload.eventType === 'UPDATE') {
            if (payload.new.status === 'closed' || payload.new.status === 'expired') {
                setOccupied(n => Math.max(0, n - 1))
            }
        }
    })

    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new.status as string
            if (s === 'ready') setReady(n => n + 1)
            else if (['pending', 'confirmed', 'preparing'].includes(s)) setKitchen(n => n + 1)
        } else if (payload.eventType === 'UPDATE') {
            const prev = payload.old.status as string
            const next = payload.new.status as string
            if (prev !== 'ready' && next === 'ready') {
                setReady(n => n + 1)
                setKitchen(n => Math.max(0, n - 1))
            } else if (prev === 'ready' && next !== 'ready') {
                setReady(n => Math.max(0, n - 1))
            }
            if (['delivered', 'cancelled'].includes(next) && ['pending', 'confirmed', 'preparing'].includes(prev)) {
                setKitchen(n => Math.max(0, n - 1))
            }
        }
    })

    useRestaurantTable(restaurantId, 'service_requests', (payload) => {
        if (payload.eventType === 'INSERT') {
            setPending(n => n + 1)
        } else if (payload.eventType === 'UPDATE') {
            if (payload.old.status === 'pending' && payload.new.status !== 'pending') setPending(n => Math.max(0, n - 1))
        }
    })

    const stats: (StatCardProps & { key: string })[] = [
        { key: 'tables',   icon: Users,   tone: 'info',    label: 'Tables',   value: occupied, hint: `of ${totalTables} occupied` },
        { key: 'ready',    icon: Package, tone: ready > 0 ? 'success' : 'neutral', label: 'Ready', value: ready, hint: 'to deliver' },
        { key: 'kitchen',  icon: ChefHat, tone: 'neutral', label: 'Kitchen',  value: kitchen, hint: 'in prep' },
        { key: 'requests', icon: Bell,    tone: pending > 0 ? 'warning' : 'neutral', label: 'Requests', value: pending, hint: 'pending' },
    ]

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map(({ key, ...s }) => {
                const content = <StatCard size="sm" {...s} />
                if (onStatClick) {
                    return (
                        <button
                            key={key}
                            onClick={() => onStatClick(key)}
                            className="text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-[var(--radius-card)] active:scale-[0.98] transition-transform"
                        >
                            {content}
                        </button>
                    )
                }
                return <div key={key}>{content}</div>
            })}
        </div>
    )
}
