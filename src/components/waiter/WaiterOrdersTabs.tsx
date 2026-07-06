'use client'

import { ReactNode, useState } from 'react'
import { Utensils, ShoppingBag, Flame } from 'lucide-react'

interface Props {
    dineInFeed: ReactNode
    takeoutFeed: ReactNode
    deliveryFeed: ReactNode
    dineInCount: number
    takeawayCount: number
}

export default function WaiterOrdersTabs({
    dineInFeed,
    takeoutFeed,
    deliveryFeed,
    dineInCount,
    takeawayCount
}: Props) {
    const [filter, setFilter] = useState<'dine-in' | 'takeaway'>('dine-in')

    return (
        <div className="flex flex-col gap-4 w-full">
            {/* Sticky Sub-tabs / Filters */}
            <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full">
                <div className="grid grid-cols-2 gap-3 w-full">
                    <button
                        onClick={() => setFilter('dine-in')}
                        className={`relative flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-extrabold transition-all active:scale-95 w-full ${
                            filter === 'dine-in'
                                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                                : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                        }`}
                    >
                        <Utensils size={14} />
                        DINE-IN
                        {dineInCount > 0 && (
                            <div className="absolute -top-2.5 -right-2.5 w-6 h-6 flex items-center justify-center pointer-events-none">
                                <Flame 
                                    size={22} 
                                    className="transition-all fill-brand-600 text-brand-600" 
                                />
                                <span className="absolute text-[8.5px] font-black tracking-tighter pt-1.5 text-white">
                                    {dineInCount}
                                </span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => setFilter('takeaway')}
                        className={`relative flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-extrabold transition-all active:scale-95 w-full ${
                            filter === 'takeaway'
                                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                                : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                        }`}
                    >
                        <ShoppingBag size={14} />
                        Takeaway/Delivery
                        {takeawayCount > 0 && (
                            <div className="absolute -top-2.5 -right-2.5 w-6 h-6 flex items-center justify-center pointer-events-none">
                                <Flame 
                                    size={22} 
                                    className="transition-all fill-brand-600 text-brand-600" 
                                />
                                <span className="absolute text-[8.5px] font-black tracking-tighter pt-1.5 text-white">
                                    {takeawayCount}
                                </span>
                            </div>
                        )}
                    </button>
                </div>
            </div>

            {/* Feeds */}
            <div className="space-y-6">
                {filter === 'dine-in' && dineInFeed}
                {filter === 'takeaway' && (
                    <>
                        {takeoutFeed}
                        {deliveryFeed}
                    </>
                )}
            </div>
        </div>
    )
}
