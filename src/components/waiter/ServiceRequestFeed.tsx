'use client'

import { useRef, useState } from 'react'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { createClient } from '@/lib/supabase/client'
import OrderCard from '@/components/ui/OrderCard'
import FeedSection from '@/components/ui/FeedSection'
import Button from '@/components/ui/Button'
import { acknowledgeServiceRequest, completeServiceRequest } from '@/app/api/service-requests/actions'
import { Bell, Droplets, Receipt, Sparkles, MessageCircle, LogIn } from 'lucide-react'
import { timeAgo } from '@/lib/utils'
import { playServiceRequest } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import type { ServiceRequest, ServiceRequestType } from '@/types/database'
import { openSessionFromRequest } from '@/app/(staff)/waiter/actions'
import { useServerState } from '@/lib/hooks/useServerState'

const ICON_MAP: Record<ServiceRequestType, typeof Bell> = {
    call_waiter: Bell,
    request_bill: Receipt,
    need_water: Droplets,
    clean_table: Sparkles,
    other: MessageCircle,
    open_session: LogIn,
}

const LABEL_MAP: Record<ServiceRequestType, string> = {
    call_waiter: 'Call Waiter',
    request_bill: 'Request Bill',
    need_water: 'Need Water',
    clean_table: 'Clean Table',
    other: 'Other',
    open_session: 'Ready to Order',
}

export type ServiceRequestWithTable = ServiceRequest & {
    sessions?: { tables?: { label?: string } }
    direct_table?: { label?: string }
}

const getTableLabel = (req: ServiceRequestWithTable) =>
    req.sessions?.tables?.label ?? req.direct_table?.label ?? '?'

export default function ServiceRequestFeed({
    initialRequests,
    restaurantId,
    userId,
    staffNames = {},
}: {
    initialRequests: ServiceRequestWithTable[]
    restaurantId: string
    userId: string
    staffNames?: Record<string, string>
}) {
    const [requests, setRequests] = useServerState<ServiceRequestWithTable[]>(initialRequests)
    const [openingSession, setOpeningSession] = useState<string | null>(null)
    const supabaseRef = useRef(createClient())

    useRestaurantTable(restaurantId, 'service_requests', async (payload) => {
        const supabase = supabaseRef.current
        if (payload.eventType === 'INSERT') {
            const { data } = await supabase
                .from('service_requests')
                .select('*, sessions ( tables ( label ) ), direct_table:tables ( label )')
                .eq('id', payload.new.id)
                .single()
            if (data) {
                const req = data as unknown as ServiceRequestWithTable
                setRequests((prev) => [req, ...prev])
                playServiceRequest().catch(() => {})

                if (req.request_type === 'request_bill') {
                    playVoice('waiter_bill_request')
                } else {
                    playVoice('waiter_service_ring')
                }

                const tableLabel = getTableLabel(req)
                const label = LABEL_MAP[req.request_type as ServiceRequestType] || 'Service Request'
                const isOpenSession = req.request_type === 'open_session'
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-ink text-white shadow-2xl rounded-xl px-4 py-3 flex items-start gap-3 ${isOpenSession ? 'border border-violet-500/40' : 'border border-amber-500/30'}`}>
                        <span className="text-xl mt-0.5">{isOpenSession ? '🪑' : '🔔'}</span>
                        <div>
                            <p className={`font-bold text-sm ${isOpenSession ? 'text-violet-400' : 'text-amber-400'}`}>{label}</p>
                            <p className="text-xs text-ink-subtle mt-0.5">Table {tableLabel}{req.message ? ` — ${req.message}` : ''}</p>
                        </div>
                    </div>
                ), { duration: 7000, position: 'top-right' })
            }
        } else if (payload.eventType === 'UPDATE') {
            setRequests((prev) =>
                prev
                    .map((r) => (r.id === payload.new.id ? { ...r, ...payload.new } : r))
                    .filter((r) => r.status !== 'completed' && r.status !== 'cancelled')
            )
        }
    })

    const handleAcknowledge = async (id: string) => {
        const snapshot = requests
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'acknowledged' as const, acknowledged_by: userId } : r)))
        const res = await acknowledgeServiceRequest(id, userId)
        if (!res.success) {
            setRequests(snapshot)
            toast.error('Someone else already took this request')
        }
    }

    const handleComplete = async (id: string) => {
        const snapshot = requests
        setRequests((prev) => prev.filter((r) => r.id !== id))
        const res = await completeServiceRequest(id, userId)
        if (!res.success) {
            setRequests(snapshot)
            toast.error(res.conflict ? 'Only the waiter who took this can mark it served' : 'Could not complete')
        }
    }

    const handleOpenSession = async (req: ServiceRequestWithTable) => {
        if (!req.table_id) return
        setOpeningSession(req.id)
        const res = await openSessionFromRequest(req.id, req.table_id, restaurantId)
        setOpeningSession(null)
        if (res.error) {
            toast.error(res.error)
        } else {
            setRequests((prev) => prev.filter((r) => r.id !== req.id))
            toast.success(`Session opened for Table ${getTableLabel(req)}`)
        }
    }

    const pending = requests.filter((r) => r.status === 'pending')
    const acknowledged = requests.filter((r) => r.status === 'acknowledged')

    if (pending.length === 0 && acknowledged.length === 0) return null

    const titleFor = (req: ServiceRequestWithTable) => {
        const Icon = ICON_MAP[req.request_type as ServiceRequestType]
        return (
            <span className="flex items-center gap-1.5">
                <Icon size={15} className="text-ink-subtle shrink-0" />
                {LABEL_MAP[req.request_type as ServiceRequestType]}
            </span>
        )
    }

    return (
        <FeedSection
            icon={Bell}
            title="Service Requests"
            count={pending.length || undefined}
            tone="danger"
        >
            {/* Pending — urgent (left danger bar) */}
            {pending.map((req) => {
                const isOpenSession = req.request_type === 'open_session'
                return (
                    <OrderCard
                        key={req.id}
                        urgent
                        tableLabel={getTableLabel(req)}
                        title={titleFor(req)}
                        meta={
                            <>
                                <span>{timeAgo(req.created_at)}</span>
                                {req.message && <span className="text-ink-muted truncate min-w-0">— {req.message}</span>}
                            </>
                        }
                        trailing={
                            isOpenSession ? (
                                <Button size="sm" icon={LogIn} loading={openingSession === req.id} onClick={() => handleOpenSession(req)}>
                                    Open
                                </Button>
                            ) : (
                                <Button variant="primary" size="sm" onClick={() => handleAcknowledge(req.id)}>I'm Going</Button>
                            )
                        }
                    />
                )
            })}

            {/* Acknowledged — in progress */}
            {acknowledged.map((req) => {
                const isOpenSession = req.request_type === 'open_session'
                return (
                    <OrderCard
                        key={req.id}
                        className="opacity-70"
                        tableLabel={getTableLabel(req)}
                        title={titleFor(req)}
                        meta={
                            <>
                                <span>{timeAgo(req.created_at)}</span>
                                {req.acknowledged_by && (
                                    <span className="text-ink-muted">
                                        — {req.acknowledged_by === userId ? 'You are' : `${staffNames[req.acknowledged_by] || 'A colleague'} is`} on it
                                    </span>
                                )}
                                {req.message && <span className="text-ink-muted truncate min-w-0">— {req.message}</span>}
                            </>
                        }
                        trailing={
                            isOpenSession ? (
                                <Button variant="secondary" size="sm" loading={openingSession === req.id} onClick={() => handleOpenSession(req)}>
                                    Open
                                </Button>
                            ) : (req.acknowledged_by && req.acknowledged_by !== userId) ? (
                                // Claimed by a colleague — view only.
                                null
                            ) : (
                                <Button variant="secondary" size="sm" onClick={() => handleComplete(req.id)}>Done</Button>
                            )
                        }
                    />
                )
            })}
        </FeedSection>
    )
}
