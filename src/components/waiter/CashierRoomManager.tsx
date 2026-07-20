'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { createClient } from '@/lib/supabase/client'
import { Users, X, Check, Bed, ClipboardList, Loader2, CreditCard, RefreshCw, Calendar, FileText, Plus, Landmark, Utensils } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { useCurrency, useFeatures, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { type TableWithSession } from './CashierTableManager'
import { formatDateTime, calculateNights, advanceMethodLabel } from '@/lib/utils'
import QuickOrderModal from './QuickOrderModal'
import { openSession } from '@/app/(staff)/waiter/actions'
import { useQrCodes } from '@/lib/hooks/useQrCodes'
import { getRoomStatusConfig } from '@/lib/roomStatus'
import Select from '@/components/ui/Select'

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

export default function CashierRoomManager({
    rooms,
    setRooms,
    bookings,
    setBookings,
    restaurantId,
    partnerRestaurantId,
    roomsFilter,
    tables,
    activeOrders,
    unpaidOrders,
    onGoToBilling,
    onOrderPlaced,
}: {
    rooms: RoomWithTypes[]
    setRooms: React.Dispatch<React.SetStateAction<any[]>>
    bookings: any[]
    setBookings: React.Dispatch<React.SetStateAction<any[]>>
    restaurantId: string
    partnerRestaurantId?: string | null
    roomsFilter: 'all' | 'available' | 'reserve' | 'occupied' | 'dirty' | 'closed'
    tables: TableWithSession[]
    activeOrders: any[]
    unpaidOrders: any[]
    onGoToBilling?: (room: any) => void
    onOrderPlaced?: (orderId: string) => void
}) {
    const [selectedRoom, setSelectedRoom] = useState<RoomWithTypes | null>(null)
    const [activeBooking, setActiveBooking] = useState<any | null>(null)
    const [loadingBooking, setLoadingBooking] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mounted, setMounted] = useState(false)
    const features = useFeatures()
    const irdSyncEnabled = features?.irdSyncEnabled ?? false
    const money = useCurrency()
    const supabaseRef = useRef(createClient())
    const manualEntryEnabled = useFeatureEnabled('manualEntryEnabled')

    // Sub-modal and drawer states
    const [bookingFormOpen, setBookingFormOpen] = useState(false)
    const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
    const [confirmDirtyOpen, setConfirmDirtyOpen] = useState(false)
    
    // Manual charge addition states
    const [manualCharges, setManualCharges] = useState<any[]>([])
    const [linkedDiningOrders, setLinkedDiningOrders] = useState<any[]>([])
    const filteredLinkedDiningOrders = (() => {
        return linkedDiningOrders.filter(o => !o.is_room_order)
    })()
    const [loadingCharges, setLoadingCharges] = useState(false)
    const [showAddChargeForm, setShowAddChargeForm] = useState(false)
    const [newCharge, setNewCharge] = useState({
        charge_type: 'minibar',
        description: '',
        amount: ''
    })
    const [foodOrderModalOpen, setFoodOrderModalOpen] = useState(false)
    const [createdSessionId, setCreatedSessionId] = useState<string | null>(null)
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    // Booking form inputs
    const [bookingForm, setBookingForm] = useState({
        guest_name: '',
        guest_phone: '',
        kyc: '',
        check_in: '',
        check_out: '',
        guest_count: '2'
    })
    const [advanceType, setAdvanceType] = useState<'none' | 'full' | 'partial'>('none')
    const [advanceAmount, setAdvanceAmount] = useState<string>('')
    const [advancePayMethod, setAdvancePayMethod] = useState<'cash' | 'qr_digital' | 'split'>('cash')
    const [advanceSplitCash, setAdvanceSplitCash] = useState<string>('')
    const [advanceSplitQr, setAdvanceSplitQr] = useState<string>('')
    const [advanceQrCodeId, setAdvanceQrCodeId] = useState<string>('')
    const qrCodes = useQrCodes()

    useEffect(() => {
        setMounted(true)
    }, [])

    // Track activeBooking in a ref to avoid stale closure issues in realtime callback
    const activeBookingRef = useRef(activeBooking)
    useEffect(() => {
        activeBookingRef.current = activeBooking
    }, [activeBooking])

    // Realtime subscriptions for rooms
    useRestaurantTable(restaurantId, 'rooms', (payload) => {
        if (payload.eventType === 'UPDATE') {
            const updatedRoom = payload.new as any
            setRooms(prev => prev.map(r => r.id === updatedRoom.id ? { ...r, status: updatedRoom.status } : r))
            setSelectedRoom(prev => {
                if (!prev) return null
                return prev.id === updatedRoom.id ? { ...prev, status: updatedRoom.status } : prev
            })
        }
    })

    // Realtime subscription for orders to refresh linked table dining orders instantly
    useRestaurantTable(partnerRestaurantId || restaurantId, 'orders', (payload) => {
        const currentBooking = activeBookingRef.current
        if (!currentBooking) return
        
        fetch(`/api/bookings/linked-orders?bookingId=${currentBooking.id}`)
            .then(res => res.json())
            .then(linkedRes => {
                if (linkedRes.success) {
                    setLinkedDiningOrders(linkedRes.items || [])
                }
            })
            .catch(err => console.error("Error refreshing linked dining orders in real-time:", err))
    })

    // Prepopulate booking form check-in/out default values
    const prepopulateBookingForm = () => {
        const checkIn = new Date()
        const checkOut = new Date()
        checkOut.setDate(checkOut.getDate() + 1) // default 1 night stay

        // Format to YYYY-MM-DDTHH:MM for datetime-local inputs
        const formatLocalTime = (d: Date) => {
            const pad = (n: number) => (n < 10 ? '0' : '') + n
            return d.getFullYear() + '-' +
                pad(d.getMonth() + 1) + '-' +
                pad(d.getDate()) + 'T' +
                pad(d.getHours()) + ':' +
                pad(d.getMinutes())
        }

        setBookingForm({
            guest_name: '',
            guest_phone: '',
            kyc: '',
            check_in: formatLocalTime(checkIn),
            check_out: formatLocalTime(checkOut),
            guest_count: '1'
        })
        setAdvanceType('none')
        setAdvanceAmount('')
        setAdvancePayMethod('cash')
        setAdvanceSplitCash('')
        setAdvanceSplitQr('')
        setAdvanceQrCodeId('')
    }

    // Fetch active booking details, manual charges, and linked dining orders concurrently when selected room is occupied
    useEffect(() => {
        if (selectedRoom && selectedRoom.status === 'occupied') {
            setLoadingBooking(true)
            fetch(`/api/rooms/booking?roomId=${selectedRoom.id}`)
                .then(res => res.json())
                .then(async (data) => {
                    if (data.success && data.data) {
                        const booking = data.data
                        try {
                            setLoadingCharges(true)
                            // Concurrently fetch charges and linked dining orders
                            const [chargesRes, linkedRes] = await Promise.all([
                                fetch(`/api/rooms/charges?bookingId=${booking.id}`).then(r => r.json()),
                                fetch(`/api/bookings/linked-orders?bookingId=${booking.id}`).then(r => r.json())
                            ])
                            
                            // Set all states simultaneously
                            setActiveBooking(booking)
                            if (chargesRes.success) {
                                setManualCharges(chargesRes.data || [])
                            }
                            if (linkedRes.success) {
                                setLinkedDiningOrders(linkedRes.items || [])
                            }
                        } catch (err) {
                            console.error("Error fetching secondary stay details:", err)
                            // Set basic stay booking at least
                            setActiveBooking(booking)
                            setManualCharges([])
                            setLinkedDiningOrders([])
                        } finally {
                            setLoadingCharges(false)
                        }
                    } else {
                        setActiveBooking(null)
                        setManualCharges([])
                        setLinkedDiningOrders([])
                    }
                })
                .catch(err => {
                    console.error("Error fetching room booking details:", err)
                    setActiveBooking(null)
                    setManualCharges([])
                    setLinkedDiningOrders([])
                })
                .finally(() => {
                    setLoadingBooking(false)
                })
        } else {
            setActiveBooking(null)
            setManualCharges([])
            setLinkedDiningOrders([])
            setShowAddChargeForm(false)
            setCreatedSessionId(null)
        }
    }, [selectedRoom, rooms, refreshTrigger])

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

    // Room-service orders bucket (the room's own QR table + manual "direct to
    // room" orders placed from the cashier/manager). We derive it from the SAME
    // linked-orders source as the dining bucket below (`filteredLinkedDiningOrders`),
    // splitting on the `is_room_order` flag the API sets. That keeps this total in
    // lock-step with the manager's RoomBillingModal, which sums every linked item.
    //
    // The previous implementation read session-based orders and required a room
    // session (sessions.tables.room_id). A manual placeRoomOrderDirect order has
    // session_id NULL, so it was silently dropped here AND excluded from the dining
    // bucket (is_room_order === true) — vanishing from the cashier bill while still
    // appearing on the manager's, so the two panels showed different totals. Reading
    // both buckets from the one linked-orders array closes that gap.
    const qrOrdersDetails = useMemo(() => {
        if (!selectedRoom || selectedRoom.status !== 'occupied' || !activeBooking) return null

        const roomItems = linkedDiningOrders.filter(o => o.is_room_order)
        const items = roomItems.map(it => ({
            name: (it.menu_items as any)?.name || 'Item',
            quantity: it.quantity || 0,
            unitPrice: Number(it.unit_price ?? 0),
        }))
        const total = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)

        return { items, total }
    }, [selectedRoom, activeBooking, linkedDiningOrders])

    // Stay night and price calculations
    const stayPriceDetails = useMemo(() => {
        if (!selectedRoom || !activeBooking) return { nights: 0, cost: 0 }
        
        const price = selectedRoom.room_types?.base_price || 0
        const nights = calculateNights(activeBooking.check_in, activeBooking.check_out)
        const cost = price * nights

        return { nights, cost }
    }, [selectedRoom, activeBooking])

    // Grand total
    const grandTotal = useMemo(() => {
        const roomStayCost = stayPriceDetails.cost
        const qrOrdersTotal = qrOrdersDetails?.total || 0
        const manualChargesTotal = manualCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        const linkedDiningTotal = filteredLinkedDiningOrders.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
        return roomStayCost + qrOrdersTotal + manualChargesTotal + linkedDiningTotal
    }, [stayPriceDetails, qrOrdersDetails, manualCharges, filteredLinkedDiningOrders])

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
            setConfirmCloseOpen(false)
            setConfirmDirtyOpen(false)
        } catch {
            toast.error('Failed to update room status')
        } finally {
            setIsProcessing(false)
        }
    }

    const handleOpenFoodOrder = async () => {
        if (!selectedRoom) return
        
        const matchingTable = tables.find(t => t.room_id === selectedRoom.id)
        if (!matchingTable) {
            // Open directly using bookingId (no table session needed)
            setFoodOrderModalOpen(true)
            return
        }

        const existingSessionId = matchingTable.activeSession?.id || createdSessionId
        if (existingSessionId) {
            setFoodOrderModalOpen(true)
            return
        }

        // Create a new session dynamically
        setIsProcessing(true)
        try {
            const res = await openSession(matchingTable.id, restaurantId)
            if (res.error) {
                toast.error(`Could not start food order session: ${res.error}`)
                return
            }
            if (res.session?.id) {
                setCreatedSessionId(res.session.id)
                setFoodOrderModalOpen(true)
            } else {
                toast.error("Could not start food order session.")
            }
        } catch (err) {
            console.error("Error creating session for room order:", err)
            toast.error("Failed to start session.")
        } finally {
            setIsProcessing(false)
        }
    }

    // Submit booking handler
    const handleCreateBooking = async () => {
        if (!selectedRoom) return
        if (!bookingForm.guest_name.trim()) { toast.error('Guest name is required'); return }
        if (!bookingForm.guest_phone.trim()) { toast.error('Phone number is required'); return }
        if (!bookingForm.check_in || !bookingForm.check_out) { toast.error('Check-in and Check-out dates are required'); return }

        // Calculate advance amount to send
        const basePrice = selectedRoom.room_types?.base_price || 0
        const inDate = new Date(bookingForm.check_in)
        const outDate = new Date(bookingForm.check_out)
        const diffMs = outDate.getTime() - inDate.getTime()
        const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
        const fullCost = basePrice * nights

        let resolvedAdvance = 0
        if (advanceType === 'full') {
            resolvedAdvance = fullCost
        } else if (advanceType === 'partial') {
            resolvedAdvance = Math.max(0, parseFloat(advanceAmount) || 0)
            if (resolvedAdvance <= 0) { toast.error('Please enter a valid advance amount'); return }
            if (resolvedAdvance >= fullCost) { toast.error('Partial advance must be less than total room cost'); return }
        }

        const isSplit = advanceType !== 'none' && advancePayMethod === 'split'
        const splitCash = Math.max(0, parseFloat(advanceSplitCash) || 0)
        const splitQr = Math.max(0, parseFloat(advanceSplitQr) || 0)
        if (isSplit && Math.round((splitCash + splitQr) * 100) !== Math.round(resolvedAdvance * 100)) {
            toast.error(`Cash + QR must add up to the advance amount (Rs. ${resolvedAdvance.toLocaleString()})`)
            return
        }

        setIsProcessing(true)
        try {
            const res = await fetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room_id: selectedRoom.id,
                    guest_name: bookingForm.guest_name,
                    guest_phone: bookingForm.guest_phone,
                    kyc: bookingForm.kyc,
                    check_in: bookingForm.check_in,
                    check_out: bookingForm.check_out,
                    guest_count: bookingForm.guest_count,
                    advance_amount: resolvedAdvance,
                    advance_payment_method: resolvedAdvance > 0 ? (irdSyncEnabled ? advancePayMethod : 'cash') : 'none',
                    advance_cash_amount: (irdSyncEnabled && isSplit) ? splitCash : undefined,
                    advance_qr_amount: (irdSyncEnabled && isSplit) ? splitQr : undefined,
                    advance_qr_code_id: (irdSyncEnabled && resolvedAdvance > 0 && (advancePayMethod === 'qr_digital' || isSplit))
                        ? (advanceQrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined))
                        : undefined,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success(`Room ${selectedRoom.room_number} booked!${resolvedAdvance > 0 ? ` Advance: Rs. ${resolvedAdvance.toLocaleString()}` : ''}`)
            setRooms(prev => prev.map(r => r.id === selectedRoom.id ? { ...r, status: 'occupied' } : r))
            setBookings(prev => [...prev, data.data])
            setBookingFormOpen(false)
            setSelectedRoom(null)
            setAdvanceSplitCash('')
            setAdvanceSplitQr('')
            setAdvanceQrCodeId('')
        } catch (e: any) {
            toast.error(e.message || 'Failed to book room')
        } finally {
            setIsProcessing(false)
        }
    }

    // Add manual charge handler
    const handleAddManualCharge = async () => {
        if (!activeBooking || !selectedRoom) return
        if (!newCharge.description.trim()) { toast.error('Description is required'); return }
        const numAmount = parseFloat(newCharge.amount)
        if (isNaN(numAmount) || numAmount <= 0) { toast.error('Amount must be greater than 0'); return }

        setIsProcessing(true)
        try {
            const res = await fetch('/api/rooms/charges', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: activeBooking.id,
                    description: newCharge.description.trim(),
                    amount: numAmount,
                    charge_type: newCharge.charge_type
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            toast.success('Charge added successfully!')
            setManualCharges(prev => [...prev, data.data])
            setNewCharge({ charge_type: 'minibar', description: '', amount: '' })
            setShowAddChargeForm(false)
        } catch (e: any) {
            toast.error(e.message || 'Failed to add charge')
        } finally {
            setIsProcessing(false)
        }
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
                        const cfg = getRoomStatusConfig(room.status)

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
                                <span className={`uppercase tracking-wide mt-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border ${cfg.badge} ${cfg.badgeBorder}`}>
                                    {cfg.label}
                                </span>
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
                            </button>
                        )
                    })
                )}
            </div>

            {/* Modal Overlay for Available/Housekeeping/Closed rooms */}
            {mounted && selectedRoom && selectedRoom.status !== 'occupied' && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setSelectedRoom(null)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden transform transition-all"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink">
                                    Room {selectedRoom.room_number} Actions
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

                        {/* Room Management Actions */}
                        <div className="p-6 overflow-y-auto flex-1">
                            {bookingFormOpen ? (
                                // Booking input form
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-xs font-bold uppercase text-brand-600 tracking-wider">New Booking details</h4>
                                        <button onClick={() => setBookingFormOpen(false)} className="text-xs text-ink-subtle hover:underline font-semibold">Back</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                        <div className="col-span-2">
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Guest Name *</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. John Doe"
                                                value={bookingForm.guest_name}
                                                onChange={e => setBookingForm(b => ({ ...b, guest_name: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Phone *</label>
                                            <input
                                                type="text"
                                                placeholder="9841234567"
                                                value={bookingForm.guest_phone}
                                                onChange={e => setBookingForm(b => ({ ...b, guest_phone: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">KYC / ID (Optional)</label>
                                            <input
                                                type="text"
                                                placeholder="Passport / Citizenship"
                                                value={bookingForm.kyc}
                                                onChange={e => setBookingForm(b => ({ ...b, kyc: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Check-in *</label>
                                            <input
                                                type="datetime-local"
                                                value={bookingForm.check_in}
                                                onChange={e => setBookingForm(b => ({ ...b, check_in: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Check-out *</label>
                                            <input
                                                type="datetime-local"
                                                value={bookingForm.check_out}
                                                onChange={e => setBookingForm(b => ({ ...b, check_out: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Number of Guests *</label>
                                            <input
                                                type="number"
                                                min="1"
                                                value={bookingForm.guest_count}
                                                onChange={e => setBookingForm(b => ({ ...b, guest_count: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>

                                        {/* Advance Payment Section */}
                                        {(() => {
                                            const basePrice = selectedRoom.room_types?.base_price || 0
                                            const inDate = new Date(bookingForm.check_in)
                                            const outDate = new Date(bookingForm.check_out)
                                            const diffMs = outDate.getTime() - inDate.getTime()
                                            const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
                                            const fullCost = basePrice * nights
                                            return (
                                                <div className="col-span-2 border border-hairline rounded-2xl p-3 space-y-2 bg-surface-muted/30">
                                                    <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider">Advance Payment</p>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {(['none', 'full', 'partial'] as const).map(opt => (
                                                            <button
                                                                key={opt}
                                                                type="button"
                                                                onClick={() => {
                                                                    setAdvanceType(opt)
                                                                    setAdvanceAmount('')
                                                                }}
                                                                className={`py-2 px-1 rounded-xl border-2 text-[10px] font-bold transition-all ${
                                                                    advanceType === opt
                                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                                        : 'border-hairline bg-surface text-ink-muted hover:border-brand-300'
                                                                }`}
                                                            >
                                                                {opt === 'none' ? 'No Advance' : opt === 'full' ? `Full (Rs.${fullCost.toLocaleString()})` : 'Partial'}
                                                            </button>
                                                        ))}
                                                    </div>

                                                    {advanceType === 'partial' && (
                                                        <div>
                                                            <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Amount Paid Now</label>
                                                            <div className="relative">
                                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                                <input
                                                                    type="number"
                                                                    min="1"
                                                                    max={fullCost - 1}
                                                                    placeholder="e.g. 500"
                                                                    value={advanceAmount}
                                                                    onChange={e => setAdvanceAmount(e.target.value)}
                                                                    className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                                />
                                                            </div>
                                                            {advanceAmount && fullCost > 0 && (
                                                                <p className="text-[9px] text-amber-600 font-bold mt-1">
                                                                    Balance due at checkout: Rs. {Math.max(0, fullCost - (parseFloat(advanceAmount) || 0)).toLocaleString()}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {irdSyncEnabled && advanceType !== 'none' && (
                                                        <div>
                                                            <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Payment Method</label>
                                                            <div className="grid grid-cols-3 gap-2">
                                                                {(['cash', 'qr_digital', 'split'] as const).map(m => (
                                                                    <button
                                                                        key={m}
                                                                        type="button"
                                                                        onClick={() => setAdvancePayMethod(m)}
                                                                        className={`py-2 px-2 rounded-xl border-2 text-[10px] font-bold transition-all ${
                                                                            advancePayMethod === m
                                                                                ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                                                : 'border-hairline bg-surface text-ink-muted hover:border-brand-300'
                                                                        }`}
                                                                    >
                                                                        {m === 'cash' ? 'Cash' : m === 'qr_digital' ? 'QR / Digital' : 'Split'}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {irdSyncEnabled && advanceType !== 'none' && advancePayMethod === 'split' && (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Cash</label>
                                                                <div className="relative">
                                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        placeholder="0"
                                                                        value={advanceSplitCash}
                                                                        onChange={e => setAdvanceSplitCash(e.target.value)}
                                                                        className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">QR / Digital</label>
                                                                <div className="relative">
                                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        placeholder="0"
                                                                        value={advanceSplitQr}
                                                                        onChange={e => setAdvanceSplitQr(e.target.value)}
                                                                        className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {irdSyncEnabled && advanceType !== 'none' && (advancePayMethod === 'qr_digital' || advancePayMethod === 'split') && qrCodes.length > 1 && (
                                                        <div>
                                                            <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Which QR did the guest scan?</label>
                                                            <Select
                                                                value={advanceQrCodeId}
                                                                onChange={e => setAdvanceQrCodeId(e.target.value)}
                                                                className="w-full px-2 py-1.5 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                            >
                                                                <option value="">Select QR code…</option>
                                                                {qrCodes.map(qr => (
                                                                    <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                                ))}
                                                            </Select>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })()}
                                    </div>
                                </div>
                            ) : confirmCloseOpen ? (
                                // Confirm Close Modal
                                <div className="space-y-4 text-center py-2">
                                    <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-500">
                                        <X size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-extrabold text-ink text-base">Close Room {selectedRoom.room_number}?</h4>
                                        <p className="text-xs text-ink-subtle mt-1 px-4">
                                            This will mark the room as Closed/Maintenance. Only available rooms can be booked.
                                        </p>
                                    </div>
                                </div>
                            ) : confirmDirtyOpen ? (
                                // Confirm Dirty Modal
                                <div className="space-y-4 text-center py-2">
                                    <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-500">
                                        <RefreshCw size={24} className="animate-spin duration-1000" />
                                    </div>
                                    <div>
                                        <h4 className="font-extrabold text-ink text-base">Send Room {selectedRoom.room_number} to Cleaning?</h4>
                                        <p className="text-xs text-ink-subtle mt-1 px-4">
                                            This will set the room to Cleaning/Dirty. Staff must mark it cleaned before booking.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                // Choice buttons (Book, Reserve, Closed, Dirty)
                                <div className="space-y-3.5">
                                    {selectedRoom.status === 'available' ? (
                                        <div className="grid grid-cols-2 gap-3">
                                            <Button
                                                variant="primary"
                                                icon={Calendar}
                                                block
                                                onClick={() => {
                                                    prepopulateBookingForm()
                                                    setBookingFormOpen(true)
                                                }}
                                            >
                                                Book
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                icon={Users}
                                                block
                                                onClick={() => {
                                                    // Quick reserve sets to maintenance or occupied
                                                    prepopulateBookingForm()
                                                    setBookingFormOpen(true) // Open booking form to record details
                                                }}
                                            >
                                                Reserve
                                            </Button>
                                            <Button
                                                variant="danger"
                                                icon={X}
                                                block
                                                onClick={() => setConfirmCloseOpen(true)}
                                            >
                                                Closed
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                icon={RefreshCw}
                                                block
                                                onClick={() => setConfirmDirtyOpen(true)}
                                            >
                                                Dirty
                                            </Button>
                                        </div>
                                    ) : (
                                        // Housekeeping or closed room actions (Quick Open)
                                        <div className="space-y-3">
                                            <div className="p-4 bg-surface-muted/50 border border-hairline rounded-xl text-center">
                                                <p className="text-xs font-semibold text-ink-muted">
                                                    Current Status: <span className="uppercase font-black text-brand-600">{selectedRoom.status === 'dirty' ? 'Cleaning Required' : 'Closed for Maintenance'}</span>
                                                </p>
                                            </div>

                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer (Sticky actions) */}
                        {(bookingFormOpen || confirmCloseOpen || confirmDirtyOpen || selectedRoom.status !== 'available') ? (
                            <div className="border-t border-hairline px-6 py-4 flex-shrink-0 bg-surface">
                                {bookingFormOpen && (
                                    <Button
                                        variant="primary"
                                        block
                                        loading={isProcessing}
                                        onClick={handleCreateBooking}
                                        className="font-bold uppercase tracking-wider"
                                    >
                                        Book Room
                                    </Button>
                                )}
                                {confirmCloseOpen && (
                                    <div className="flex gap-3">
                                        <Button variant="secondary" block onClick={() => setConfirmCloseOpen(false)}>Cancel</Button>
                                        <Button variant="danger" block loading={isProcessing} onClick={() => handleStatusChange(selectedRoom.id, 'maintenance')}>Confirm Close</Button>
                                    </div>
                                )}
                                {confirmDirtyOpen && (
                                    <div className="flex gap-3">
                                        <Button variant="secondary" block onClick={() => setConfirmDirtyOpen(false)}>Cancel</Button>
                                        <Button variant="secondary" block loading={isProcessing} onClick={() => handleStatusChange(selectedRoom.id, 'dirty')} className="bg-brand-500 text-white hover:bg-brand-600 hover:border-brand-600">Confirm Dirty</Button>
                                    </div>
                                )}
                                {selectedRoom.status !== 'available' && !bookingFormOpen && !confirmCloseOpen && !confirmDirtyOpen && (
                                    <Button
                                        variant="success"
                                        icon={Check}
                                        block
                                        loading={isProcessing}
                                        onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                    >
                                        ✓ Make Available (Clean/Open)
                                    </Button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>,
                document.body
            )}

            {/* Bottom Drawer (Sheet) for Booked (Occupied) Room Click */}
            {mounted && selectedRoom && selectedRoom.status === 'occupied' && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedRoom(null)}
                >
                    <div 
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Drawer Header - sticky */}
                        <div className="flex items-center justify-between border-b border-hairline px-6 py-4 flex-shrink-0">
                            <div>
                                <div className="flex items-center gap-2">
                                    <Bed size={20} className="text-blue-500" />
                                    <h3 className="text-lg font-black text-ink">Room {selectedRoom.room_number} stays</h3>
                                </div>
                                <p className="text-xs text-ink-subtle mt-0.5">
                                    {selectedRoom.room_types?.name} • Floor {selectedRoom.floor || 'N/A'}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedRoom(null)}
                                className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-50 hover:bg-gray-150 transition text-ink-subtle hover:text-ink"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Scrollable content area */}
                        <div className="overflow-y-auto flex-1 px-6 py-4">
                        {loadingBooking ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-brand-500" />
                                <p className="text-xs text-ink-subtle font-semibold">Fetching guest details...</p>
                            </div>
                        ) : activeBooking ? (
                            <div className="space-y-6">
                                {/* Guest Details Section */}
                                <div className="grid grid-cols-2 gap-4 bg-surface-muted/50 border border-hairline rounded-2xl p-4 text-xs">
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest Information</p>
                                        <p className="font-extrabold text-ink text-sm">{activeBooking.guest_name}</p>
                                        <p className="font-semibold text-ink-muted">{activeBooking.guest_phone}</p>
                                        {activeBooking.notes && activeBooking.notes.startsWith('KYC:') && (
                                            <p className="text-[10px] bg-white border border-hairline px-2 py-0.5 rounded-md text-ink-muted inline-block">
                                                {activeBooking.notes}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2 text-right border-l border-hairline pl-4">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase text-right">Stay Schedule</p>
                                        <p className="font-semibold text-ink-muted"><span className="text-ink-subtle">In:</span> {formatDateTime(activeBooking.check_in)}</p>
                                        <p className="font-semibold text-ink-muted"><span className="text-ink-subtle">Out:</span> {formatDateTime(activeBooking.check_out)}</p>
                                        <p className="text-[10px] text-brand-500 font-extrabold">{activeBooking.adults} Guest(s)</p>
                                    </div>
                                </div>

                                {/* Billing Breakdown */}
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider flex items-center justify-between">
                                        <span>Stay billing breakdown</span>
                                        <span className="text-brand-500 normal-case tabular-nums">{stayPriceDetails.nights} Night(s)</span>
                                    </h4>

                                    <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface">
                                        {/* Room Stay Row */}
                                        <div className="flex justify-between items-center p-4 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">Room Stay Charge</p>
                                                <p className="text-[10px] text-ink-subtle">{money(selectedRoom.room_types?.base_price || 0)} / Night</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(stayPriceDetails.cost)}</span>
                                        </div>

                                        {/* QR Orders Row */}
                                        {qrOrdersDetails && qrOrdersDetails.items.length > 0 && (
                                            <div className="p-4 space-y-3">
                                                <div className="flex justify-between items-center text-xs">
                                                    <p className="font-extrabold text-indigo-600">QR Room Service Orders</p>
                                                    <span className="font-extrabold text-indigo-600 tabular-nums">{money(qrOrdersDetails.total)}</span>
                                                </div>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100 max-h-28 overflow-y-auto">
                                                    {qrOrdersDetails.items.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span>{item.name} <span className="text-[9px] text-brand-500">({item.quantity}×)</span></span>
                                                            <span className="tabular-nums font-semibold">{money(item.unitPrice * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Waiter Linked Restaurant Dining Row */}
                                        {filteredLinkedDiningOrders.length > 0 && (
                                            <div className="p-4 space-y-3">
                                                <div className="flex justify-between items-center text-xs">
                                                    <p className="font-extrabold text-emerald-600">Restaurant Dining (Table Orders)</p>
                                                    <span className="font-extrabold text-emerald-600 tabular-nums">
                                                        {money(filteredLinkedDiningOrders.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0))}
                                                    </span>
                                                </div>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-emerald-100 max-h-28 overflow-y-auto">
                                                    {filteredLinkedDiningOrders.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span>{item.menu_items?.name || 'Item'} <span className="text-[9px] text-brand-500">({item.quantity}×)</span></span>
                                                            <span className="tabular-nums font-semibold">{money(Number(item.unit_price) * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Manual Charges Row */}
                                        {manualCharges.length > 0 && (
                                            <div className="p-4 space-y-3">
                                                <div className="flex justify-between items-center text-xs">
                                                    <p className="font-extrabold text-amber-600">Manually Added Charges</p>
                                                    <span className="font-extrabold text-amber-600 tabular-nums">
                                                        {money(manualCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0))}
                                                    </span>
                                                </div>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-amber-100">
                                                    {manualCharges.map((charge) => (
                                                        <div key={charge.id} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span className="capitalize">{charge.description} <span className="text-[8px] bg-amber-50 text-amber-700 border border-amber-150 px-1 py-0.5 rounded-md font-bold ml-1.5">{charge.charge_type}</span></span>
                                                            <span className="tabular-nums font-semibold">{money(charge.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Add Manual Charge Form / Toggle — sticky so it stays reachable without scrolling past a long billing list */}
                                <div className="sticky bottom-0 z-10 border border-dashed border-hairline-strong rounded-2xl p-4 bg-surface shadow-lg">
                                    {!showAddChargeForm ? (
                                        <div className="flex flex-col sm:flex-row gap-2 md:gap-2.5 items-center justify-center">
                                            <button 
                                                onClick={() => setShowAddChargeForm(true)}
                                                className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-brand-500 font-extrabold hover:text-brand-600 hover:scale-[1.01] transition-all border border-brand-500/10 hover:border-brand-500/30 rounded-xl bg-surface"
                                            >
                                                <Plus size={14} /> Add Manual Purchase (Minibar, Laundry, etc.)
                                            </button>
                                            <button 
                                                onClick={handleOpenFoodOrder}
                                                className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-emerald-600 font-extrabold hover:text-emerald-700 hover:scale-[1.01] transition-all border border-emerald-500/10 hover:border-emerald-500/30 rounded-xl bg-surface"
                                            >
                                                <Utensils size={14} /> Add Food/Restaurant Order
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3.5 animate-in slide-in-from-top duration-200">
                                            <div className="flex items-center justify-between border-b border-hairline pb-2">
                                                <span className="text-xs font-extrabold text-ink-muted">Add purchase detail</span>
                                                <button onClick={() => setShowAddChargeForm(false)} className="text-[10px] text-rose-500 font-bold hover:underline">Cancel</button>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2.5">
                                                <div>
                                                    <label className="block text-[8px] font-bold text-ink-subtle uppercase mb-1">Type</label>
                                                    <Select
                                                        value={newCharge.charge_type}
                                                        onChange={e => setNewCharge(c => ({ ...c, charge_type: e.target.value }))}
                                                        className="w-full px-2.5 py-2 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                                    >
                                                        <option value="minibar">Minibar</option>
                                                        <option value="laundry">Laundry</option>
                                                        <option value="spa">Spa</option>
                                                        <option value="parking">Parking</option>
                                                        <option value="room_service">Room Service</option>
                                                        <option value="other">Other</option>
                                                    </Select>
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="block text-[8px] font-bold text-ink-subtle uppercase mb-1">Description</label>
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. 2 Beers, Ironing Service"
                                                        value={newCharge.description}
                                                        onChange={e => setNewCharge(c => ({ ...c, description: e.target.value }))}
                                                        className="w-full px-2.5 py-2 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex items-end gap-3">
                                                <div className="flex-1">
                                                    <label className="block text-[8px] font-bold text-ink-subtle uppercase mb-1">Amount (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        placeholder="0.00"
                                                        value={newCharge.amount}
                                                        onChange={e => setNewCharge(c => ({ ...c, amount: e.target.value }))}
                                                        className="w-full px-2.5 py-2 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                                    />
                                                </div>
                                                <Button
                                                    variant="secondary"
                                                    loading={isProcessing}
                                                    onClick={handleAddManualCharge}
                                                    className="font-bold shrink-0 text-xs py-2 bg-brand-500 text-white hover:bg-brand-600 hover:border-brand-600"
                                                >
                                                    Add Item
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="py-8 text-center border border-dashed border-hairline-strong rounded-xl">
                                <p className="text-sm text-ink-subtle">No active booking session found.</p>
                            </div>
                        )}
                        </div>

                        {/* Drawer Footer (Checkout and Total Billing) - sticky */}
                        <div className="border-t border-hairline px-6 py-4 flex flex-col gap-2.5 flex-shrink-0 bg-surface">
                            {(() => {
                                const advancePaid = Number(activeBooking?.paid_amount) || 0
                                const balanceDue = Math.max(0, grandTotal - advancePaid)
                                return (
                                    <>
                                        {advancePaid > 0 && (
                                            <div className="flex flex-col gap-1 text-xs border-b border-dashed border-hairline pb-2">
                                                <div className="flex justify-between text-ink-subtle font-semibold">
                                                    <span>Total Bill Amount:</span>
                                                    <span className="tabular-nums">{money(grandTotal)}</span>
                                                </div>
                                                <div className="flex justify-between text-emerald-600 font-bold">
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                        Advance Paid ({advanceMethodLabel(activeBooking?.advance_payment_method)}):
                                                    </span>
                                                    <span className="tabular-nums">- {money(advancePaid)}</span>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <div>
                                                <span className="text-[10px] font-bold text-ink-subtle uppercase">
                                                    {advancePaid > 0 ? 'Balance due at checkout' : 'Total bill amount'}
                                                </span>
                                                <p className="text-2xl font-black text-brand-600 tabular-nums">{money(balanceDue)}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => setSelectedRoom(null)}
                                                    className="px-5 font-bold"
                                                >
                                                    Close
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    icon={CreditCard}
                                                    onClick={() => {
                                                        if (onGoToBilling) onGoToBilling(selectedRoom)
                                                        setSelectedRoom(null)
                                                    }}
                                                    className="px-6 font-bold"
                                                >
                                                    Go to Billing
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                )
                            })()}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {foodOrderModalOpen && (() => {
                const matchingTable = tables.find(t => t.room_id === selectedRoom?.id)
                const resolvedSessionId = matchingTable?.activeSession?.id || createdSessionId
                return (
                    <QuickOrderModal
                        isOpen={foodOrderModalOpen}
                        onClose={() => setFoodOrderModalOpen(false)}
                        sessionId={resolvedSessionId || undefined}
                        tableName={selectedRoom ? `Room ${selectedRoom.room_number}` : undefined}
                        restaurantId={restaurantId}
                        bookingId={activeBooking?.id}
                        onSuccess={(orderId: string) => {
                            setRefreshTrigger(prev => prev + 1)
                            if (onOrderPlaced) onOrderPlaced(orderId)
                        }}
                    />
                )
            })()}
        </div>
    )
}
