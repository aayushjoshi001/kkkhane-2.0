'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { playServiceRequest } from '@/lib/audio'
import { playVoice } from '@/lib/voice'
import { toast } from 'react-hot-toast'
import { timeAgo } from '@/lib/utils'
import { Bell, Droplets, Receipt, Sparkles, MessageCircle, LogIn, Flame, Utensils, HandHelping, Banknote } from 'lucide-react'
import { OrderCard, Button } from '@/components/ui'
import { acknowledgeServiceRequest, completeServiceRequest } from '@/app/api/service-requests/actions'
import { openSessionFromRequest } from '@/app/(staff)/waiter/actions'
import type { ServiceRequest, ServiceRequestType, ServiceRequestStatus } from '@/types/database'
import CashPaymentFeed, { type UnpaidOrder } from './CashPaymentFeed'
import PaymentVerificationFeed, { type PaymentClaim } from './PaymentVerificationFeed'

export type ServiceRequestWithTable = ServiceRequest & {
    sessions?: { tables?: { label?: string } }
    direct_table?: { label?: string }
}

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

const getTableLabel = (req: ServiceRequestWithTable) =>
    req.sessions?.tables?.label ?? req.direct_table?.label ?? '?'

interface Props {
    initialRequests: ServiceRequestWithTable[]
    initialUnpaidOrders: UnpaidOrder[]
    initialClaims: PaymentClaim[]
    restaurantId: string
    userId: string
    staffNames?: Record<string, string>
    features: any
}

type TabType = 'food' | 'service' | 'billing'

export default function WaiterCustomerTabs({
    initialRequests,
    initialUnpaidOrders,
    initialClaims,
    restaurantId,
    userId,
    staffNames = {},
    features
}: Props) {
    const [requests, setRequests] = useState<ServiceRequestWithTable[]>(initialRequests)
    const [unpaidCount, setUnpaidCount] = useState(initialUnpaidOrders?.length || 0)
    const [claimsCount, setClaimsCount] = useState(
        (initialClaims || []).filter(c => !c.staff_verified && !c.staff_rejected).length
    )
    const [activeTab, setActiveTab] = useState<TabType>('food')
    const [openingSession, setOpeningSession] = useState<string | null>(null)
    const supabaseRef = useRef(createClient())

    // Supabase realtime channel for live service requests sync
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

                const tblLabel = getTableLabel(req)
                const label = LABEL_MAP[req.request_type as ServiceRequestType] || 'Service Request'
                const isOpenSession = req.request_type === 'open_session'
                toast.custom((t) => (
                    <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-xs w-full bg-gray-900 text-white shadow-2xl rounded-xl px-4 py-3 flex items-start gap-3 ${isOpenSession ? 'border border-violet-500/40' : 'border border-amber-500/30'}`}>
                        <span className="text-xl mt-0.5">{isOpenSession ? '🪑' : '🔔'}</span>
                        <div>
                            <p className={`font-bold text-sm ${isOpenSession ? 'text-violet-400' : 'text-amber-400'}`}>{label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">Table {tblLabel}{req.message ? ` — ${req.message}` : ''}</p>
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

    // Classify requests into Food, Service, and Billing categories
    const foodRequests = useMemo(() => {
        return requests.filter(r => r.request_type === 'need_water' || r.request_type === 'other')
    }, [requests])

    const serviceRequests = useMemo(() => {
        return requests.filter(r => r.request_type === 'call_waiter' || r.request_type === 'clean_table')
    }, [requests])

    const billRequests = useMemo(() => {
        return requests.filter(r => r.request_type === 'request_bill')
    }, [requests])

    // Tab counts (only pending requests are badgered, matching core behavior)
    const foodCount = foodRequests.filter(r => r.status === 'pending').length
    const serviceCount = serviceRequests.filter(r => r.status === 'pending').length
    const billingCount = billRequests.filter(r => r.status === 'pending').length + unpaidCount + claimsCount

    const titleFor = (req: ServiceRequestWithTable) => {
        const Icon = ICON_MAP[req.request_type as ServiceRequestType]
        return (
            <span className="flex items-center gap-1.5">
                <Icon size={15} className="text-ink-subtle shrink-0" />
                {LABEL_MAP[req.request_type as ServiceRequestType]}
            </span>
        )
    }

    const renderRequestList = (list: ServiceRequestWithTable[]) => {
        const pending = list.filter((r) => r.status === 'pending')
        const acknowledged = list.filter((r) => r.status === 'acknowledged')

        if (pending.length === 0 && acknowledged.length === 0) {
            return (
                <div className="text-center py-10 bg-white rounded-3xl border border-hairline shadow-sm">
                    <p className="text-sm font-semibold text-ink-muted">No pending requests</p>
                </div>
            )
        }

        return (
            <div className="space-y-3">
                {/* Pending */}
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
                                    {req.message && <span className="text-ink-muted truncate">— {req.message}</span>}
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

                {/* Acknowledged */}
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
                                    {req.message && <span className="text-ink-muted truncate">— {req.message}</span>}
                                </>
                            }
                            trailing={
                                isOpenSession ? (
                                    <Button variant="secondary" size="sm" loading={openingSession === req.id} onClick={() => handleOpenSession(req)}>
                                        Open
                                    </Button>
                                ) : (req.acknowledged_by && req.acknowledged_by !== userId) ? (
                                    null
                                ) : (
                                    <Button variant="secondary" size="sm" onClick={() => handleComplete(req.id)}>Done</Button>
                                )
                            }
                        />
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Sticky Sub-tabs */}
            <div className="bg-canvas py-1 border-b border-hairline flex items-center w-full">
                <div className="grid grid-cols-3 gap-2 w-full">
                    {/* Food Tab */}
                    <button
                        onClick={() => setActiveTab('food')}
                        className={`relative flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-extrabold transition-all active:scale-95 w-full ${
                            activeTab === 'food'
                                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                                : 'bg-white border border-hairline text-gray-500 hover:bg-gray-50 hover:text-gray-700 shadow-sm'
                        }`}
                    >
                        <Utensils size={13} />
                        FOOD
                        {foodCount > 0 && (
                            <div className="absolute -top-2.5 -right-2.5 w-6 h-6 flex items-center justify-center pointer-events-none">
                                <Flame 
                                    size={20} 
                                    className="transition-all fill-[#EA580C] text-[#EA580C]" 
                                  />
                                <span className="absolute text-[8px] font-black tracking-tighter pt-1.5 text-white">
                                    {foodCount}
                                </span>
                            </div>
                        )}
                    </button>

                    {/* Service Tab */}
                    <button
                        onClick={() => setActiveTab('service')}
                        className={`relative flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-extrabold transition-all active:scale-95 w-full ${
                            activeTab === 'service'
                                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                                : 'bg-white border border-hairline text-gray-500 hover:bg-gray-50 hover:text-gray-700 shadow-sm'
                        }`}
                    >
                        <HandHelping size={13} />
                        SERVICE
                        {serviceCount > 0 && (
                            <div className="absolute -top-2.5 -right-2.5 w-6 h-6 flex items-center justify-center pointer-events-none">
                                <Flame 
                                    size={20} 
                                    className="transition-all fill-[#EA580C] text-[#EA580C]" 
                                  />
                                <span className="absolute text-[8px] font-black tracking-tighter pt-1.5 text-white">
                                    {serviceCount}
                                </span>
                            </div>
                        )}
                    </button>

                    {/* Billing Tab */}
                    <button
                        onClick={() => setActiveTab('billing')}
                        className={`relative flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-extrabold transition-all active:scale-95 w-full ${
                            activeTab === 'billing'
                                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                                : 'bg-white border border-hairline text-gray-500 hover:bg-gray-50 hover:text-gray-700 shadow-sm'
                        }`}
                    >
                        <Banknote size={13} />
                        {billingCount > 0 && (
                            <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                activeTab === 'billing' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'
                            }`}>
                                {billingCount}
                            </span>
                        )}
                        BILLING
                    </button>
                </div>
            </div>

            {/* Feeds Content */}
            <div className="pt-2">
                {activeTab === 'food' && renderRequestList(foodRequests)}
                {activeTab === 'service' && renderRequestList(serviceRequests)}
                {activeTab === 'billing' && (
                    <div className="space-y-6">
                        {renderRequestList(billRequests)}
                        {initialUnpaidOrders && initialUnpaidOrders.length > 0 && (
                            <CashPaymentFeed
                                initialOrders={initialUnpaidOrders}
                                restaurantId={restaurantId}
                                onPendingCountChange={setUnpaidCount}
                            />
                        )}
                        {features?.nepalPayEnabled && initialClaims && initialClaims.length > 0 && (
                            <PaymentVerificationFeed
                                initialClaims={initialClaims}
                                restaurantId={restaurantId}
                                userId={userId}
                                onPendingCountChange={setClaimsCount}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
