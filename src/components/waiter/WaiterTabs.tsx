'use client'

import React, { ReactNode, useState, isValidElement, cloneElement } from 'react'

type TabID = 'rooms' | 'tables' | 'space' | 'orders' | 'customer'

interface WaiterTabsProps {
    spaceContent: ReactNode
    roomsContent?: ReactNode
    tablesContent?: ReactNode
    ordersContent: ReactNode
    customerContent: ReactNode
    counts: {
        space: number
        rooms?: number
        tables?: number
        orders: number
        customer: number
    }
    isHotel?: boolean
    floorStatsElement?: ReactNode
}

export default function WaiterTabs({
    spaceContent,
    roomsContent,
    tablesContent,
    ordersContent,
    customerContent,
    counts,
    isHotel = false,
    floorStatsElement,
}: WaiterTabsProps) {
    const [activeTab, setActiveTab] = useState<TabID>(isHotel ? 'rooms' : 'space')

    const tabs: { id: TabID; label: string; count: number }[] = isHotel ? [
        { id: 'rooms', label: 'Rooms', count: counts.rooms ?? 0 },
        { id: 'tables', label: 'Tables', count: counts.tables ?? 0 },
        { id: 'orders', label: 'Kitchen', count: counts.orders },
        { id: 'customer', label: 'Customer', count: counts.customer },
    ] : [
        { id: 'space', label: 'Space', count: counts.space },
        { id: 'orders', label: 'Kitchen', count: counts.orders },
        { id: 'customer', label: 'Customer', count: counts.customer },
    ]

    const handleStatClick = (key: string) => {
        if (key === 'tables') setActiveTab(isHotel ? 'tables' : 'space')
        else if (key === 'ready' || key === 'kitchen') setActiveTab('orders')
        else if (key === 'requests') setActiveTab('customer')
    }

    const topStats = isValidElement(floorStatsElement)
        ? cloneElement(floorStatsElement as React.ReactElement<{ onStatClick?: (key: string) => void }>, { onStatClick: handleStatClick })
        : floorStatsElement

    return (
        <div className="w-full">
            {topStats && <div className="mb-4">{topStats}</div>}
            {/* Tab Navigation */}
            <div className={`grid ${isHotel ? 'grid-cols-4' : 'grid-cols-3'} border-b border-hairline mb-4 bg-surface sticky top-14 z-20 -mx-3 px-3 md:mx-0 md:px-0`}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center justify-center gap-2 py-4 text-sm font-bold whitespace-nowrap transition-colors relative focus:outline-none w-full ${
                                isActive ? 'text-[var(--brand-500)]' : 'text-ink-muted hover:text-ink'
                            }`}
                        >
                            <span>{tab.label}</span>
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
                {activeTab === 'rooms' && roomsContent && <div className="animate-fade-in">{roomsContent}</div>}
                {activeTab === 'tables' && tablesContent && <div className="animate-fade-in">{tablesContent}</div>}
                {activeTab === 'orders' && <div className="animate-fade-in">{ordersContent}</div>}
                {activeTab === 'customer' && <div className="animate-fade-in">{customerContent}</div>}
            </div>
        </div>
    )
}
