'use client'

import { useEffect, useRef, useState } from 'react'
import { Store, HandCoins, Loader2, Check, Footprints } from 'lucide-react'
import { requestCashCollection, getCashCollectionStatus } from '@/app/api/service-requests/actions'
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
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // While waiting on a waiter, poll for "on the way" (avoids anon realtime/RLS).
    useEffect(() => {
        if (mode !== 'waiter') return
        const tick = async () => {
            const res = await getCashCollectionStatus(sessionId)
            if (res.state === 'on_the_way') { setWaiterState('on_the_way'); setWaiterName(res.waiterName) }
            else if (res.state === 'done') { setWaiterState('done'); if (pollRef.current) clearInterval(pollRef.current) }
        }
        tick()
        pollRef.current = setInterval(tick, 4000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
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
        <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                <p className="font-bold text-sm text-[#1A1006]">Pay with Cash</p>
            </div>

            <div className="p-4">
                {mode === 'idle' && (
                    <div className="grid grid-cols-1 gap-2">
                        <button
                            onClick={() => setMode('counter')}
                            className="flex items-center gap-3 w-full text-left border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 active:scale-[0.99] transition"
                        >
                            <Store size={20} className="text-[#FB6303] shrink-0" />
                            <span>
                                <span className="block font-bold text-sm text-[#1A1006]">Pay at Counter</span>
                                <span className="block text-xs text-gray-500">Settle your bill at the cashier.</span>
                            </span>
                        </button>
                        <button
                            onClick={callWaiter}
                            disabled={loading}
                            className="flex items-center gap-3 w-full text-left border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 active:scale-[0.99] transition disabled:opacity-60"
                        >
                            {loading ? <Loader2 size={20} className="animate-spin text-[#FB6303] shrink-0" /> : <HandCoins size={20} className="text-[#FB6303] shrink-0" />}
                            <span>
                                <span className="block font-bold text-sm text-[#1A1006]">Send Waiter to Collect Cash</span>
                                <span className="block text-xs text-gray-500">A waiter comes to your table to collect.</span>
                            </span>
                        </button>
                    </div>
                )}

                {mode === 'counter' && (
                    <div className="text-center py-2">
                        <Store size={28} className="text-[#FB6303] mx-auto mb-2" />
                        <p className="font-black text-[#1A1006]">Please pay {money(totalAmount)} at the counter.</p>
                        <p className="text-xs text-gray-500 mt-1">The cashier will mark your order paid.</p>
                        <button onClick={() => setMode('idle')} className="text-xs text-gray-400 underline mt-3">Choose a different method</button>
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
                                <Footprints size={28} className="text-[#FB6303] mx-auto mb-2 animate-pulse" />
                                <p className="font-black text-[#1A1006]">{waiterName || 'A waiter'} is on the way</p>
                                <p className="text-xs text-gray-500 mt-1">Please have {money(totalAmount)} ready.</p>
                            </>
                        ) : (
                            <>
                                <Loader2 size={28} className="text-[#FB6303] mx-auto mb-2 animate-spin" />
                                <p className="font-black text-[#1A1006]">Waiter notified</p>
                                <p className="text-xs text-gray-500 mt-1">Someone will come to collect {money(totalAmount)}.</p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
