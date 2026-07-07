'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { createClient } from '@/lib/supabase/client'
import { Users, X, Check, Bed, ClipboardList, Loader2, CreditCard, RefreshCw } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { useCurrency } from '@/lib/contexts/FeatureContext'

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

const STATUS_CONFIG = {
    available: { dot: 'bg-emerald-500', card: 'border-emerald-100 bg-emerald-50/10', text: 'text-emerald-700 bg-emerald-50 border-emerald-100', label: 'Available' },
    occupied:  { dot: 'bg-blue-500 animate-pulse', card: 'border-blue-250 bg-blue-50/10', text: 'text-blue-700 bg-blue-50 border-blue-100', label: 'Booked' },
    dirty:     { dot: 'bg-amber-500', card: 'border-amber-250 bg-amber-50/10', text: 'text-amber-700 bg-amber-50 border-amber-100', label: 'Cleaning' },
    maintenance: { dot: 'bg-rose-500', card: 'border-rose-250 bg-rose-50/10', text: 'text-rose-700 bg-rose-50 border-rose-100', label: 'Closed' },
}

export default function CashierRoomManager({
    initialRooms,
    restaurantId,
    roomsFilter,
}: {
    initialRooms: RoomWithTypes[]
    restaurantId: string
    roomsFilter: 'all' | 'available' | 'reserve' | 'occupied' | 'dirty' | 'closed'
}) {
    const [rooms, setRooms] = useState<RoomWithTypes[]>(initialRooms)
    const [selectedRoom, setSelectedRoom] = useState<RoomWithTypes | null>(null)
    const [activeBooking, setActiveBooking] = useState<any | null>(null)
    const [loadingBooking, setLoadingBooking] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const money = useCurrency()
    const supabaseRef = useRef(createClient())

    useEffect(() => {
        setMounted(true)
    }, [])

    // Realtime subscriptions for rooms
    useRestaurantTable(restaurantId, 'rooms', (payload) => {
        if (payload.eventType === 'UPDATE') {
            const updatedRoom = payload.new as any
            setRooms(prev => prev.map(r => r.id === updatedRoom.id ? { ...r, status: updatedRoom.status } : r))
            setSelectedRoom(prev => prev?.id === updatedRoom.id ? { ...prev, status: updatedRoom.status } : prev)
        }
    })

    // Fetch active booking details when selected room is occupied
    useEffect(() => {
        if (selectedRoom && selectedRoom.status === 'occupied') {
            setLoadingBooking(true)
            fetch(`/api/rooms/booking?roomId=${selectedRoom.id}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        setActiveBooking(data.data)
                    } else {
                        setActiveBooking(null)
                    }
                })
                .catch(err => {
                    console.error("Error fetching room booking details:", err)
                    setActiveBooking(null)
                })
                .finally(() => {
                    setLoadingBooking(false)
                })
        } else {
            setActiveBooking(null)
        }
    }, [selectedRoom, rooms])

    // Filter rooms
    const filteredRooms = useMemo(() => {
        if (roomsFilter === 'all') return rooms
        return rooms.filter(r => {
            if (roomsFilter === 'available') return r.status === 'available'
            if (roomsFilter === 'occupied') return r.status === 'occupied'
            if (roomsFilter === 'dirty') return r.status === 'dirty'
            if (roomsFilter === 'closed') return r.status === 'maintenance'
            if (roomsFilter === 'reserve') return false // dummy reserved status
            return true
        })
    }, [rooms, roomsFilter])

    // Change room status helper
    const handleStatusChange = async (roomId: string, newStatus: 'available' | 'dirty' | 'maintenance') => {
        setIsProcessing(true)
        try {
            const res = await fetch(`/api/rooms/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, status: newStatus })
            })
            if (!res.ok) {
                throw new Error('Failed to update status')
            }
            setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
            if (selectedRoom?.id === roomId) {
                setSelectedRoom(prev => prev ? { ...prev, status: newStatus } : null)
            }
            toast.success(`Room status updated successfully`)
        } catch {
            toast.error('Failed to update room status')
        } finally {
            setIsProcessing(false)
        }
    }

    // Checkout guest helper
    const handleCheckout = async () => {
        if (!selectedRoom || !activeBooking) return
        setIsProcessing(true)
        try {
            const res = await fetch(`/api/bookings/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: activeBooking.id,
                    room_id: selectedRoom.id
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            
            toast.success(`Guest checked out successfully! Room ${selectedRoom.room_number} is now sent for cleaning.`)
            setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, status: 'dirty' } : r))
            setSelectedRoom(null)
        } catch (e: any) {
            toast.error(e.message || 'Checkout failed')
        } finally {
            setIsProcessing(false)
        }
    }

    const formatDateTime = (dateStr: string) => {
        if (!dateStr) return '-'
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        })
    }

    return (
        <div className="w-full">
            <div className="p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4 bg-surface rounded-3xl border border-hairline shadow-sm">
                {filteredRooms.length === 0 ? (
                    <div className="col-span-full py-12 text-center">
                        <p className="text-sm font-semibold text-ink-muted">No rooms found matching this filter</p>
                    </div>
                ) : (
                    filteredRooms.map(room => {
                        const status = room.status
                        const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.available
                        
                        return (
                            <button
                                key={room.id}
                                onClick={() => {
                                    setSelectedRoom(room)
                                }}
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
                                <span className={`uppercase tracking-wide mt-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border ${cfg.text}`}>
                                    {cfg.label}
                                </span>
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot}`} />
                            </button>
                        )
                    })
                )}
            </div>

            {/* Modal Overlay */}
            {mounted && selectedRoom && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setSelectedRoom(null)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md overflow-hidden transform transition-all"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink">
                                    Room {selectedRoom.room_number}
                                </h3>
                                <p className="text-caption text-ink-subtle mt-0.5">
                                    {selectedRoom.room_types?.name} • Floor {selectedRoom.floor || 'N/A'}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedRoom(null)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[75vh] overflow-y-auto">
                            {selectedRoom.status === 'occupied' ? (
                                // Occupied Details (active guest details)
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider flex items-center gap-1.5">
                                        <ClipboardList size={13} /> Active Booking Details
                                    </h4>
                                    
                                    {loadingBooking ? (
                                        <div className="py-8 flex justify-center">
                                            <Loader2 size={24} className="animate-spin text-brand-500" />
                                        </div>
                                    ) : activeBooking ? (
                                        <div className="space-y-3.5 bg-surface-muted/50 border border-hairline rounded-xl p-4 text-xs">
                                            <div className="flex justify-between items-center py-1">
                                                <span className="text-ink-subtle font-bold">Guest Name</span>
                                                <span className="font-extrabold text-ink">{activeBooking.guest_name}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1">
                                                <span className="text-ink-subtle font-bold">Phone Number</span>
                                                <span className="font-semibold text-ink-muted">{activeBooking.guest_phone || '-'}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1">
                                                <span className="text-ink-subtle font-bold">Check-in Time</span>
                                                <span className="font-semibold text-ink-muted">{formatDateTime(activeBooking.check_in)}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1">
                                                <span className="text-ink-subtle font-bold">Check-out Time</span>
                                                <span className="font-semibold text-ink-muted">{formatDateTime(activeBooking.check_out)}</span>
                                            </div>
                                            <div className="flex justify-between items-center py-1">
                                                <span className="text-ink-subtle font-bold">Guests</span>
                                                <span className="font-semibold text-ink-muted">
                                                    {activeBooking.adults} Adults, {activeBooking.children || 0} Children
                                                </span>
                                            </div>
                                            
                                            <div className="border-t border-hairline pt-3 mt-2 flex justify-between items-center text-sm font-bold">
                                                <span className="text-ink-muted">Paid amount:</span>
                                                <span className="text-emerald-600 font-extrabold">{money(activeBooking.paid_amount || 0)}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 text-center border border-dashed border-hairline-strong rounded-xl">
                                            <p className="text-xs text-ink-subtle">No active booking record found.</p>
                                        </div>
                                    )}

                                    <Button
                                        variant="danger"
                                        block
                                        icon={CreditCard}
                                        loading={isProcessing}
                                        onClick={handleCheckout}
                                    >
                                        Checkout Guest
                                    </Button>
                                </div>
                            ) : (
                                // Non-occupied Room Management
                                <div className="space-y-4">
                                    <div className="bg-surface-muted/50 border border-hairline rounded-xl p-4 text-xs space-y-2.5">
                                        <div className="flex justify-between">
                                            <span className="text-ink-subtle font-bold">Base Price</span>
                                            <span className="font-extrabold text-ink">{money(selectedRoom.room_types?.base_price || 0)} / Night</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-ink-subtle font-bold">Capacity</span>
                                            <span className="font-semibold text-ink-muted">{selectedRoom.room_types?.capacity} Guests max</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-ink-subtle font-bold">Current Status</span>
                                            <span className="font-extrabold uppercase text-brand-600">{selectedRoom.status === 'dirty' ? 'Cleaning' : selectedRoom.status === 'maintenance' ? 'Closed' : 'Available'}</span>
                                        </div>
                                    </div>

                                    {selectedRoom.status === 'dirty' && (
                                        <Button
                                            variant="success"
                                            block
                                            icon={Check}
                                            loading={isProcessing}
                                            onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                        >
                                            ✓ Cleaned (Set Available)
                                        </Button>
                                    )}

                                    {selectedRoom.status === 'maintenance' && (
                                        <Button
                                            variant="success"
                                            block
                                            icon={Check}
                                            loading={isProcessing}
                                            onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                        >
                                            ✓ Open Room (Make Available)
                                        </Button>
                                    )}

                                    {selectedRoom.status === 'available' && (
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <Button
                                                variant="secondary"
                                                icon={X}
                                                block
                                                loading={isProcessing}
                                                onClick={() => handleStatusChange(selectedRoom.id, 'maintenance')}
                                            >
                                                Close Room
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                icon={RefreshCw}
                                                block
                                                loading={isProcessing}
                                                onClick={() => handleStatusChange(selectedRoom.id, 'dirty')}
                                            >
                                                Send to Cleaning
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
