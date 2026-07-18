'use client'

import { useState } from 'react'
import { Utensils, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import type { TableWithSession } from './CashierTableManager'
import { getRoomStatusConfig } from '@/lib/roomStatus'
import QuickOrderModal from './QuickOrderModal'

export interface RoomWithTypes {
    id: string
    room_number: string
    floor: string | null
    status: 'available' | 'occupied' | 'dirty' | 'maintenance'
    type_id: string | null
    room_types: {
        name: string
        base_price: number
        capacity: number
    } | null
}

export default function WaiterRoomManager({
    rooms,
    bookings,
    restaurantId,
    tables,
}: {
    rooms: RoomWithTypes[]
    bookings: any[]
    restaurantId: string
    tables: TableWithSession[]
}) {
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | 'occupied' | 'available' | 'dirty'>('all')
    const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
    const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null)
    const [foodOrderModalOpen, setFoodOrderModalOpen] = useState(false)

    const handleRoomClick = (room: RoomWithTypes) => {
        if (room.status !== 'occupied') {
            toast.error(`Room ${room.room_number} is vacant. Orders can only be placed for checked-in guests.`)
            return
        }

        const activeBooking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
        if (!activeBooking) {
            toast.error(`No active stay booking found for Room ${room.room_number}.`)
            return
        }

        setSelectedBookingId(activeBooking.id)
        setSelectedRoomNumber(room.room_number)
        setFoodOrderModalOpen(true)
    }

    const filteredRooms = rooms.filter(room => {
        const matchesSearch = room.room_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (room.room_types?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
        
        const matchesStatus = statusFilter === 'all' || room.status === statusFilter
        
        return matchesSearch && matchesStatus
    })

    const statusCounts = {
        all: rooms.length,
        occupied: rooms.filter(r => r.status === 'occupied').length,
        available: rooms.filter(r => r.status === 'available').length,
        dirty: rooms.filter(r => r.status === 'dirty').length,
    }

    return (
        <div className="w-full space-y-4">
            {/* Filter and Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface p-4 rounded-2xl border border-hairline shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                    {(['all', 'occupied', 'available', 'dirty'] as const).map(filter => {
                        const count = statusCounts[filter]
                        const isActive = statusFilter === filter
                        const label = filter === 'all' ? 'All Rooms' : filter === 'occupied' ? 'Booked' : filter === 'available' ? 'Available' : 'Cleaning'
                        const activeColors = {
                            all: 'bg-brand-500 text-white',
                            occupied: 'bg-blue-500 text-white border-blue-500',
                            available: 'bg-emerald-500 text-white border-emerald-500',
                            dirty: 'bg-amber-500 text-white border-amber-500',
                        }
                        
                        return (
                            <button
                                key={filter}
                                onClick={() => setStatusFilter(filter)}
                                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 whitespace-nowrap border ${
                                    isActive
                                        ? activeColors[filter]
                                        : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                }`}
                            >
                                <span>{label}</span>
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-surface/20 text-white' : 'bg-surface-muted text-ink-muted border border-hairline'
                                }`}>
                                    {count}
                                </span>
                            </button>
                        )
                    })}
                </div>

                <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" />
                    <input
                        type="text"
                        placeholder="Search rooms..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-hairline rounded-xl text-xs sm:text-sm bg-surface focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 font-semibold"
                    />
                </div>
            </div>

            {/* Rooms Grid */}
            <div className="p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4 bg-surface rounded-3xl border border-hairline shadow-sm">
                {filteredRooms.length === 0 ? (
                    <div className="col-span-full py-12 text-center">
                        <p className="text-sm font-semibold text-ink-muted">No rooms found matching this filter</p>
                    </div>
                ) : (
                    filteredRooms.map(room => {
                        const cfg = getRoomStatusConfig(room.status)
                        const isBooked = room.status === 'occupied'

                        return (
                            <button
                                key={room.id}
                                onClick={() => handleRoomClick(room)}
                                className={`relative aspect-square rounded-[20px] border flex flex-col items-center justify-center transition-all duration-300 ${cfg.card} hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95`}
                            >
                                <span className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-ink leading-tight text-center">
                                    {room.room_number}
                                </span>
                                {room.room_types && (
                                    <span className="text-[10px] font-bold text-ink-subtle mt-0.5 truncate max-w-full px-1.5">
                                        {room.room_types.name}
                                    </span>
                                )}
                                <span className={`uppercase tracking-wide mt-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border ${cfg.badge} ${cfg.badgeBorder}`}>
                                    {cfg.label}
                                </span>
                                {isBooked && (
                                    <span className="absolute top-1.5 left-1.5 text-emerald-600 bg-emerald-50 p-1 rounded-lg border border-emerald-100 shadow-sm animate-pulse">
                                        <Utensils size={10} />
                                    </span>
                                )}
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
                            </button>
                        )
                    })
                )}
            </div>

            {/* Quick Food Order Modal */}
            {foodOrderModalOpen && selectedBookingId && (
                (() => {
                    const matchingTable = tables.find(t => t.room_id === rooms.find(r => r.room_number === selectedRoomNumber)?.id)
                    const resolvedSessionId = matchingTable?.activeSession?.id
                    return (
                        <QuickOrderModal
                            isOpen={foodOrderModalOpen}
                            onClose={() => {
                                setFoodOrderModalOpen(false)
                                setSelectedBookingId(null)
                                setSelectedRoomNumber(null)
                            }}
                            sessionId={resolvedSessionId || undefined}
                            tableName={selectedRoomNumber ? `Room ${selectedRoomNumber}` : undefined}
                            restaurantId={restaurantId}
                            bookingId={selectedBookingId}
                            onSuccess={() => {
                                setFoodOrderModalOpen(false)
                                setSelectedBookingId(null)
                                setSelectedRoomNumber(null)
                            }}
                        />
                    )
                })()
            )}
        </div>
    )
}
