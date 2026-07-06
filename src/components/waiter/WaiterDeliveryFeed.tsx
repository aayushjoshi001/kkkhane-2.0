'use client'

import { useRef, useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { getReadyDeliveries, claimDelivery, releaseDelivery, markDeliveryDelivered, type DeliveryOrderRow } from '@/app/api/takeout/actions'
import { playOrderReady } from '@/lib/audio'
import { toast } from 'react-hot-toast'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import FeedSection from '@/components/ui/FeedSection'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Bike, MapPin, Phone, Footprints, X, Check } from 'lucide-react'

function nameOf(mi: { name: string } | { name: string }[] | null): string {
    if (!mi) return 'Item'
    return Array.isArray(mi) ? (mi[0]?.name ?? 'Item') : mi.name
}

export default function WaiterDeliveryFeed({ initialOrders, restaurantId, userId, staffNames = {} }: {
    initialOrders: DeliveryOrderRow[]
    restaurantId: string
    userId: string
    staffNames?: Record<string, string>
}) {
    const [orders, setOrders] = useState<DeliveryOrderRow[]>(initialOrders)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [codeFor, setCodeFor] = useState<string | null>(null)
    const [code, setCode] = useState('')
    const money = useCurrency()
    const prevLen = useRef(initialOrders.length)

    useRestaurantTable(restaurantId, 'orders', (payload) => {
        if ((payload.new as { order_type?: string } | null)?.order_type !== 'delivery') return
        getReadyDeliveries(restaurantId)
            .then((list) => {
                if (list.length > prevLen.current) playOrderReady().catch(() => {})
                prevLen.current = list.length
                setOrders(list)
            })
            .catch(() => {})
    })

    const handleClaim = async (orderId: string) => {
        setBusyId(orderId)
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, delivery_staff_id: userId } : o))
        const res = await claimDelivery(orderId)
        if (res?.error) {
            setOrders(prev => prev.map(o => o.id === orderId ? { ...o, delivery_staff_id: null } : o))
            toast.error(res.conflict ? 'Another delivery person already took this' : res.error)
        }
        setBusyId(null)
    }

    const handleRelease = async (orderId: string) => {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, delivery_staff_id: null } : o))
        if (codeFor === orderId) { setCodeFor(null); setCode('') }
        await releaseDelivery(orderId)
    }

    const handleDeliver = async (orderId: string) => {
        if (code.trim().length === 0) return
        setBusyId(orderId)
        const res = await markDeliveryDelivered(orderId, code.trim())
        if (res?.error) {
            toast.error(res.error)
            if (!res.wrongCode) {
                // Hard conflict — refresh the list.
                getReadyDeliveries(restaurantId).then(setOrders).catch(() => {})
            }
        } else {
            toast.success('Delivered ✓')
            setOrders(prev => prev.filter(o => o.id !== orderId))
            setCodeFor(null)
            setCode('')
        }
        setBusyId(null)
    }

    if (orders.length === 0) {
        return (
            <FeedSection icon={Bike} title="Deliveries">
                <Card padding={24}>
                    <EmptyState icon={Bike} title="No deliveries ready" description="Ready delivery orders will appear here to take out." />
                </Card>
            </FeedSection>
        )
    }

    return (
        <FeedSection icon={Bike} title="Deliveries" count={orders.length} tone="info">
            <div className="grid gap-3">
                {orders.map(order => {
                    const mine = order.delivery_staff_id === userId
                    const byOther = !!order.delivery_staff_id && !mine
                    const ownerName = order.delivery_staff_id ? staffNames[order.delivery_staff_id] : undefined
                    return (
                        <Card key={order.id} padding={false} className={byOther ? 'opacity-60' : undefined}>
                            <div className="p-4 md:p-5">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="font-bold text-ink">{order.customer_name || 'Customer'}</p>
                                        {order.customer_phone && (
                                            <a href={`tel:${order.customer_phone}`} className="text-small text-info-fg flex items-center gap-1.5 mt-0.5">
                                                <Phone size={12} /> {order.customer_phone}
                                            </a>
                                        )}
                                    </div>
                                    <span className="text-display text-ink">{money(Number(order.total_amount ?? 0))}</span>
                                </div>

                                {order.delivery_address && (
                                    <div className="flex items-start gap-2 text-body text-ink mb-3 bg-surface-muted rounded-[var(--r-md)] p-3">
                                        <MapPin size={15} className="text-info-fg shrink-0 mt-0.5" />
                                        <span>{order.delivery_address}</span>
                                    </div>
                                )}

                                <ul className="text-small text-ink-subtle mb-4 space-y-0.5">
                                    {(order.order_items || []).map(it => (
                                        <li key={it.id}>{it.quantity}× {nameOf(it.menu_items)}</li>
                                    ))}
                                </ul>

                                {byOther && (
                                    <p className="text-small text-ink-subtle flex items-center gap-1.5">
                                        <Footprints size={14} /> {ownerName || 'A colleague'} is delivering this
                                    </p>
                                )}

                                {!order.delivery_staff_id && (
                                    <Button variant="primary" size="lg" block icon={Footprints} loading={busyId === order.id} onClick={() => handleClaim(order.id)}>
                                        I&apos;m going
                                    </Button>
                                )}

                                {mine && (
                                    <div className="space-y-2">
                                        {codeFor === order.id ? (
                                            <div className="space-y-2">
                                                <label className="text-small text-ink-subtle">Enter the customer&apos;s delivery code</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        autoFocus
                                                        inputMode="numeric"
                                                        value={code}
                                                        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                        placeholder="••••"
                                                        className="flex-1 text-center text-2xl font-mono tracking-[0.4em] border border-hairline-strong rounded-lg py-2 focus:outline-none focus:ring-2 focus:ring-info"
                                                    />
                                                    <Button variant="primary" icon={Check} loading={busyId === order.id} disabled={!code.trim()} onClick={() => handleDeliver(order.id)}>
                                                        Delivered
                                                    </Button>
                                                </div>
                                                <button onClick={() => { setCodeFor(null); setCode('') }} className="text-caption text-ink-muted hover:text-ink mx-auto flex items-center gap-1">
                                                    <X size={12} /> Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <Badge tone="info" dot className="w-full justify-center py-2">Out for delivery</Badge>
                                                <Button variant="primary" size="lg" block icon={Check} onClick={() => { setCodeFor(order.id); setCode('') }}>
                                                    Mark Delivered
                                                </Button>
                                                <button onClick={() => handleRelease(order.id)} className="text-caption text-ink-muted hover:text-ink flex items-center gap-1 mx-auto">
                                                    <X size={12} /> Release
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </Card>
                    )
                })}
            </div>
        </FeedSection>
    )
}
