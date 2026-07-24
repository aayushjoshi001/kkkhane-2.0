'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Filter, Calendar } from 'lucide-react'
import type { Booking, Room, BookingStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import RoomBillingModal, { type BillingTable, type BillingOrder } from '@/components/admin/RoomBillingModal'
import { useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import Select from '@/components/ui/Select'
import { toNepaliDate } from '@/lib/nepaliDate'
import { formatDateShort } from '@/lib/utils'

interface BookingsClientProps {
    initialBookings: Booking[]
    rooms: Room[]
    restaurantId: string
    restaurantName: string
    tables?: BillingTable[]
    activeOrders?: BillingOrder[]
}

export default function BookingsClient({ initialBookings, restaurantName, tables = [], activeOrders = [] }: BookingsClientProps) {
    const router = useRouter()
    const [bookings, setBookings] = useState<Booking[]>(initialBookings)
    const [filterStatus, setFilterStatus] = useState<string>('all')
    // Booking being settled in the checkout/billing modal
    const [billingBooking, setBillingBooking] = useState<Booking | null>(null)
    const searchParams = useSearchParams()

    // Deep link from the dashboard's recent-bookings row:
    // /admin/bookings?booking=<id> opens that stay's billing detail directly.
    // Once only, so dismissing it does not reopen while the query string stands.
    const deepLinkedId = searchParams.get('booking')
    const consumedDeepLink = useRef(false)
    useEffect(() => {
        if (!deepLinkedId || consumedDeepLink.current) return
        const match = bookings.find((b) => b.id === deepLinkedId)
        if (!match) return
        consumedDeepLink.current = true
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBillingBooking(match)
    }, [deepLinkedId, bookings])

    const irdSyncEnabled = useFeatureEnabled('irdSyncEnabled')
    const bsEnabled = useFeatureEnabled('bsDateEnabled')

    // Re-sync when the server sends fresh bookings (render-phase adjust,
    // see react.dev "You Might Not Need an Effect")
    const [prevInitialBookings, setPrevInitialBookings] = useState(initialBookings)
    if (prevInitialBookings !== initialBookings) {
        setPrevInitialBookings(initialBookings)
        setBookings(initialBookings)
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
            case 'cancelled': return 'bg-surface-muted text-ink-subtle border-hairline'
            default: return 'bg-surface-muted text-ink border-hairline'
        }
    }

    return (
        <div className="space-y-6 pb-12 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-ink tracking-tight">Bookings & Stays</h1>
                    <p className="text-sm text-ink-subtle mt-1">Manage guest check-ins, checkout settlements, and reservations.</p>
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
                                    const checkInDate = new Date(b.check_in)
                                    const checkOutDate = new Date(b.check_out)
                                    const checkInAd = formatDateShort(checkInDate, { withYear: true })
                                    const checkOutAd = formatDateShort(checkOutDate, { withYear: true })
                                    const checkInStr = bsEnabled 
                                        ? `${checkInAd} (${toNepaliDate(checkInDate, 'MMMM DD, YYYY', 'en')} BS)`
                                        : checkInAd
                                    const checkOutStr = bsEnabled
                                        ? `${checkOutAd} (${toNepaliDate(checkOutDate, 'MMMM DD, YYYY', 'en')} BS)`
                                        : checkOutAd
                                    const total = b.total_amount || 0.00
                                    const paid = b.paid_amount || 0.00
                                    const balance = total - paid

                                    return (
                                        <tr key={b.id} className="group hover:bg-surface-muted/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-ink">{b.guest_name}</div>
                                                <div className="text-xs text-ink-subtle font-semibold mt-0.5">{b.guest_phone || 'No phone'}</div>
                                            </td>
                                            <td className="px-6 py-4 font-bold text-ink">
                                                Room {roomNum}
                                            </td>
                                            <td className="px-6 py-4 font-medium text-ink-subtle">
                                                <div>{checkInStr} to</div>
                                                <div className="text-xs text-ink-subtle mt-0.5">{checkOutStr}</div>
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
                                                            onClick={() => setBillingBooking(b)}
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
            {billingBooking?.rooms && (
                <RoomBillingModal
                    room={billingBooking.rooms}
                    booking={billingBooking}
                    tables={tables}
                    activeOrders={activeOrders}
                    restaurantName={restaurantName}
                    onClose={() => setBillingBooking(null)}
                    onSettled={result => {
                        setBookings(prev => prev.map(b =>
                            b.id === result.bookingId
                                ? {
                                    ...b,
                                    status: 'checked_out',
                                    total_amount: result.total,
                                    paid_amount: result.paidAmount,
                                    payment_status: result.paymentStatus
                                }
                                : b
                        ))
                        setBillingBooking(null)
                        // tables/activeOrders are server-fetched props — refresh so a stale,
                        // now-settled session/order doesn't bleed into the next guest booked
                        // into this room (see the identical fix in admin/rooms/RoomsClient.tsx).
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}
