'use client'

import { useEffect, useState } from 'react'
import { Store, HandCoins, Loader2, Check, Footprints } from 'lucide-react'
import { requestCashCollection, getCashCollectionStatus } from '@/app/api/service-requests/actions'
import { createClient } from '@/lib/supabase/client'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'

type Mode = 'idle' | 'counter' | 'waiter'
type WaiterState = 'pending' | 'on_the_way' | 'done'

export default function CashPaymentChoice({ sessionId, restaurantId, totalAmount }: {
    sessionId: string
    restaurantId: string
    totalAmount: number
}) {
    const money = useCurrency()
    const [mode, setMode] = useState<Mode>('idle')
    const [loading, setLoading] = useState(false)
    const [waiterState, setWaiterState] = useState<WaiterState>('pending')
    const [waiterName, setWaiterName] = useState<string | undefined>()

    // While waiting on a waiter, subscribe to this session's request_bill row
    // instead of polling. `public_read_active_session_requests` (RLS) covers
    // anon read access, scoped to requests on a currently-active session.
    useEffect(() => {
        if (mode !== 'waiter') return
        let cancelled = false

        // One-shot check — covers a state change that landed before we subscribed.
        getCashCollectionStatus(sessionId).then((res) => {
            if (cancelled) return
            if (res.state === 'on_the_way') { setWaiterState('on_the_way'); setWaiterName(res.waiterName) }
            else if (res.state === 'done') setWaiterState('done')
        })

        const supabase = createClient()
        const channel = supabase
            .channel(`cash-request:${sessionId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'service_requests', filter: `session_id=eq.${sessionId}` },
                async (payload) => {
                    if (cancelled) return
                    const row = payload.new as { request_type?: string; status?: string }
                    if (row.request_type !== 'request_bill') return
                    if (row.status === 'completed') {
                        setWaiterState('done')
                    } else if (row.status === 'acknowledged') {
                        // Reuse the existing lookup for the acknowledging waiter's name
                        // rather than duplicating that join client-side.
                        const res = await getCashCollectionStatus(sessionId)
                        if (cancelled) return
                        setWaiterState('on_the_way')
                        setWaiterName(res.waiterName)
                    }
                }
            )
            .subscribe()

        return () => { cancelled = true; supabase.removeChannel(channel) }
    }, [mode, sessionId])

    const callWaiter = async () => {
        setLoading(true)
        const res = await requestCashCollection(sessionId, restaurantId)
        setLoading(false)
        if (!res.success) { toast.error(res.error || 'Failed to notify a waiter'); return }
        setMode('waiter')
        setWaiterState('pending')
    }

    return (
        <div className="mt-4 bg-surface rounded-2xl shadow-sm border border-hairline overflow-hidden">
            <div className="px-4 py-3 border-b border-hairline bg-surface-muted/60">
                <p className="font-bold text-sm text-ink">Pay with Cash</p>
            </div>

            <div className="p-4">
                {mode === 'idle' && (
                    <div className="grid grid-cols-1 gap-2">
                        <button
                            onClick={() => setMode('counter')}
                            className="flex items-center gap-3 w-full text-left border border-hairline-strong rounded-xl px-4 py-3 hover:bg-surface-muted active:scale-[0.99] transition"
                        >
                            <Store size={20} className="text-brand-500 shrink-0" />
                            <span>
                                <span className="block font-bold text-sm text-ink">Pay at Counter</span>
                                <span className="block text-xs text-ink-subtle">Settle your bill at the cashier.</span>
                            </span>
                        </button>
                        <button
                            onClick={callWaiter}
                            disabled={loading}
                            className="flex items-center gap-3 w-full text-left border border-hairline-strong rounded-xl px-4 py-3 hover:bg-surface-muted active:scale-[0.99] transition disabled:opacity-60"
                        >
                            {loading ? <Loader2 size={20} className="animate-spin text-brand-500 shrink-0" /> : <HandCoins size={20} className="text-brand-500 shrink-0" />}
                            <span>
                                <span className="block font-bold text-sm text-ink">Send Waiter to Collect Cash</span>
                                <span className="block text-xs text-ink-subtle">A waiter comes to your table to collect.</span>
                            </span>
                        </button>
                    </div>
                )}

                {mode === 'counter' && (
                    <div className="text-center py-2">
                        <Store size={28} className="text-brand-500 mx-auto mb-2" />
                        <p className="font-black text-ink">Please pay {money(totalAmount)} at the counter.</p>
                        <p className="text-xs text-ink-subtle mt-1">The cashier will mark your order paid.</p>
                        <button onClick={() => setMode('idle')} className="text-xs text-ink-subtle underline mt-3">Choose a different method</button>
                    </div>
                )}

                {mode === 'waiter' && (
                    <div className="text-center py-2">
                        {waiterState === 'done' ? (
                            <>
                                <Check size={28} className="text-green-600 mx-auto mb-2" />
                                <p className="font-black text-green-700">Payment received — thank you!</p>
                            </>
                        ) : waiterState === 'on_the_way' ? (
                            <>
                                <Footprints size={28} className="text-brand-500 mx-auto mb-2 animate-pulse" />
                                <p className="font-black text-ink">{waiterName || 'A waiter'} is on the way</p>
                                <p className="text-xs text-ink-subtle mt-1">Please have {money(totalAmount)} ready.</p>
                            </>
                        ) : (
                            <>
                                <Loader2 size={28} className="text-brand-500 mx-auto mb-2 animate-spin" />
                                <p className="font-black text-ink">Waiter notified</p>
                                <p className="text-xs text-ink-subtle mt-1">Someone will come to collect {money(totalAmount)}.</p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
