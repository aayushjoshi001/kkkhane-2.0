'use client'

import { useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { Zap, Clock, CheckCircle2, Package } from 'lucide-react'

interface Props {
    queuedOrders: number
    preparingOrders: number
    readyOrders: number
    completedToday: number
    restaurantId: string
}

export default function KitchenStats({
    queuedOrders: initQueued,
    preparingOrders: initPreparing,
    readyOrders: initReady,
    completedToday: initCompleted,
    restaurantId,
}: Props) {
    const [queued, setQueued] = useState(initQueued)
    const [preparing, setPreparing] = useState(initPreparing)
    const [ready, setReady] = useState(initReady)
    const [completed, setCompleted] = useState(initCompleted)

    // Live counters via the shared per-restaurant channel.
    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new.status as string
            if (s === 'pending' || s === 'confirmed') setQueued(n => n + 1)
            else if (s === 'preparing') setPreparing(n => n + 1)
            else if (s === 'ready') setReady(n => n + 1)
        } else if (payload.eventType === 'UPDATE') {
            const prev = payload.old.status as string
            const next = payload.new.status as string
            if ((prev === 'pending' || prev === 'confirmed') && next === 'preparing') {
                setQueued(n => Math.max(0, n - 1)); setPreparing(n => n + 1)
            } else if (prev === 'preparing' && next === 'ready') {
                setPreparing(n => Math.max(0, n - 1)); setReady(n => n + 1)
            } else if ((prev === 'pending' || prev === 'confirmed') && next === 'ready') {
                setQueued(n => Math.max(0, n - 1)); setReady(n => n + 1)
            } else if (next === 'delivered') {
                setCompleted(n => n + 1)
                if (prev === 'preparing') setPreparing(n => Math.max(0, n - 1))
                else if (prev === 'ready') setReady(n => Math.max(0, n - 1))
            } else if (next === 'cancelled') {
                if (prev === 'pending' || prev === 'confirmed') setQueued(n => Math.max(0, n - 1))
                else if (prev === 'preparing') setPreparing(n => Math.max(0, n - 1))
                else if (prev === 'ready') setReady(n => Math.max(0, n - 1))
            }
        }
    })

    // Status-mapped accents (never brand orange): queue=warning, preparing=info,
    // ready=success, done=neutral. Tinted chip only; number stays neutral.
    const stats = [
        { icon: Zap,          label: 'In Queue',   value: queued,    accent: 'var(--warning)' },
        { icon: Clock,        label: 'Preparing',  value: preparing, accent: 'var(--info)' },
        { icon: CheckCircle2, label: 'Ready',      value: ready,     accent: 'var(--success)', pulse: ready > 0 },
        { icon: Package,      label: 'Done Today', value: completed, accent: null },
    ]

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {stats.map((s) => {
                const Icon = s.icon
                const chip = s.accent
                    ? {
                          background: `color-mix(in srgb, ${s.accent} 16%, transparent)`,
                          color: `color-mix(in srgb, ${s.accent} 75%, white)`,
                      }
                    : undefined
                return (
                    <div key={s.label}
                         className="rounded-card border border-dark-border bg-dark-surface p-3 md:p-4 flex items-center gap-3">
                        <span className={`grid size-9 place-items-center rounded-[var(--r-md)] shrink-0 ${chip ? '' : 'bg-surface/5 text-dark-muted'} ${s.pulse ? 'animate-pulse' : ''}`}
                              style={chip}>
                            <Icon size={18} />
                        </span>
                        <div>
                            <p className="text-2xl font-extrabold tabular text-dark-ink leading-none">{s.value}</p>
                            <p className="text-caption text-dark-muted mt-0.5">{s.label}</p>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
