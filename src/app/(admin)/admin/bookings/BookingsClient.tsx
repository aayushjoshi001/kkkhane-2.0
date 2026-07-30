'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter, Calendar, ChevronUp, ChevronDown, ShoppingBag, Loader2, AlertTriangle, RotateCcw, X, LogIn, LogOut, Percent, Landmark, Banknote, QrCode, CreditCard } from 'lucide-react'
import type { Booking, Room, BookingStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import { useDates } from '@/lib/contexts/CalendarContext'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
import { getItemDisplayName } from '@/lib/utils'

interface BookingSummary {
    checked_in_at: string | null
    checked_in_by: string | null
    checked_out_at: string | null
    checked_out_by: string | null
    room_discount_amount: number
    room_discount_reason: string | null
    food_discount_amount: number
    service_charge_amount: number
    cash_advance: number
    cash_settlement: number
    qr_advance: number
    qr_settlement: number
    credit_settlement: number
}

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
    const [summary, setSummary] = useState<BookingSummary | null>(null)
    const { formatDateTime } = useDates()

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
                        setSummary(data.booking || null)
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

    const rawNightlyRate = Number((booking as any).room_rate || (booking as any).rooms?.room_types?.base_price || 0)
    const roomBill = rawNightlyRate > 0 ? rawNightlyRate * nights : Number(booking.total_amount || 0)

    // Food & Beverage Bill sum from all linked orders (QR, Waiter, Cashier)
    const foodBill = orderItems.reduce((sum, item) => sum + (Number(item.unit_price || 0) * (item.quantity || 1)), 0)

    // Subtotal is the raw room + food charge, before any discount is taken off
    // or service charge added on top.
    const subtotal = roomBill + foodBill
    const isCheckedOut = booking.status === 'checked_out'
    // Once checked out, booking.total_amount is the authoritative figure the
    // checkout route computed (discount subtracted, service charge + tax
    // added). Still in house, this is only an estimate from what's known so far.
    const totalDiscount = (summary?.room_discount_amount ?? 0) + (summary?.food_discount_amount ?? 0)
    const grandTotal = isCheckedOut
        ? Number(booking.total_amount || subtotal)
        : Math.max(0, subtotal - totalDiscount + (summary?.service_charge_amount ?? 0))
    const totalPaid = Number(booking.paid_amount || 0)
    const netBalance = isCheckedOut ? 0 : Math.max(0, grandTotal - totalPaid)
    // Advance collected beyond the running bill — Math.max above floors this
    // to 0 in netBalance itself, so it has to be tracked separately or an
    // overpayment silently reads identically to an exact "Fully Paid".
    const overpaid = isCheckedOut ? 0 : Math.max(0, totalPaid - grandTotal)

    return (
        <div className="p-6 bg-brand-50/30 border-t-2 border-b-2 border-brand-200 space-y-6 animate-fade-down">
            {/* Unified Room & Order Detail Bill */}
            <div className="bg-surface rounded-2xl border-2 border-brand-200/70 shadow-lg overflow-hidden divide-y divide-hairline">
                
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
                <div className="p-3.5 grid grid-cols-3 md:grid-cols-5 gap-2 bg-surface">
                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline space-y-0.5">
                        <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider block truncate">Room Bill</span>
                        <div className="text-xs font-extrabold text-ink tabular-nums">Rs. {roomBill.toFixed(2)}</div>
                        <span className="text-[9px] text-ink-subtle block font-semibold truncate">{nights}n {rawNightlyRate > 0 ? `@ Rs.${rawNightlyRate}` : ''}</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline space-y-0.5">
                        <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider block truncate">Food & Drink</span>
                        <div className="text-xs font-extrabold text-ink tabular-nums">Rs. {foodBill.toFixed(2)}</div>
                        <span className="text-[9px] text-ink-subtle block font-semibold truncate">{orderItems.length} item(s)</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline space-y-0.5">
                        <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider block truncate">Subtotal</span>
                        <div className="text-xs font-extrabold text-ink tabular-nums">Rs. {subtotal.toFixed(2)}</div>
                        <span className="text-[9px] text-ink-subtle block font-semibold truncate">Room + Food</span>
                    </div>

                    <div className="p-2 rounded-lg bg-brand-50/60 border border-brand-100 space-y-0.5">
                        <span className="text-[9px] font-bold text-brand-700 uppercase tracking-wider block truncate">Grand Total</span>
                        <div className="text-xs font-black text-brand-700 tabular-nums">Rs. {grandTotal.toFixed(2)}</div>
                        <span className="text-[9px] text-brand-600 block font-semibold truncate">After disc. + charge</span>
                    </div>

                    {(() => {
                        const creditOutstanding = summary?.credit_settlement ?? 0
                        // "Settled" alone would read as "nothing owed" right next to
                        // the Credit box saying the opposite — this booking is closed
                        // either way, but a credit portion is still real, uncollected
                        // money on the Customers Ledger, not on this booking.
                        const stillOnCredit = isCheckedOut && creditOutstanding > 0
                        const isOverpaid = !isCheckedOut && netBalance === 0 && overpaid > 0
                        return (
                            <div className={`p-2 rounded-lg border space-y-0.5 ${netBalance > 0 ? 'bg-rose-50/50 border-rose-100' : stillOnCredit ? 'bg-amber-50/50 border-amber-100' : isOverpaid ? 'bg-blue-50/50 border-blue-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-ink-subtle block truncate">Net Due</span>
                                <div className={`text-xs font-black tabular-nums ${netBalance > 0 ? 'text-rose-600' : stillOnCredit ? 'text-amber-700' : isOverpaid ? 'text-blue-700' : 'text-emerald-700'}`}>
                                    Rs. {netBalance.toFixed(2)}
                                </div>
                                <span className="text-[9px] font-semibold block text-ink-subtle truncate">
                                    {isCheckedOut
                                        ? (stillOnCredit ? `Settled — Rs. ${creditOutstanding.toFixed(2)} on credit` : 'Settled')
                                        : (netBalance > 0 ? 'Pending' : isOverpaid ? `Rs. ${overpaid.toFixed(2)} credit balance (overpaid)` : 'Fully Paid')}
                                </span>
                            </div>
                        )
                    })()}
                </div>

                {/* Check-In / Check-Out Attribution — automatic, never hand-typed.
                    checked_in_by/at and checked_out_by(cashier_id)/at are stamped
                    server-side the moment the status actually changes. */}
                <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-surface">
                    <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                            <LogIn size={12} />
                        </div>
                        <div className="min-w-0">
                            <span className="text-[9px] font-bold text-blue-800 uppercase tracking-wider block">Checked In — Cashier</span>
                            {loading ? (
                                <div className="text-[11px] text-ink-subtle font-semibold">Loading...</div>
                            ) : (
                                <div className="flex items-baseline gap-1.5 truncate">
                                    <span className="text-xs font-extrabold text-ink truncate">{summary?.checked_in_by || 'Unknown'}</span>
                                    <span className="text-[9px] text-ink-subtle font-semibold whitespace-nowrap">
                                        {summary?.checked_in_at ? formatDateTime(summary.checked_in_at) : 'not yet'}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-surface-muted text-ink-subtle flex items-center justify-center shrink-0">
                            <LogOut size={12} />
                        </div>
                        <div className="min-w-0">
                            <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider block">Checked Out — Cashier</span>
                            {loading ? (
                                <div className="text-[11px] text-ink-subtle font-semibold">Loading...</div>
                            ) : summary?.checked_out_at ? (
                                <div className="flex items-baseline gap-1.5 truncate">
                                    <span className="text-xs font-extrabold text-ink truncate">{summary.checked_out_by || 'Unknown'}</span>
                                    <span className="text-[9px] text-ink-subtle font-semibold whitespace-nowrap">{formatDateTime(summary.checked_out_at)}</span>
                                </div>
                            ) : (
                                <span className="text-[11px] text-ink-subtle font-semibold">Still in house</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Payment & Charges Breakdown */}
                <div className="p-3.5 grid grid-cols-2 md:grid-cols-5 gap-2 bg-surface">
                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline space-y-0.5">
                        <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider flex items-center gap-1 truncate">
                            <Percent size={10} /> Discount — Rs. {totalDiscount.toFixed(2)}
                        </span>
                        <div className="flex items-center justify-between text-[10px] font-bold text-ink">
                            <span className="text-ink-subtle">Room</span>
                            <span className="tabular-nums">Rs. {(summary?.room_discount_amount ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-bold text-ink">
                            <span className="text-ink-subtle">Food</span>
                            <span className="tabular-nums">Rs. {(summary?.food_discount_amount ?? 0).toFixed(2)}</span>
                        </div>
                        <span className="text-[9px] text-ink-subtle block font-semibold truncate">{summary?.room_discount_reason || 'No room discount reason'}</span>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline space-y-0.5">
                        <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider flex items-center gap-1 truncate">
                            <Landmark size={10} /> Service Charge
                        </span>
                        <div className="text-xs font-extrabold text-ink tabular-nums">Rs. {(summary?.service_charge_amount ?? 0).toFixed(2)}</div>
                        <span className="text-[9px] text-ink-subtle block font-semibold truncate">Charged on stay</span>
                    </div>

                    <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-100 space-y-0.5">
                        <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1 truncate">
                            <Banknote size={10} /> Cash — Rs. {((summary?.cash_advance ?? 0) + (summary?.cash_settlement ?? 0)).toFixed(2)}
                        </span>
                        <div className="flex items-center justify-between text-[10px] font-bold text-emerald-800">
                            <span className="text-emerald-600">Advance</span>
                            <span className="tabular-nums">Rs. {(summary?.cash_advance ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-bold text-emerald-800">
                            <span className="text-emerald-600">Checkout</span>
                            <span className="tabular-nums">Rs. {(summary?.cash_settlement ?? 0).toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-100 space-y-0.5">
                        <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1 truncate">
                            <QrCode size={10} /> QR — Rs. {((summary?.qr_advance ?? 0) + (summary?.qr_settlement ?? 0)).toFixed(2)}
                        </span>
                        <div className="flex items-center justify-between text-[10px] font-bold text-emerald-800">
                            <span className="text-emerald-600">Advance</span>
                            <span className="tabular-nums">Rs. {(summary?.qr_advance ?? 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-bold text-emerald-800">
                            <span className="text-emerald-600">Checkout</span>
                            <span className="tabular-nums">Rs. {(summary?.qr_settlement ?? 0).toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-100 space-y-0.5">
                        <span className="text-[9px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1 truncate">
                            <CreditCard size={10} /> Credit
                        </span>
                        <div className="text-xs font-extrabold text-amber-700 tabular-nums">Rs. {(summary?.credit_settlement ?? 0).toFixed(2)}</div>
                        <span className="text-[9px] text-amber-600 block font-semibold truncate">Put on guest&apos;s account</span>
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
    const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
    const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null)
    const searchParams = useSearchParams()

    // Cancel confirmation dialog state
    const [cancelTarget, setCancelTarget] = useState<Booking | null>(null)
    const [cancelInput, setCancelInput] = useState('')
    const [cancelLoading, setCancelLoading] = useState(false)
    const [cancelError, setCancelError] = useState<string | null>(null)

    // Restore confirmation dialog state
    const [restoreTarget, setRestoreTarget] = useState<Booking | null>(null)
    const [restoreLoading, setRestoreLoading] = useState(false)

    const deepLinkedId = searchParams.get('booking')
    const consumedDeepLink = useRef(false)
    useEffect(() => {
        if (!deepLinkedId || consumedDeepLink.current) return
        const match = bookings.find((b) => b.id === deepLinkedId)
        if (!match) return
        consumedDeepLink.current = true
        setExpandedBookingId(match.id)
    }, [deepLinkedId, bookings])

    const [prevInitialBookings, setPrevInitialBookings] = useState(initialBookings)
    if (prevInitialBookings !== initialBookings) {
        setPrevInitialBookings(initialBookings)
        setBookings(initialBookings)
    }

    const filteredBookings = bookings.filter(b => {
        if (filterStatus !== 'all' && b.status !== filterStatus) return false
        // A stay is "in" the range if it overlaps it at all, not just if it
        // starts inside it — a guest who checked in before `from` and is
        // still checked out after it slept through every one of these
        // nights and belongs in the list.
        if (dateRange.from && b.check_out && b.check_out.slice(0, 10) < dateRange.from) return false
        if (dateRange.to && b.check_in && b.check_in.slice(0, 10) > dateRange.to) return false
        return true
    })

    // Internal status change — used for check-in and restore
    const applyStatusChange = async (bookingId: string, newStatus: BookingStatus, force = false) => {
        setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: newStatus } : b))
        try {
            const res = await fetch(`/api/bookings/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, status: newStatus, force })
            })
            if (!res.ok) {
                setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: b.status } : b))
                return false
            }
            return true
        } catch {
            setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: b.status } : b))
            return false
        }
    }

    // Open cancel dialog — checks if guest is checked in
    const openCancelDialog = (booking: Booking) => {
        setCancelTarget(booking)
        setCancelInput('')
        setCancelError(null)
    }

    // Confirm cancellation
    const confirmCancel = async () => {
        if (!cancelTarget) return
        const isCheckedIn = cancelTarget.status === 'checked_in'
        if (isCheckedIn && cancelInput.trim() !== 'CANCEL') return
        setCancelLoading(true)
        setCancelError(null)
        try {
            const res = await fetch(`/api/bookings/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: cancelTarget.id, status: 'cancelled', force: true })
            })
            if (res.ok) {
                setBookings(prev => prev.map(b => b.id === cancelTarget.id ? { ...b, status: 'cancelled' } : b))
                setCancelTarget(null)
            } else {
                const data = await res.json()
                setCancelError(data.error || 'Failed to cancel booking.')
            }
        } catch {
            setCancelError('Network error. Please try again.')
        } finally {
            setCancelLoading(false)
        }
    }

    // Confirm restore (cancelled → pending)
    const confirmRestore = async () => {
        if (!restoreTarget) return
        setRestoreLoading(true)
        const ok = await applyStatusChange(restoreTarget.id, 'pending')
        if (ok) {
            setRestoreTarget(null)
        }
        setRestoreLoading(false)
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
            <div>
                <h1 className="text-3xl font-extrabold text-ink tracking-tight">Bookings & Stays History</h1>
                <p className="text-sm text-ink-subtle mt-1">Guest reservation record and room order history chart.</p>
            </div>

            {/* Filters */}
            <div className="bg-surface p-4 border border-hairline rounded-[var(--r-lg)] shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
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
                <div className="pt-3 border-t border-hairline">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ink-subtle px-1 mb-2">
                        <Calendar size={16} /> Stay Date Range:
                    </div>
                    <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={setDateRange} className="max-w-xl" />
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
                                    <th className="px-6 py-4 border-b border-hairline text-right">Actions</th>
                                </tr>
                            </thead>
                            {/* No blanket divide-y here — the border between a row and its
                                own expanded panel is suppressed below so the two read as one
                                attached block instead of two separate table rows. */}
                            <tbody className="text-[14px]">
                                {filteredBookings.map(b => {
                                    const roomNum = b.rooms?.room_number || '—'
                                    const isExpanded = expandedBookingId === b.id

                                    return (
                                        <React.Fragment key={b.id}>
                                            <tr
                                                onClick={() => setExpandedBookingId(prev => prev === b.id ? null : b.id)}
                                                className={`group hover:bg-surface-muted/60 transition-colors cursor-pointer ${
                                                    isExpanded
                                                        ? 'bg-brand-50/60 border-l-4 border-l-brand-500'
                                                        : 'border-b border-hairline'
                                                }`}
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
                                                                    applyStatusChange(b.id, 'checked_in')
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
                                                                    openCancelDialog(b)
                                                                }}
                                                                className="px-2 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg text-xs font-semibold transition-colors"
                                                            >
                                                                Cancel
                                                            </button>
                                                        )}
                                                        {b.status === 'cancelled' && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setRestoreTarget(b)
                                                                }}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold transition-colors border border-emerald-200"
                                                            >
                                                                <RotateCcw size={12} />
                                                                Restore
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr key={`${b.id}-expanded`} className="border-l-4 border-l-brand-500">
                                                    <td colSpan={5} className="p-0">
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

            {/* ─── Cancel Confirmation Modal ─── */}
            {cancelTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setCancelTarget(null)}>
                    <div
                        className="bg-surface rounded-2xl shadow-2xl border border-hairline w-full max-w-md p-6 space-y-5 animate-fade-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                    cancelTarget.status === 'checked_in'
                                        ? 'bg-rose-100 text-rose-600'
                                        : 'bg-amber-50 text-amber-600'
                                }`}>
                                    <AlertTriangle size={20} />
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-ink text-base">Cancel Booking</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">{cancelTarget.guest_name} · Room {cancelTarget.rooms?.room_number || '—'}</p>
                                </div>
                            </div>
                            <button onClick={() => setCancelTarget(null)} className="text-ink-subtle hover:text-ink p-1 rounded-lg hover:bg-surface-muted transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        {/* Warning for checked-in guests */}
                        {cancelTarget.status === 'checked_in' ? (
                            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                                <p className="text-sm font-extrabold text-rose-700 flex items-center gap-2">
                                    <AlertTriangle size={14} /> This guest is currently CHECKED IN!
                                </p>
                                <p className="text-xs text-rose-600">
                                    Cancelling will remove them from the cashier panel and release the room. Their food orders and billing history will remain but the stay will show Rs. 0.
                                </p>
                                <p className="text-xs font-bold text-rose-700 mt-3">Type <span className="font-black bg-rose-100 px-1.5 py-0.5 rounded">CANCEL</span> below to confirm:</p>
                                <input
                                    type="text"
                                    value={cancelInput}
                                    onChange={(e) => setCancelInput(e.target.value)}
                                    placeholder="Type CANCEL to confirm"
                                    className="w-full mt-1 px-3 py-2 bg-surface border border-rose-300 rounded-lg text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
                                    autoFocus
                                />
                            </div>
                        ) : (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-sm text-amber-800">
                                    Are you sure you want to cancel this <strong>{cancelTarget.status}</strong> booking for <strong>{cancelTarget.guest_name}</strong>? This action can be undone using the Restore button.
                                </p>
                            </div>
                        )}

                        {cancelError && (
                            <p className="text-xs text-rose-600 font-semibold">{cancelError}</p>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={() => setCancelTarget(null)}
                                className="flex-1 px-4 py-2.5 bg-surface-muted hover:bg-surface-muted/80 text-ink font-semibold rounded-xl text-sm transition-colors border border-hairline"
                            >
                                Keep Booking
                            </button>
                            <button
                                onClick={confirmCancel}
                                disabled={cancelLoading || (cancelTarget.status === 'checked_in' && cancelInput.trim() !== 'CANCEL')}
                                className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {cancelLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                                Cancel Booking
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Restore Confirmation Modal ─── */}
            {restoreTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setRestoreTarget(null)}>
                    <div
                        className="bg-surface rounded-2xl shadow-2xl border border-hairline w-full max-w-md p-6 space-y-5 animate-fade-up"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                    <RotateCcw size={20} />
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-ink text-base">Restore Booking</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">{restoreTarget.guest_name} · Room {restoreTarget.rooms?.room_number || '—'}</p>
                                </div>
                            </div>
                            <button onClick={() => setRestoreTarget(null)} className="text-ink-subtle hover:text-ink p-1 rounded-lg hover:bg-surface-muted transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                            <p className="text-sm text-emerald-800">
                                Restore <strong>{restoreTarget.guest_name}</strong>'s booking? The booking will return to <strong>Pending</strong> status and the room will be marked as occupied again. You can then manually re-check them in.
                            </p>
                        </div>

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={() => setRestoreTarget(null)}
                                className="flex-1 px-4 py-2.5 bg-surface-muted hover:bg-surface-muted/80 text-ink font-semibold rounded-xl text-sm transition-colors border border-hairline"
                            >
                                Never mind
                            </button>
                            <button
                                onClick={confirmRestore}
                                disabled={restoreLoading}
                                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                                {restoreLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                Restore Booking
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
