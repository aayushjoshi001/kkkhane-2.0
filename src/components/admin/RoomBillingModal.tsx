'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Booking, Room } from '@/types/database'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { formatDateTime, calculateNights } from '@/lib/utils'

/** Table shape the admin room pages pass in (with its active QR session, if any). */
export interface BillingTable {
    id: string
    label: string
    /** Set when this table is a room's in-room QR (see tables.room_id). */
    room_id?: string | null
    activeSession?: { id: string } | null
}

export interface BillingOrderItem {
    id: string
    quantity: number
    unit_price: number
    menu_items?: { name: string } | null
}

/** Active order shape the admin room pages pass in. */
export interface BillingOrder {
    id: string
    session_id: string | null
    order_items?: BillingOrderItem[]
}

interface RoomCharge {
    id: string
    description: string
    charge_type: string
    amount: number
}

export interface SettlementResult {
    bookingId: string
    roomId: string
    total: number
    paidAmount: number
    paymentStatus: 'paid' | 'partial'
}

interface RoomBillingModalProps {
    room: Room
    booking: Booking | null
    tables: BillingTable[]
    activeOrders: BillingOrder[]
    onClose: () => void
    /** Called after the server confirms the checkout so the caller can update its local state. */
    onSettled: (result: SettlementResult) => void
}

const money = (amount: number) =>
    'Rs. ' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const calculateStayCost = (room: Room, booking: Booking) => {
    const price = room.room_types?.base_price || 0
    const nights = calculateNights(booking.check_in, booking.check_out)
    return price * nights
}

/**
 * Checkout & settlement modal for a room stay: room cost + QR room-service
 * orders + manual charges, settled by cash / QR / split payment. Owns the
 * charges fetch and the call to /api/bookings/checkout; callers only react
 * to onSettled/onClose. Shared by the admin Bookings and Rooms pages.
 */
export default function RoomBillingModal({ room, booking, tables, activeOrders, onClose, onSettled }: RoomBillingModalProps) {
    // true after hydration (portals can't render during SSR)
    const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
    const [charges, setCharges] = useState<RoomCharge[]>([])
    // Loading is derived: we're loading until charges have arrived for this booking
    const [chargesLoadedFor, setChargesLoadedFor] = useState<string | null>(null)
    const loadingDetails = booking ? chargesLoadedFor !== booking.id : false
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr_digital' | 'split'>('cash')
    const [splitCashAmount, setSplitCashAmount] = useState('')
    const [splitQrAmount, setSplitQrAmount] = useState('')
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        if (!booking) return
        let cancelled = false
        fetch(`/api/rooms/charges?bookingId=${booking.id}`)
            .then(r => r.json())
            .then(chargesData => {
                if (!cancelled && chargesData.success) {
                    setCharges(chargesData.data || [])
                }
            })
            .catch(err => console.error('Error loading charges:', err))
            .finally(() => { if (!cancelled) setChargesLoadedFor(booking.id) })
        return () => { cancelled = true }
    }, [booking])

    // Rooms are joined to QR ordering by key: tables.room_id points at the room
    // this table is the in-room QR for (migration 20260709140000).
    const matchingTable = tables.find(t => t.room_id === room.id)
    const sessionId = matchingTable?.activeSession?.id ?? null

    // Orders from the room's own QR session
    const qrOrderItems: BillingOrderItem[] = sessionId
        ? activeOrders.filter(o => o.session_id === sessionId).flatMap(o => o.order_items || [])
        : []

    // Also fetch orders from dining sessions linked via booking_id
    // (e.g. hotel guest ordered from restaurant tables via waiter panel)
    const [linkedDiningOrders, setLinkedDiningOrders] = useState<BillingOrderItem[]>([])
    useEffect(() => {
        if (!booking) return
        let cancelled = false
        fetch(`/api/bookings/linked-orders?bookingId=${booking.id}`)
            .then(r => r.json())
            .then(data => {
                if (!cancelled && data.success) {
                    setLinkedDiningOrders(data.items || [])
                }
            })
            .catch(err => console.error('Error loading linked dining orders:', err))
        return () => { cancelled = true }
    }, [booking])

    // The room's own QR session carries booking_id, so its orders arrive in BOTH
    // qrOrderItems (by session) and linkedDiningOrders (by booking) — dedupe by
    // order-item id so the displayed total matches what the server bills.
    const allServiceOrderItems = Array.from(
        new Map([...qrOrderItems, ...linkedDiningOrders].map(it => [it.id, it])).values()
    )
    const stayCost = booking ? calculateStayCost(room, booking) : 0
    const qrOrdersTotal = allServiceOrderItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
    const manualChargesTotal = charges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
    const grandTotal = stayCost + qrOrdersTotal + manualChargesTotal
    const advancePaid = Number(booking?.paid_amount) || 0
    const balanceDue = Math.max(0, grandTotal - advancePaid)

    const handleSettle = async () => {
        if (!booking) return

        setIsSaving(true)
        try {
            const resolvedCash = paymentMethod === 'cash' ? balanceDue
                : paymentMethod === 'qr_digital' ? 0
                : parseFloat(splitCashAmount) || 0
            const resolvedQr = paymentMethod === 'qr_digital' ? balanceDue
                : paymentMethod === 'cash' ? 0
                : parseFloat(splitQrAmount) || 0

            const res = await fetch(`/api/bookings/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: booking.id,
                    room_id: room.id,
                    total_amount: grandTotal,
                    cash_paid: resolvedCash,
                    qr_paid: resolvedQr,
                    session_id: sessionId
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

            toast.success('Room billing settled and guest checked out successfully!')
            const paidAmount = advancePaid + resolvedCash + resolvedQr
            onSettled({
                bookingId: booking.id,
                roomId: room.id,
                total: grandTotal,
                paidAmount,
                paymentStatus: paidAmount >= grandTotal ? 'paid' : 'partial'
            })
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to checkout')
        } finally {
            setIsSaving(false)
        }
    }

    if (!mounted) return null

    return (
        <Modal
            open
            onClose={onClose}
            size="xl"
            ariaLabel={`Room ${room.room_number} billing`}
            className="bg-white flex flex-col overflow-hidden max-h-[90vh] md:max-h-[85vh]"
        >
                <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 bg-gray-50/50 flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-black text-gray-900">Room {room.room_number} stays details</h3>
                        <p className="text-xs text-gray-500 mt-0.5">{room.room_types?.name} • Floor {room.floor || 'N/A'}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition text-gray-500 hover:text-gray-900"><X size={16} /></button>
                </div>

                {loadingDetails ? (
                    <div className="p-6 flex-1 flex flex-col items-center justify-center gap-3">
                        <Loader2 size={32} className="animate-spin text-[#ff5a00]" />
                        <p className="text-xs text-gray-500 font-semibold">Loading details...</p>
                    </div>
                ) : booking ? (
                    <>
                        <div className="space-y-6 p-6 overflow-y-auto flex-1">
                            <div className="grid grid-cols-2 gap-4 bg-gray-50/50 border border-gray-100 rounded-2xl p-4 text-xs">
                                <div className="space-y-1.5">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Guest</p>
                                    <p className="font-extrabold text-gray-900 text-sm">{booking.guest_name}</p>
                                    <p className="font-semibold text-gray-600">{booking.guest_phone}</p>
                                </div>
                                <div className="space-y-1 text-right border-l border-gray-100 pl-4">
                                    <p className="text-[10px] font-bold text-gray-400 uppercase">Stay schedule</p>
                                    <p className="font-semibold text-gray-600">In: {formatDateTime(booking.check_in)}</p>
                                    <p className="font-semibold text-gray-600">Out: {formatDateTime(booking.check_out)}</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Stay billing breakdown</h4>
                                <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-100 bg-white">
                                    <div className="flex justify-between items-center p-4 text-xs">
                                        <div>
                                            <p className="font-extrabold text-gray-900">Room Stay Cost</p>
                                            <p className="text-[10px] text-gray-400">{money(room.room_types?.base_price || 0)} / Night</p>
                                        </div>
                                        <span className="font-extrabold text-gray-600 tabular-nums">{money(stayCost)}</span>
                                    </div>

                                    {allServiceOrderItems.length > 0 && (
                                        <div className="p-4 space-y-2">
                                            <p className="font-extrabold text-xs text-indigo-600">Service Orders (QR + Dining)</p>
                                            <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                                                {allServiceOrderItems.map((item, idx) => (
                                                    <div key={`service-item-${item.id || 'item'}-${idx}`} className="flex justify-between text-[10px] text-gray-600">
                                                        <span>{item.menu_items?.name || 'Item'} ({item.quantity}×)</span>
                                                        <span className="tabular-nums font-semibold">{money(item.unit_price * item.quantity)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {charges.length > 0 && (
                                        <div className="p-4 space-y-2">
                                            <p className="font-extrabold text-xs text-amber-600">Additional stay charges</p>
                                            <div className="space-y-1.5 pl-3 border-l-2 border-amber-100">
                                                {charges.map(c => (
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
                                        onClick={() => setPaymentMethod('cash')}
                                        className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                            paymentMethod === 'cash'
                                                ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                                        Cash
                                    </button>
                                    <button
                                        onClick={() => setPaymentMethod('qr_digital')}
                                        className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                            paymentMethod === 'qr_digital'
                                                ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                                        QR / Digital
                                    </button>
                                    <button
                                        onClick={() => {
                                            setPaymentMethod('split')
                                            setSplitCashAmount('')
                                            setSplitQrAmount('')
                                        }}
                                        className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                            paymentMethod === 'split'
                                                ? 'border-[#ff5a00] bg-orange-50/50 text-[#ff5a00]'
                                                : 'border-gray-150 bg-white text-gray-500 hover:border-[#ff5a00]/50 hover:text-[#ff5a00]'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                                        Both
                                    </button>
                                </div>

                                {/* Split amount inputs — shown only when Both is selected */}
                                {paymentMethod === 'split' && (
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
                                )}
                            </div>
                        </div>
                        <div className="border-t border-gray-100 px-6 py-4 flex-shrink-0 bg-white">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-gray-400 uppercase">Total bill amount</span>
                                <span className="text-sm font-black text-gray-600 tabular-nums">{money(grandTotal)}</span>
                            </div>
                            {advancePaid > 0 && (
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        Advance Paid ({booking.advance_payment_method === 'split' ? 'Split Cash+QR' : booking.advance_payment_method === 'qr_digital' ? 'QR/Digital' : 'Cash'})
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
                                        onClick={onClose}
                                        className="px-4 py-2 border border-gray-200 rounded-xl text-xs font-semibold hover:bg-gray-50 transition"
                                    >
                                        Close
                                    </button>
                                    <button
                                        onClick={handleSettle}
                                        disabled={isSaving}
                                        className="px-6 py-2 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-[#ff5a00]/10 disabled:opacity-50 flex items-center gap-1.5"
                                    >
                                        {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                                        Settle & Checkout
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="p-6 flex-1 flex items-center justify-center">
                        <p className="text-xs text-gray-400">No active stay found for this room.</p>
                    </div>
                )}
        </Modal>
    )
}
