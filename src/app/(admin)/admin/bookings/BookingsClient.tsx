'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Filter, Calendar, ChevronUp, ChevronDown, ShoppingBag, Loader2, AlertTriangle, RotateCcw, X, LogIn, LogOut, Banknote, QrCode, CreditCard, Receipt, Clock, UtensilsCrossed } from 'lucide-react'
import type { Booking, Room, BookingStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import { useDates } from '@/lib/contexts/CalendarContext'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'
import type { BookingBill, BookingBillOrder, BookingBillOrderKind } from '@/lib/bookingBill'

interface BookingsClientProps {
    initialBookings: Booking[]
    rooms: Room[]
    restaurantId: string
    restaurantName: string
    tables?: any[]
    activeOrders?: any[]
}

const money = (amount: number) => `Rs. ${(Number(amount) || 0).toFixed(2)}`

/** A single line in the run-up to the total, so every line reads the same. */
function BillLine({
    label,
    note,
    amount,
    sign = '',
    strong = false,
    muted = false,
}: {
    label: React.ReactNode
    note?: React.ReactNode
    amount: number
    sign?: '' | '+' | '-'
    strong?: boolean
    muted?: boolean
}) {
    return (
        <div className={`flex items-start justify-between gap-3 px-4 py-2 ${strong ? 'bg-surface-muted/40' : ''}`}>
            <div className="min-w-0">
                <div className={`text-xs truncate ${strong ? 'font-extrabold text-ink' : muted ? 'font-semibold text-ink-subtle' : 'font-bold text-ink'}`}>
                    {label}
                </div>
                {note && <div className="text-[10px] text-ink-subtle font-semibold mt-0.5">{note}</div>}
            </div>
            <div className={`shrink-0 tabular-nums text-xs ${strong ? 'font-black text-ink' : muted ? 'font-semibold text-ink-subtle' : 'font-extrabold text-ink'}`}>
                {sign ? `${sign} ` : ''}{money(Math.abs(amount))}
            </div>
        </div>
    )
}

const ORDER_KIND_BADGE: Record<BookingBillOrderKind, { label: string; className: string }> = {
    room_qr: { label: 'Room QR', className: 'bg-blue-50 text-blue-700 border-blue-100' },
    dining_table: { label: 'Dining table', className: 'bg-violet-50 text-violet-700 border-violet-100' },
    direct: { label: 'Put on room', className: 'bg-amber-50 text-amber-800 border-amber-100' },
}

/** One service order, in full: how it arrived, what was in it, what it added. */
function ServiceOrderCard({ order, formatDateTime }: { order: BookingBillOrder; formatDateTime: (v: string) => string }) {
    const badge = ORDER_KIND_BADGE[order.kind]
    return (
        <div className={`border rounded-xl overflow-hidden ${order.billed ? 'border-hairline bg-surface' : 'border-dashed border-amber-300 bg-amber-50/30'}`}>
            <div className="px-4 py-2.5 bg-surface-muted/50 flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-extrabold text-xs text-ink">{order.ref}</span>
                    <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.className}`}>
                        {badge.label}
                    </span>
                    {order.tableLabel && (
                        <span className="text-[10px] font-bold text-ink-subtle truncate">{order.tableLabel}</span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-semibold text-ink-subtle">
                    <span className="whitespace-nowrap">{formatDateTime(order.placedAt)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface border border-hairline capitalize">{order.status}</span>
                    <span className={`px-1.5 py-0.5 rounded border capitalize ${
                        order.paymentStatus === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-surface text-ink-subtle border-hairline'
                    }`}>
                        {order.paymentStatus}
                    </span>
                </div>
            </div>

            <div className="divide-y divide-hairline">
                {order.items.map(item => (
                    <div key={item.id} className="grid grid-cols-12 px-4 py-2 text-xs items-baseline">
                        <div className="col-span-6 min-w-0">
                            <span className="font-bold text-ink">{item.name}</span>
                            {item.variation && <span className="text-ink-subtle font-semibold"> · {item.variation}</span>}
                            {item.station && (
                                <span className="text-[9px] font-bold text-ink-subtle uppercase ml-1.5">{item.station}</span>
                            )}
                            {item.specialRequest && (
                                <div className="text-[10px] text-amber-700 font-semibold truncate">“{item.specialRequest}”</div>
                            )}
                        </div>
                        <div className="col-span-2 text-center font-extrabold text-brand-600">{item.quantity}×</div>
                        <div className="col-span-2 text-right font-semibold text-ink-subtle tabular-nums">{money(item.unitPrice)}</div>
                        <div className="col-span-2 text-right font-extrabold text-ink tabular-nums">{money(item.lineTotal)}</div>
                    </div>
                ))}
                {order.items.length === 0 && (
                    <div className="px-4 py-2 text-[11px] text-ink-subtle font-semibold">Every item on this order was cancelled.</div>
                )}
            </div>

            <div className="px-4 py-2 bg-surface-muted/30 border-t border-hairline space-y-1">
                <div className="flex justify-between text-[11px] font-bold text-ink-subtle">
                    <span>Items</span>
                    <span className="tabular-nums">{money(order.subtotal)}</span>
                </div>
                {order.serviceCharge > 0 && (
                    <div className="flex justify-between text-[11px] font-bold text-ink-subtle">
                        <span>Room service charge</span>
                        <span className="tabular-nums">+ {money(order.serviceCharge)}</span>
                    </div>
                )}
                {order.discountAtOrderTime > 0 && (
                    <div className="flex justify-between text-[10px] font-semibold text-ink-subtle">
                        <span>Discount taken on the order itself</span>
                        <span className="tabular-nums">- {money(order.discountAtOrderTime)}</span>
                    </div>
                )}
                {order.taxAtOrderTime > 0 && (
                    <div className="flex justify-between text-[10px] font-semibold text-ink-subtle">
                        <span>Tax priced in at order time</span>
                        <span className="tabular-nums">{money(order.taxAtOrderTime)}</span>
                    </div>
                )}
                <div className={`flex justify-between text-xs font-black pt-1 border-t border-hairline ${order.billed ? 'text-ink' : 'text-amber-800'}`}>
                    <span>{order.billed ? 'On this bill' : 'Not billed on this stay'}</span>
                    <span className="tabular-nums">{money(order.billedTotal)}</span>
                </div>
            </div>
        </div>
    )
}

function BookingHistoryCard({ booking }: { booking: Booking }) {
    const [loading, setLoading] = useState(true)
    const [bill, setBill] = useState<BookingBill | null>(null)
    const [error, setError] = useState<string | null>(null)
    const { formatDateTime } = useDates()

    useEffect(() => {
        let isMounted = true
        async function loadBill() {
            try {
                setLoading(true)
                setError(null)
                const res = await fetch(`/api/bookings/bill?bookingId=${booking.id}`)
                const data = await res.json()
                if (!isMounted) return
                if (!res.ok) {
                    setError(data.error || 'Could not load this bill')
                    return
                }
                setBill(data.data as BookingBill)
            } catch {
                if (isMounted) setError('Could not load this bill')
            } finally {
                if (isMounted) setLoading(false)
            }
        }
        loadBill()
        return () => { isMounted = false }
    }, [booking.id])

    if (loading) {
        return (
            <div className="p-6 bg-brand-50/30 border-t-2 border-b-2 border-brand-200 animate-fade-down">
                <div className="flex items-center justify-center py-8 text-xs text-ink-subtle gap-2">
                    <Loader2 size={16} className="animate-spin text-brand-500" /> Building this stay&apos;s bill…
                </div>
            </div>
        )
    }

    if (error || !bill) {
        return (
            <div className="p-6 bg-brand-50/30 border-t-2 border-b-2 border-brand-200 animate-fade-down">
                <div className="flex items-center justify-center gap-2 py-8 text-xs font-bold text-rose-600">
                    <AlertTriangle size={15} /> {error || 'Could not load this bill'}
                </div>
            </div>
        )
    }

    const { totals, payments, settlement, rooms, charges, orders } = bill
    const isIssued = bill.mode === 'issued'
    const billedOrders = orders.filter(o => o.billed)
    const roomNumbers = rooms.map(r => r.roomNumber).filter(Boolean)

    return (
        <div className="p-6 bg-brand-50/30 border-t-2 border-b-2 border-brand-200 space-y-6 animate-fade-down">
            <div className="bg-surface rounded-2xl border-2 border-brand-200/70 shadow-lg overflow-hidden divide-y divide-hairline">

                {/* Header: whose bill this is, and which of the two it is */}
                <div className="p-5 bg-surface-muted/50 flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 font-black text-sm shrink-0">
                            {roomNumbers[0] || booking.rooms?.room_number || '—'}
                        </div>
                        <div>
                            <h4 className="font-extrabold text-ink text-base flex items-center gap-2 flex-wrap">
                                {bill.guestName}
                                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-surface border border-hairline text-ink-subtle">
                                    {roomNumbers.length > 1 ? `Rooms ${roomNumbers.join(', ')}` : `Room ${roomNumbers[0] || '—'}`}
                                </span>
                                {bill.groupId && (
                                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                                        One reservation
                                    </span>
                                )}
                            </h4>
                            <p className="text-xs text-ink-subtle font-medium mt-0.5">
                                Phone: <strong className="text-ink">{bill.guestPhone || 'N/A'}</strong> · {bill.nights} Night{bill.nights === 1 ? '' : 's'} ({new Date(bill.checkIn).toLocaleDateString()} → {new Date(bill.checkOut).toLocaleDateString()})
                                {bill.customRatePerNight > 0 && (
                                    <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                        Agreed rate {money(bill.customRatePerNight)}/night
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                        <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border bg-brand-50 text-brand-700 border-brand-200">
                            {bill.status.replace('_', ' ')}
                        </span>
                        {isIssued && settlement ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg flex items-center gap-1">
                                <Receipt size={11} />
                                Bill issued {formatDateTime(settlement.at)}{settlement.by ? ` · ${settlement.by}` : ''}
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg flex items-center gap-1">
                                <Clock size={11} />
                                Running bill — as of {formatDateTime(bill.asOf)}
                            </span>
                        )}
                        {isIssued && settlement && !settlement.closedStay && (
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg">
                                Paid and kept the room
                            </span>
                        )}
                        {isIssued && settlement && (
                            <span className="text-[10px] font-semibold text-ink-subtle">Ref {settlement.invoiceNumber}</span>
                        )}
                    </div>
                </div>

                {/* Check-in / check-out attribution — stamped server-side when the
                    status actually changed, never hand-typed. */}
                <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-surface">
                    <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                            <LogIn size={12} />
                        </div>
                        <div className="min-w-0">
                            <span className="text-[9px] font-bold text-blue-800 uppercase tracking-wider block">Checked In — Cashier</span>
                            <div className="flex items-baseline gap-1.5 truncate">
                                <span className="text-xs font-extrabold text-ink truncate">{bill.checkedInBy || 'Unknown'}</span>
                                <span className="text-[9px] text-ink-subtle font-semibold whitespace-nowrap">
                                    {bill.checkedInAt ? formatDateTime(bill.checkedInAt) : 'not yet'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="p-2 rounded-lg bg-surface-muted/40 border border-hairline flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-surface-muted text-ink-subtle flex items-center justify-center shrink-0">
                            <LogOut size={12} />
                        </div>
                        <div className="min-w-0">
                            <span className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider block">Checked Out — Cashier</span>
                            {bill.checkedOutAt ? (
                                <div className="flex items-baseline gap-1.5 truncate">
                                    <span className="text-xs font-extrabold text-ink truncate">{bill.checkedOutBy || 'Unknown'}</span>
                                    <span className="text-[9px] text-ink-subtle font-semibold whitespace-nowrap">{formatDateTime(bill.checkedOutAt)}</span>
                                </div>
                            ) : (
                                <span className="text-[11px] text-ink-subtle font-semibold">Still in house</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── The bill itself ──────────────────────────────────────── */}
                <div className="p-5 space-y-3">
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-ink-subtle flex items-center gap-2">
                        <Receipt size={14} className="text-brand-500" />
                        {isIssued ? 'The bill the guest was given' : 'The bill so far'}
                    </h5>
                    <p className="text-[10px] text-ink-subtle font-semibold -mt-1">
                        {isIssued
                            ? 'Exactly as it stood when it was settled — the figures that were charged, not today’s prices.'
                            : 'Computed the same way checkout will compute it: room nights, manual charges, room-service orders, service charge and VAT.'}
                    </p>

                    <div className="border border-hairline rounded-xl overflow-hidden divide-y divide-hairline bg-surface">
                        {/* Room nights, one line per room on the bill */}
                        {rooms.map(room => (
                            <BillLine
                                key={room.bookingId}
                                label={`Room ${room.roomNumber}${room.roomType ? ` · ${room.roomType}` : ''}`}
                                note={
                                    <>
                                        {room.nights} night{room.nights === 1 ? '' : 's'}
                                        {room.nightlyRate > 0 ? ` @ ${money(room.nightlyRate)}` : ''}
                                        {room.lateNights > 0 && (
                                            <span className="text-amber-700 font-bold">
                                                {' '}· includes {room.lateNights} late-checkout night{room.lateNights === 1 ? '' : 's'}
                                            </span>
                                        )}
                                    </>
                                }
                                amount={room.stayCost}
                            />
                        ))}
                        {rooms.length === 0 && (
                            <BillLine label="Room stay" amount={totals.stayCost} />
                        )}

                        {totals.roomDiscount > 0 && (
                            <BillLine
                                label="Room discount"
                                note={(booking as { discount_reason?: string | null }).discount_reason || 'Bargain rate given at the desk'}
                                amount={totals.roomDiscount}
                                sign="-"
                            />
                        )}

                        {/* Manual charges added during the stay */}
                        {charges.map(charge => (
                            <BillLine
                                key={charge.id}
                                label={charge.description}
                                note={<span className="capitalize">{charge.chargeType.replace('_', ' ')}</span>}
                                amount={charge.amount}
                            />
                        ))}

                        {/* Food and drink, itemized in full further down */}
                        <BillLine
                            label={
                                <span className="flex items-center gap-1.5">
                                    <UtensilsCrossed size={12} className="text-brand-500" />
                                    Food &amp; drink
                                </span>
                            }
                            note={`${billedOrders.length} order${billedOrders.length === 1 ? '' : 's'}${totals.serviceCharge > 0 ? ' · service charge included' : ''}`}
                            amount={totals.ordersTotal}
                        />
                        {totals.serviceCharge > 0 && (
                            <BillLine
                                label="— of which room service charge"
                                note={
                                    totals.serviceChargeOverridden
                                        ? `Cashier set this by hand — the rules produced ${money(totals.serviceChargeAuto)}`
                                        : '10% on kitchen items, on rooms where it applies'
                                }
                                amount={totals.serviceCharge}
                                muted
                            />
                        )}
                        {totals.foodDiscount > 0 && (
                            <BillLine
                                label="— of which discount already taken on the orders"
                                note="Promo or loyalty, applied when the order was placed"
                                amount={totals.foodDiscount}
                                muted
                            />
                        )}

                        {totals.vat > 0 && (
                            <BillLine label="VAT" note="On the room and manual charges only" amount={totals.vat} sign="+" />
                        )}

                        {totals.extraHourCharge > 0 && (
                            <BillLine label="Extra hour charge" note="Late departure, charged at the till" amount={totals.extraHourCharge} sign="+" />
                        )}

                        {/* Whatever the charged total exceeds these lines by, said
                            out loud instead of leaving a breakdown that doesn't add up. */}
                        {isIssued && Math.abs(totals.adjustment - totals.extraHourCharge) > 0.01 && (
                            <BillLine
                                label="Adjustment made at checkout"
                                note="Charged on the bill but not attributable to a line above"
                                amount={totals.adjustment - totals.extraHourCharge}
                                sign={totals.adjustment - totals.extraHourCharge < 0 ? '-' : '+'}
                            />
                        )}

                        <BillLine
                            label={isIssued ? 'Total charged' : 'Total so far'}
                            amount={totals.total}
                            strong
                        />
                    </div>

                    {/* What was taken against it */}
                    <div className="border border-hairline rounded-xl overflow-hidden divide-y divide-hairline bg-surface">
                        <div className="px-4 py-2 bg-surface-muted/60 text-[10px] font-black uppercase tracking-wider text-ink-subtle">
                            Money received
                        </div>
                        {/* The advance splits cash from QR only when something
                            recorded the split; on a 'split' advance rebuilt from
                            the booking record, the total is all that is known. */}
                        {payments.advanceSplitKnown ? (
                            <>
                                {payments.advanceCash > 0 && (
                                    <BillLine label={<span className="flex items-center gap-1.5"><Banknote size={12} className="text-emerald-600" /> Advance — cash</span>} amount={payments.advanceCash} sign="-" />
                                )}
                                {payments.advanceQr > 0 && (
                                    <BillLine label={<span className="flex items-center gap-1.5"><QrCode size={12} className="text-emerald-600" /> Advance — QR / digital</span>} amount={payments.advanceQr} sign="-" />
                                )}
                            </>
                        ) : (
                            <BillLine
                                label={<span className="flex items-center gap-1.5"><Banknote size={12} className="text-emerald-600" /> Advance taken</span>}
                                note={`Method recorded as ${(payments.advanceMethod || 'unknown').replace('_', ' ')} — cash and QR were not recorded separately`}
                                amount={payments.advanceTotal}
                                sign="-"
                            />
                        )}
                        {payments.settlementCash > 0 && (
                            <BillLine label={<span className="flex items-center gap-1.5"><Banknote size={12} className="text-emerald-600" /> At checkout — cash</span>} amount={payments.settlementCash} sign="-" />
                        )}
                        {payments.settlementQr > 0 && (
                            <BillLine label={<span className="flex items-center gap-1.5"><QrCode size={12} className="text-emerald-600" /> At checkout — QR / digital</span>} amount={payments.settlementQr} sign="-" />
                        )}
                        {payments.credit > 0 && (
                            <BillLine
                                label={<span className="flex items-center gap-1.5"><CreditCard size={12} className="text-amber-700" /> Left on credit</span>}
                                note="Posted to the guest&rsquo;s ledger account at checkout"
                                amount={payments.credit}
                            />
                        )}
                        {payments.uncollected > 0.01 && (
                            <BillLine
                                label={<span className="flex items-center gap-1.5"><CreditCard size={12} className="text-amber-700" /> Not collected</span>}
                                note="Charged but never handed over — taken onto the guest&rsquo;s account, or still owed"
                                amount={payments.uncollected}
                            />
                        )}
                        {payments.collectedTotal === 0 && payments.credit === 0 && payments.uncollected === 0 && (
                            <div className="px-4 py-2.5 text-[11px] text-ink-subtle font-semibold">Nothing received against this stay yet.</div>
                        )}

                        {payments.returnToGuest > 0.01 ? (
                            <BillLine label="Return to guest" note="Taken in advance beyond the bill" amount={payments.returnToGuest} strong />
                        ) : (
                            <BillLine
                                label={
                                    isIssued
                                        ? (payments.credit > 0 || payments.uncollected > 0.01 ? 'Settled — part not collected' : 'Settled in full')
                                        : 'Still to collect'
                                }
                                amount={payments.netDue}
                                strong
                            />
                        )}

                        {payments.detail === 'reconstructed' && (
                            <div className="px-4 py-2 text-[10px] font-semibold text-ink-subtle bg-surface-muted/30">
                                Rebuilt from the booking record and the checkout snapshot — this stay predates the
                                payments table, so the cash/QR split is only as detailed as those could say.
                            </div>
                        )}
                    </div>

                    {bill.runningSinceSettlement != null && bill.runningSinceSettlement > 0.01 && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[11px] font-semibold text-amber-800 leading-relaxed">
                                This stay has run up <strong>{money(bill.runningSinceSettlement)}</strong> more since the bill above was issued — it was settled while the guest kept the room.
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Service orders, in full ───────────────────────────────── */}
                <div className="p-5 space-y-3">
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-ink-subtle flex items-center gap-2">
                        <ShoppingBag size={14} className="text-brand-500" />
                        Service orders ({orders.length})
                    </h5>

                    {orders.length === 0 ? (
                        <div className="p-4 text-center border border-dashed border-hairline rounded-xl text-xs text-ink-subtle">
                            No food or drink was ordered on this stay.
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {orders.map(order => (
                                <ServiceOrderCard key={order.id} order={order} formatDateTime={formatDateTime} />
                            ))}
                            <div className="flex justify-between px-4 py-2.5 rounded-xl bg-surface-muted/60 border border-hairline text-xs font-black text-ink">
                                <span>Food &amp; drink on this bill</span>
                                <span className="tabular-nums">{money(totals.ordersTotal)}</span>
                            </div>
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
