'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Filter, Calendar, ChevronUp, ChevronDown, User, Phone, Bed, CreditCard, ShoppingBag, Loader2 } from 'lucide-react'
import type { Booking, Room, BookingStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import { useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'
import { getItemDisplayName } from '@/lib/utils'

interface BookingsClientProps {
    initialBookings: Booking[]
    rooms: Room[]
    restaurantId: string
    restaurantName: string
    tables?: any[]
    activeOrders?: any[]
}

function BookingHistoryCard({ booking }: { booking: Booking }) {
    const [loading, setLoading] = useState(true)
    const [orderItems, setOrderItems] = useState<any[]>([])

    useEffect(() => {
        let isMounted = true
        async function loadDetails() {
            try {
                setLoading(true)
                const res = await fetch(`/api/bookings/linked-orders?bookingId=${booking.id}&includeAll=true`)
                if (res.ok) {
                    const data = await res.json()
                    if (isMounted) {
                        setOrderItems(data.items || [])
                    }
                }
            } catch (err) {
                console.error('Failed to load linked orders:', err)
            } finally {
                if (isMounted) setLoading(false)
            }
        }
        loadDetails()
        return () => { isMounted = false }
    }, [booking.id])

    // Calculate stay duration
    const checkInDate = booking.check_in ? new Date(booking.check_in) : null
    const checkOutDate = booking.check_out ? new Date(booking.check_out) : null
    const nights = checkInDate && checkOutDate 
        ? Math.max(1, Math.round((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 3600 * 24)))
        : 1

    const rawNightlyRate = (() => {
        // Custom rate is stored as [CUSTOM_RATE:X] in booking.notes
        const notes = (booking as any).notes || ''
        const match = typeof notes === 'string' ? notes.match(/\[CUSTOM_RATE:(\d+(?:\.\d+)?)\]/) : null
        const custom = match ? parseFloat(match[1]) : 0
        return custom > 0 ? custom : Number((booking as any).rooms?.room_types?.base_price || 0)
    })()
    const roomBill = rawNightlyRate > 0 ? rawNightlyRate * nights : Number(booking.total_amount || 0)
    
    // Food & Beverage Bill sum from all linked orders (QR, Waiter, Cashier)
    const foodBill = orderItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * (item.quantity || 1)), 0)

    const isCheckedOut = booking.status === 'checked_out'
    const grandTotal = isCheckedOut ? Number(booking.total_amount || (roomBill + foodBill)) : (roomBill + foodBill)
    const totalPaid = Number(booking.paid_amount || 0)
    const netBalance = isCheckedOut ? 0 : Math.max(0, grandTotal - totalPaid)

    return (
        <div className="p-6 bg-surface-muted/30 border-t border-b border-hairline space-y-6 animate-fade-down">
            {/* Unified Room & Order Detail Bill */}
            <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden divide-y divide-hairline">
                
                {/* Header: Guest & Room Info */}
                <div className="p-5 bg-surface-muted/50 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 font-black text-sm shrink-0">
                            {booking.rooms?.room_number || '—'}
                        </div>
                        <div>
                            <h4 className="font-extrabold text-ink text-base flex items-center gap-2">
                                {booking.guest_name}
                                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface border border-hairline text-ink-subtle">
                                    Room {booking.rooms?.room_number || '—'}
                                </span>
                            </h4>
                            <p className="text-xs text-ink-subtle font-medium mt-0.5">
                                Phone: <strong className="text-ink">{booking.guest_phone || 'N/A'}</strong> · {nights} Night{nights > 1 ? 's' : ''} ({booking.check_in ? new Date(booking.check_in).toLocaleDateString() : '—'} → {booking.check_out ? new Date(booking.check_out).toLocaleDateString() : '—'})
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border bg-brand-50 text-brand-700 border-brand-200">
                            {booking.status}
                        </span>
                    </div>
                </div>

                {/* Financial Summary Breakdown */}
                <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 bg-surface">
                    <div className="p-3.5 rounded-xl bg-surface-muted/40 border border-hairline space-y-1">
                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Room Stay Bill</span>
                        <div className="text-base font-extrabold text-ink tabular-nums">Rs. {roomBill.toFixed(2)}</div>
                        <span className="text-[10px] text-ink-subtle block font-semibold">{nights} night(s) {rawNightlyRate > 0 ? `@ Rs.${rawNightlyRate}/night` : ''}</span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-surface-muted/40 border border-hairline space-y-1">
                        <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Food & Drink Bill</span>
                        <div className="text-base font-extrabold text-ink tabular-nums">Rs. {foodBill.toFixed(2)}</div>
                        <span className="text-[10px] text-ink-subtle block font-semibold">{orderItems.length} ordered dish item(s)</span>
                    </div>

                    <div className="p-3.5 rounded-xl bg-emerald-50/50 border border-emerald-100 space-y-1">
                        <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                            {isCheckedOut ? 'Total Settled Payment' : 'Advance Payment Received'}
                        </span>
                        <div className="text-base font-extrabold text-emerald-700 tabular-nums">Rs. {totalPaid.toFixed(2)}</div>
                        <span className="text-[10px] text-emerald-600 block font-semibold">
                            {isCheckedOut ? 'Paid at Checkout' : 'Advance Deposit'}
                        </span>
                    </div>

                    <div className={`p-3.5 rounded-xl border space-y-1 ${netBalance > 0 ? 'bg-rose-50/50 border-rose-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Net Balance Due</span>
                        <div className={`text-base font-black tabular-nums ${netBalance > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            Rs. {netBalance.toFixed(2)}
                        </div>
                        <span className="text-[10px] font-semibold block text-ink-subtle">
                            {isCheckedOut ? 'Fully Settled & Checked Out' : (netBalance > 0 ? 'Pending at Checkout' : 'Fully Paid')}
                        </span>
                    </div>
                </div>

                {/* Itemized Food & Drink Orders (QR, Waiter, Cashier) */}
                <div className="p-5 space-y-3">
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-ink-subtle flex items-center gap-2">
                        <ShoppingBag size={14} className="text-brand-500" /> Itemized Room Food & Drink Orders ({orderItems.length})
                    </h5>

                    {loading ? (
                        <div className="flex items-center justify-center py-6 text-xs text-ink-subtle gap-2">
                            <Loader2 size={16} className="animate-spin text-brand-500" /> Loading food/drink order details...
                        </div>
                    ) : orderItems.length === 0 ? (
                        <div className="p-4 text-center border border-dashed border-hairline rounded-xl text-xs text-ink-subtle">
                            No food/drink items ordered for this stay.
                        </div>
                    ) : (
                        <div className="border border-hairline rounded-xl overflow-hidden divide-y divide-hairline bg-surface">
                            <div className="grid grid-cols-12 px-4 py-2 bg-surface-muted/60 text-[11px] font-extrabold text-ink-subtle uppercase tracking-wider">
                                <span className="col-span-5">Dish / Item Name</span>
                                <span className="col-span-2 text-center">Qty</span>
                                <span className="col-span-2 text-right">Unit Price</span>
                                <span className="col-span-3 text-right">Total Price</span>
                            </div>
                            {orderItems.map((item, itemIdx) => {
                                const name = getItemDisplayName(item)
                                const qty = item.quantity || 1
                                const price = Number(item.unit_price || 0)
                                const subtotal = qty * price
                                const orderRef = item.order_id ? `#${item.order_id.slice(0, 5).toUpperCase()}` : ''
                                return (
                                    <div key={item.id || itemIdx} className="grid grid-cols-12 px-4 py-2.5 text-xs items-center hover:bg-surface-muted/30">
                                        <div className="col-span-5 font-bold text-ink truncate pr-2">
                                            {name}
                                            {orderRef && <span className="text-[10px] font-normal text-ink-subtle ml-2">{orderRef}</span>}
                                            {item.is_room_order && <span className="text-[9px] font-extrabold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded ml-1">Room QR</span>}
                                        </div>
                                        <div className="col-span-2 text-center font-extrabold text-brand-600">
                                            {qty}×
                                        </div>
                                        <div className="col-span-2 text-right font-medium text-ink-subtle tabular-nums">
                                            Rs. {price.toFixed(2)}
                                        </div>
                                        <div className="col-span-3 text-right font-extrabold text-ink tabular-nums">
                                            Rs. {subtotal.toFixed(2)}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    )
}

export default function BookingsClient({ initialBookings, restaurantName, rooms }: BookingsClientProps) {
    const router = useRouter()
    const [bookings, setBookings] = useState<Booking[]>(initialBookings)
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null)
    const searchParams = useSearchParams()

    const deepLinkedId = searchParams.get('booking')
    const consumedDeepLink = useRef(false)
    useEffect(() => {
        if (!deepLinkedId || consumedDeepLink.current) return
        const match = bookings.find((b) => b.id === deepLinkedId)
        if (!match) return
        consumedDeepLink.current = true
        setExpandedBookingId(match.id)
    }, [deepLinkedId, bookings])

    const irdSyncEnabled = useFeatureEnabled('irdSyncEnabled')

    const [prevInitialBookings, setPrevInitialBookings] = useState(initialBookings)
    if (prevInitialBookings !== initialBookings) {
        setPrevInitialBookings(initialBookings)
        setBookings(initialBookings)
    }

    const filteredBookings = bookings.filter(b => {
        return filterStatus === 'all' || b.status === filterStatus
    })

    const handleStatusChange = async (bookingId: string, newStatus: BookingStatus) => {
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
            case 'cancelled': return 'bg-surface-muted text-ink-subtle border-hairline'
            default: return 'bg-surface-muted text-ink border-hairline'
        }
    }

    return (
        <div className="space-y-6 pb-12 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-ink tracking-tight">Bookings & Stays History</h1>
                    <p className="text-sm text-ink-subtle mt-1">Guest reservation record and room order history chart.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/10 hover:scale-[1.01]">
                        <Plus size={16} /> New Booking
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-surface p-4 border border-hairline rounded-[var(--r-lg)] flex flex-wrap items-center justify-between gap-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink-subtle px-1">
                        <Filter size={16} /> Filters:
                    </div>
                    <Select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-3.5 py-2 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-semibold text-ink focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 cursor-pointer transition-all"
                    >
                        <option value="all">All Bookings</option>
                        <option value="pending">Pending Reservations</option>
                        <option value="checked_in">Checked In</option>
                        <option value="checked_out">Checked Out</option>
                        <option value="cancelled">Cancelled</option>
                    </Select>
                </div>
                <div className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                    Showing {filteredBookings.length} of {bookings.length} reservations
                </div>
            </div>

            {/* Bookings Table / List */}
            {filteredBookings.length === 0 ? (
                <div className="bg-surface rounded-[var(--r-lg)] p-16 border border-hairline text-center shadow-sm">
                    <EmptyState 
                        icon={Calendar} 
                        title="No bookings found" 
                        description="Bookings created by front desk or through rooms will show up here." 
                    />
                </div>
            ) : (
                <div className="bg-surface rounded-2xl border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.02)] overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="text-[12px] uppercase tracking-wider font-semibold text-ink-subtle bg-surface-muted/50">
                                    <th className="px-6 py-4 border-b border-hairline">Guest Name</th>
                                    <th className="px-6 py-4 border-b border-hairline">Room</th>
                                    <th className="px-6 py-4 border-b border-hairline">Dates</th>
                                    <th className="px-6 py-4 border-b border-hairline">Status</th>
                                    {irdSyncEnabled && (
                                        <th className="px-6 py-4 border-b border-hairline">Charges</th>
                                    )}
                                    <th className="px-6 py-4 border-b border-hairline text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline text-[14px]">
                                {filteredBookings.map(b => {
                                    const roomNum = b.rooms?.room_number || '—'
                                    const total = b.total_amount || 0.00
                                    const paid = b.paid_amount || 0.00
                                    const balance = total - paid
                                    const isExpanded = expandedBookingId === b.id

                                    return (
                                        <React.Fragment key={b.id}>
                                            <tr 
                                                onClick={() => setExpandedBookingId(prev => prev === b.id ? null : b.id)}
                                                className={`group hover:bg-surface-muted/60 transition-colors cursor-pointer ${isExpanded ? 'bg-surface-muted/40' : ''}`}
                                            >
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-ink hover:text-brand-600 transition-colors flex items-center gap-2">
                                                        {b.guest_name}
                                                        {isExpanded ? <ChevronUp size={14} className="text-brand-500" /> : <ChevronDown size={14} className="text-ink-subtle" />}
                                                    </div>
                                                    <div className="text-xs text-ink-subtle font-semibold mt-0.5">{b.guest_phone || 'No phone'}</div>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-ink">
                                                    Room {roomNum}
                                                </td>
                                                <td className="px-6 py-4 font-medium text-ink-subtle">
                                                    <div className="flex items-start gap-1.5">
                                                        <DateCell value={b.check_in} />
                                                        <span className="text-ink-subtle text-xs pt-0.5">→</span>
                                                        <DateCell value={b.check_out} />
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(b.status)}`}>
                                                        {b.status}
                                                    </span>
                                                </td>
                                                {irdSyncEnabled && (
                                                    <td className="px-6 py-4 font-semibold tabular">
                                                        <div className="text-ink font-black">Rs. {total}</div>
                                                        {balance > 0 ? (
                                                            <div className="text-xs text-rose-500 font-bold mt-0.5">Due: Rs. {balance}</div>
                                                        ) : (
                                                            <div className="text-xs text-emerald-600 font-bold mt-0.5">Paid</div>
                                                        )}
                                                    </td>
                                                )}
                                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setExpandedBookingId(prev => prev === b.id ? null : b.id)
                                                            }}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                                                isExpanded ? 'bg-brand-500 text-white' : 'bg-surface-muted hover:bg-surface-muted/80 text-ink-muted'
                                                            }`}
                                                        >
                                                            {isExpanded ? 'Hide Details' : 'View History'}
                                                        </button>
                                                        {b.status === 'pending' && (
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleStatusChange(b.id, 'checked_in')
                                                                }}
                                                                className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors"
                                                            >
                                                                Check In
                                                            </button>
                                                        )}
                                                        {b.status !== 'cancelled' && b.status !== 'checked_out' && (
                                                            <button 
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleStatusChange(b.id, 'cancelled')
                                                                }}
                                                                className="px-2 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr key={`${b.id}-expanded`}>
                                                    <td colSpan={irdSyncEnabled ? 6 : 5} className="p-0">
                                                        <BookingHistoryCard booking={b} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    )
}
