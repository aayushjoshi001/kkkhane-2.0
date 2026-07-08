'use client'

import { useState, useEffect } from 'react'
import { 
    Plus, Filter, Calendar, Phone, Mail, User, ShieldAlert, CreditCard, ChevronRight, RefreshCw,
    X, Loader2, Wallet, Landmark, Receipt, ArrowUpRight, Banknote, PiggyBank, TrendingUp, Percent, BookOpen
} from 'lucide-react'
import type { Booking, Room, BookingStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from 'react-hot-toast'
import { createPortal } from 'react-dom'

interface BookingsClientProps {
    initialBookings: Booking[]
    rooms: Room[]
    restaurantId: string
    tables?: any[]
    activeOrders?: any[]
}

export default function BookingsClient({ initialBookings, rooms, restaurantId, tables = [], activeOrders = [] }: BookingsClientProps) {
    const [bookings, setBookings] = useState<Booking[]>(initialBookings)
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    // States for Checkout/Stay details popup
    const [selectedBillingRoom, setSelectedBillingRoom] = useState<any | null>(null)
    const [billingStayBooking, setBillingStayBooking] = useState<any | null>(null)
    const [billingRoomCharges, setBillingRoomCharges] = useState<any[]>([])
    const [loadingStayDetails, setLoadingStayDetails] = useState(false)
    const [billingPaymentMethod, setBillingPaymentMethod] = useState<'cash' | 'qr_digital' | 'split'>('cash')
    const [splitCashAmount, setSplitCashAmount] = useState('')
    const [splitQrAmount, setSplitQrAmount] = useState('')
    const [isSavingCheckout, setIsSavingCheckout] = useState(false)

    useEffect(() => {
        if (selectedBillingRoom && billingStayBooking) {
            setLoadingStayDetails(true)
            fetch(`/api/rooms/charges?bookingId=${billingStayBooking.id}`)
                .then(r => r.json())
                .then(chargesData => {
                    if (chargesData.success) {
                        setBillingRoomCharges(chargesData.data || [])
                    }
                })
                .catch(err => console.error('Error loading charges:', err))
                .finally(() => setLoadingStayDetails(false))
        }
    }, [selectedBillingRoom, billingStayBooking])

    // Sync bookings if initialBookings updates
    useEffect(() => {
        setBookings(initialBookings)
    }, [initialBookings])

    const money = (amount: number) => {
        return "Rs. " + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

    const calculateStayCost = (room: any, booking: any) => {
        if (!room || !booking) return 0
        const price = room.room_types?.base_price || 0
        const inDate = new Date(booking.check_in)
        const outDate = new Date(booking.check_out)
        const diffMs = outDate.getTime() - inDate.getTime()
        const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
        return price * nights
    }

    const getRoomQrOrders = (room: any) => {
        if (!room) return []
        const matchingTable = tables.find(t => t.label === room.room_number || t.label === 'Room ' + room.room_number)
        if (!matchingTable?.activeSession) return []

        const sessionOrders = activeOrders.filter(o => o.session_id === matchingTable.activeSession.id)
        
        const items: { name: string; quantity: number; unitPrice: number }[] = []
        for (const order of sessionOrders) {
            for (const item of order.order_items || []) {
                items.push({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity,
                    unitPrice: item.unit_price,
                })
            }
        }
        return items
    }

    const calculateGrandTotal = (room: any, booking: any) => {
        const stayCost = calculateStayCost(room, booking)
        const qrOrdersTotal = getRoomQrOrders(room).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
        const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        return stayCost + qrOrdersTotal + manualChargesTotal
    }

    const handleCheckout = async () => {
        if (!selectedBillingRoom || !billingStayBooking) return
        
        setIsSavingCheckout(true)
        try {
            const total = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
            const advancePaid = Number(billingStayBooking.paid_amount) || 0
            const balanceDue = Math.max(0, total - advancePaid)

            const resolvedCash = billingPaymentMethod === 'cash' ? balanceDue
                : billingPaymentMethod === 'qr_digital' ? 0
                : parseFloat(splitCashAmount) || 0
            const resolvedQr = billingPaymentMethod === 'qr_digital' ? balanceDue
                : billingPaymentMethod === 'cash' ? 0
                : parseFloat(splitQrAmount) || 0

            const res = await fetch(`/api/bookings/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: billingStayBooking.id,
                    room_id: selectedBillingRoom.id,
                    total_amount: total,
                    cash_paid: resolvedCash,
                    qr_paid: resolvedQr
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

            // Update local state
            setBookings(prev => prev.map(b =>
                b.id === billingStayBooking.id 
                    ? { 
                        ...b, 
                        status: 'checked_out', 
                        total_amount: total, 
                        paid_amount: (advancePaid + resolvedCash + resolvedQr), 
                        payment_status: (advancePaid + resolvedCash + resolvedQr >= total) ? 'paid' : 'partial' 
                    } 
                    : b
            ))
            
            toast.success('Room billing settled and guest checked out successfully!')
            setSelectedBillingRoom(null)
            setBillingStayBooking(null)
        } catch (err: any) {
            toast.error(err.message || 'Failed to checkout')
        } finally {
            setIsSavingCheckout(false)
        }
    }

    // Filter logic
    const filteredBookings = bookings.filter(b => {
        return filterStatus === 'all' || b.status === filterStatus
    })

    const handleStatusChange = async (bookingId: string, newStatus: BookingStatus) => {
        // Optimistic UI update
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: newStatus } : b))
        
        try {
            const res = await fetch(`/api/bookings/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, status: newStatus })
            })
            if (!res.ok) {
                setBookings(initialBookings)
            }
        } catch {
            setBookings(initialBookings)
        }
    }

    const getStatusColor = (status: BookingStatus) => {
        switch (status) {
            case 'pending': return 'bg-yellow-50 text-yellow-700 border-yellow-100'
            case 'checked_in': return 'bg-blue-50 text-blue-700 border-blue-100'
            case 'checked_out': return 'bg-emerald-50 text-emerald-700 border-emerald-100'
            case 'cancelled': return 'bg-gray-100 text-gray-500 border-gray-200'
            default: return 'bg-gray-50 text-gray-700 border-gray-100'
        }
    }

    const getStatusLabel = (status: BookingStatus) => {
        switch (status) {
            case 'pending': return 'Reservation Pending'
            case 'checked_in': return 'Currently Checked In'
            case 'checked_out': return 'Checked Out / Settled'
            case 'cancelled': return 'Cancelled Stay'
        }
    }

    return (
        <div className="space-y-6 pb-12 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Bookings & Stays</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage guest check-ins, checkout settlements, and reservations.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/10 hover:scale-[1.01]">
                        <Plus size={16} /> New Booking
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 border border-gray-100 rounded-2xl flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-600 px-1">
                        <Filter size={16} /> Filters:
                    </div>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 focus:outline-none focus:border-[#ff5a00] cursor-pointer"
                    >
                        <option value="all">All Bookings</option>
                        <option value="pending">Pending Reservations</option>
                        <option value="checked_in">Checked In</option>
                        <option value="checked_out">Checked Out</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Showing {filteredBookings.length} of {bookings.length} reservations
                </div>
            </div>

            {/* Bookings Table / List */}
            {filteredBookings.length === 0 ? (
                <div className="bg-white rounded-3xl p-16 border border-gray-100 text-center shadow-sm">
                    <EmptyState 
                        icon={Calendar} 
                        title="No bookings found" 
                        description="Bookings created by front desk or through rooms will show up here." 
                    />
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.02)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="text-[12px] uppercase tracking-wider font-semibold text-gray-400 bg-gray-50/50">
                                    <th className="px-6 py-4 border-b border-gray-100">Guest Name</th>
                                    <th className="px-6 py-4 border-b border-gray-100">Room</th>
                                    <th className="px-6 py-4 border-b border-gray-100">Dates</th>
                                    <th className="px-6 py-4 border-b border-gray-100">Status</th>
                                    <th className="px-6 py-4 border-b border-gray-100">Charges</th>
                                    <th className="px-6 py-4 border-b border-gray-100 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 text-[14px]">
                                {filteredBookings.map(b => {
                                    const roomNum = (b.rooms as any)?.room_number || '—'
                                    const checkInStr = new Date(b.check_in).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                                    const checkOutStr = new Date(b.check_out).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                                    const total = b.total_amount || 0.00
                                    const paid = b.paid_amount || 0.00
                                    const balance = total - paid

                                    return (
                                        <tr key={b.id} className="group hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-gray-950">{b.guest_name}</div>
                                                <div className="text-xs text-gray-400 font-semibold mt-0.5">{b.guest_phone || 'No phone'}</div>
                                            </td>
                                            <td className="px-6 py-4 font-bold text-gray-800">
                                                Room {roomNum}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-gray-600">
                                                <div>{checkInStr} to</div>
                                                <div className="text-xs text-gray-400 mt-0.5">{checkOutStr}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(b.status)}`}>
                                                    {b.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 font-semibold tabular">
                                                <div className="text-gray-900 font-black">Rs. {total}</div>
                                                {balance > 0 ? (
                                                    <div className="text-xs text-rose-500 font-bold mt-0.5">Due: Rs. {balance}</div>
                                                ) : (
                                                    <div className="text-xs text-emerald-600 font-bold mt-0.5">Paid</div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {b.status === 'pending' && (
                                                        <button 
                                                            onClick={() => handleStatusChange(b.id, 'checked_in')}
                                                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors"
                                                        >
                                                            Check In
                                                        </button>
                                                    )}
                                                    {b.status === 'checked_in' && (
                                                         <button 
                                                             onClick={() => {
                                                                 setSelectedBillingRoom(b.rooms)
                                                                 setBillingStayBooking(b)
                                                             }}
                                                             className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition-colors"
                                                         >
                                                             Checkout
                                                         </button>
                                                     )}
                                                    {b.status !== 'cancelled' && b.status !== 'checked_out' && (
                                                        <button 
                                                            onClick={() => handleStatusChange(b.id, 'cancelled')}
                                                            className="px-2 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Billing Stay Details modal */}
            {mounted && selectedBillingRoom && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingRoom(null)}
                >
                    <div 
                        className="bg-white w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-gray-150 flex flex-col max-h-[90vh] md:max-h-[85vh] animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-gray-50/50 flex-shrink-0">
                            <div>
                                <h3 className="text-lg font-black text-gray-900">Room {selectedBillingRoom.room_number} stays details</h3>
                                <p className="text-xs text-gray-500 mt-0.5">{selectedBillingRoom.room_types?.name} • Floor {selectedBillingRoom.floor || 'N/A'}</p>
                            </div>
                            <button onClick={() => setSelectedBillingRoom(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition text-gray-500 hover:text-gray-900"><X size={16} /></button>
                        </div>

                        {loadingStayDetails ? (
                            <div className="p-6 flex-1 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-[#ff5a00]" />
                                <p className="text-xs text-gray-500 font-semibold">Loading details...</p>
                            </div>
                        ) : billingStayBooking ? (
                            <>
                                <div className="space-y-6 p-6 overflow-y-auto flex-1">
                                <div className="grid grid-cols-2 gap-4 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 text-xs">
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Guest</p>
                                        <p className="font-extrabold text-gray-900 text-sm">{billingStayBooking.guest_name}</p>
                                        <p className="font-semibold text-gray-600">{billingStayBooking.guest_phone}</p>
                                    </div>
                                    <div className="space-y-1 text-right border-l border-gray-100 pl-4">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Stay schedule</p>
                                        <p className="font-semibold text-gray-600">In: {formatDateTime(billingStayBooking.check_in)}</p>
                                        <p className="font-semibold text-gray-600">Out: {formatDateTime(billingStayBooking.check_out)}</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Stay billing breakdown</h4>
                                    <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-100 bg-white">
                                        <div className="flex justify-between items-center p-4 text-xs">
                                            <div>
                                                <p className="font-extrabold text-gray-900">Room Stay Cost</p>
                                                <p className="text-[10px] text-gray-400">{money(selectedBillingRoom.room_types?.base_price || 0)} / Night</p>
                                            </div>
                                            <span className="font-extrabold text-gray-600 tabular-nums">{money(calculateStayCost(selectedBillingRoom, billingStayBooking))}</span>
                                        </div>

                                        {getRoomQrOrders(selectedBillingRoom).length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-indigo-600">QR Room service orders</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                                                    {getRoomQrOrders(selectedBillingRoom).map((item, idx) => (
                                                        <div key={idx} className="flex justify-between text-[10px] text-gray-600">
                                                            <span>{item.name} ({item.quantity}×)</span>
                                                            <span className="tabular-nums font-semibold">{money(item.unitPrice * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {billingRoomCharges.length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-amber-600">Additional stay charges</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-amber-100">
                                                    {billingRoomCharges.map((c: any) => (
                                                        <div key={c.id} className="flex justify-between text-[10px] text-gray-600">
                                                            <span className="capitalize">{c.description} ({c.charge_type})</span>
                                                            <span className="tabular-nums font-semibold">{money(c.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Payment Method Selector */}
                                <div className="pt-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Payment Method</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            onClick={() => setBillingPaymentMethod('cash')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'cash'
                                                    ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                    : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                                            Cash
                                        </button>
                                        <button
                                            onClick={() => setBillingPaymentMethod('qr_digital')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'qr_digital'
                                                    ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                    : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                                            QR / Digital
                                        </button>
                                        <button
                                            onClick={() => {
                                                setBillingPaymentMethod('split')
                                                setSplitCashAmount('')
                                                setSplitQrAmount('')
                                            }}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'split'
                                                    ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                    : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                                            Both
                                        </button>
                                    </div>

                                    {/* Split amount inputs — shown only when Both is selected */}
                                    {billingPaymentMethod === 'split' && (() => {
                                        const total = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                        const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                        const balanceDue = Math.max(0, total - advancePaid)
                                        return (
                                            <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-gray-50/50 border border-gray-100 rounded-2xl">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Cash Amount</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">Rs.</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={balanceDue}
                                                            placeholder="0.00"
                                                            value={splitCashAmount}
                                                            onChange={e => {
                                                                const v = e.target.value
                                                                setSplitCashAmount(v)
                                                                const cash = parseFloat(v) || 0
                                                                setSplitQrAmount(Math.max(0, balanceDue - cash).toFixed(2))
                                                            }}
                                                            className="w-full pl-7 pr-2 py-2 border border-gray-100 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-[#ff5a00]"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">QR / Digital Amount</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">Rs.</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={balanceDue}
                                                            placeholder="0.00"
                                                            value={splitQrAmount}
                                                            onChange={e => {
                                                                const v = e.target.value
                                                                setSplitQrAmount(v)
                                                                const qr = parseFloat(v) || 0
                                                                setSplitCashAmount(Math.max(0, balanceDue - qr).toFixed(2))
                                                            }}
                                                            className="w-full pl-7 pr-2 py-2 border border-gray-100 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-[#ff5a00]"
                                                        />
                                                    </div>
                                                </div>
                                                {/* Balance check */}
                                                {(() => {
                                                    const cash = parseFloat(splitCashAmount) || 0
                                                    const qr = parseFloat(splitQrAmount) || 0
                                                    const grandTotal = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                                    const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                                    const balanceDue = Math.max(0, grandTotal - advancePaid)
                                                    const diff = Math.abs(cash + qr - balanceDue)
                                                    if (diff > 0.01) return (
                                                        <p className="col-span-2 text-[9px] text-rose-500 font-bold text-center">
                                                            ⚠ Cash + QR must equal {money(balanceDue)} (difference: {money(diff)})
                                                        </p>
                                                    )
                                                    return (
                                                        <p className="col-span-2 text-[9px] text-emerald-600 font-bold text-center">✓ Amounts balanced</p>
                                                    )
                                                })()}
                                            </div>
                                        )
                                    })()}
                                </div>
                            </div>
                            <div className="border-t border-gray-100 px-6 py-4 flex-shrink-0 bg-white">
                                    {/* Gross Total + Advance row */}
                                    {(() => {
                                        const grandTotal = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                        const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                        const balanceDue = Math.max(0, grandTotal - advancePaid)
                                        return (
                                            <>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase">Total bill amount</span>
                                                    <span className="text-sm font-black text-gray-600 tabular-nums">{money(grandTotal)}</span>
                                                </div>
                                                {advancePaid > 0 && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                            Advance Paid ({billingStayBooking?.advance_payment_method === 'qr_digital' ? 'QR/Digital' : 'Cash'})
                                                        </span>
                                                        <span className="text-sm font-black text-emerald-600 tabular-nums">− {money(advancePaid)}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between pt-1 border-t border-dashed border-gray-100">
                                                    <div>
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase">{advancePaid > 0 ? 'Balance Due' : 'Total Due'}</span>
                                                        <p className="text-2xl font-black text-[#ff5a00] tabular-nums">{money(balanceDue)}</p>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button 
                                                            onClick={() => setSelectedBillingRoom(null)}
                                                            className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold hover:bg-gray-50 transition"
                                                        >
                                                            Close
                                                        </button>
                                                        <button 
                                                            onClick={handleCheckout}
                                                            disabled={isSavingCheckout}
                                                            className="px-6 py-2 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-[#ff5a00]/10 disabled:opacity-50 flex items-center gap-1.5"
                                                        >
                                                            {isSavingCheckout ? <Loader2 size={12} className="animate-spin" /> : null}
                                                            Settle & Checkout
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    })()}
                                </div>
                            </>
                        ) : (
                            <div className="p-6 flex-1 flex items-center justify-center">
                                <p className="text-xs text-gray-400">No active stay found for this room.</p>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
