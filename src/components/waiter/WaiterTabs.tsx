'use client'

import React, { ReactNode, useState, isValidElement, cloneElement } from 'react'

type TabID = 'space' | 'orders' | 'customer'

interface WaiterTabsProps {
    spaceContent: ReactNode
    ordersContent: ReactNode
    customerContent: ReactNode
    counts: {
        space: number
        orders: number
        customer: number
    }
    floorStatsElement?: ReactNode
}

export default function WaiterTabs({
    spaceContent,
    ordersContent,
    customerContent,
    counts,
    floorStatsElement,
}: WaiterTabsProps) {
    const [activeTab, setActiveTab] = useState<TabID>('space')

    const tabs: { id: TabID; label: string; count: number }[] = [
        { id: 'space', label: 'Space', count: counts.space },
        { id: 'orders', label: 'Kitchen', count: counts.orders },
        { id: 'customer', label: 'Customer', count: counts.customer },
    ]

    const handleStatClick = (key: string) => {
        if (key === 'tables') setActiveTab('space')
        else if (key === 'ready' || key === 'kitchen') setActiveTab('orders')
        else if (key === 'requests') setActiveTab('customer')
    }

    const topStats = isValidElement(floorStatsElement)
        ? cloneElement(floorStatsElement as React.ReactElement<any>, { onStatClick: handleStatClick })
        : floorStatsElement

    return (
        <div className="w-full">
            {topStats && <div className="mb-4">{topStats}</div>}
            {/* Tab Navigation */}
            <div className="flex border-b border-hairline overflow-x-auto no-scrollbar mb-4 bg-surface sticky top-14 z-20 -mx-3 px-3 md:mx-0 md:px-0">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-4 text-sm font-bold whitespace-nowrap transition-colors relative focus:outline-none ${
                                isActive ? 'text-[var(--brand-500)]' : 'text-ink-muted hover:text-ink'
                            }`}
                        >
                            {tab.label}
                            {tab.count > 0 && (
                                <span className={`flex items-center justify-center min-w-[20px] h-[20px] rounded-full text-[11px] font-bold px-1.5 ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-ink-subtle text-white'
                                }`}>
                                    {tab.count}
                                </span>
                            )}
                            {isActive && (
                                <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[var(--brand-500)] rounded-t-full" />
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Tab Content */}
            <div>
                {activeTab === 'space' && <div className="animate-fade-in">{spaceContent}</div>}
                {activeTab === 'orders' && <div className="animate-fade-in">{ordersContent}</div>}
                {activeTab === 'customer' && <div className="animate-fade-in">{customerContent}</div>}
            </div>
        </div>
    )
}
