'use client'

import { useState, useEffect, useSyncExternalStore, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, CheckCircle2, Percent, Clock, Printer, History, Utensils, QrCode, Bed, RotateCcw } from 'lucide-react'
import AdvancePaymentHistoryModal from './AdvancePaymentHistoryModal'
import type { Booking, Room } from '@/types/database'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { calculateNights, lateCheckoutNights, resolveDeparture, LATE_CHECKOUT_GRACE_HOURS, advanceMethodLabel, getItemDisplayName } from '@/lib/utils'
import { buildInvoiceTicket, type ActiveInvoice } from '@/lib/print/templates/invoiceTicket'
import InvoiceReceipt from '@/components/shared/InvoiceReceipt'
import { usePrinter } from '@/lib/print/usePrinter'
import { usePrinterSettingsStore } from '@/lib/stores/printerSettings'
import { useQrCodes } from '@/lib/hooks/useQrCodes'
import { useFeatureEnabled, useDateFormatter, useFeatures } from '@/lib/contexts/FeatureContext'
import { autoRoomServiceCharge, resolveRoomServiceCharge, roomServiceChargeApplies, ROOM_SERVICE_CHARGE_RATE } from '@/lib/roomServiceCharge'
import Select from '@/components/ui/Select'
import { useDates } from '@/lib/contexts/CalendarContext'

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
    station?: string | null
    menu_items?: { name: string; station?: string | null } | null
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
    restaurantName: string
    restaurantAddress?: string
    restaurantPhone?: string
    onClose: () => void
    /** Called after the server confirms the checkout so the caller can update its local state. */
    onSettled: (result: SettlementResult) => void
}

const money = (amount: number) =>
    'Rs. ' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The other rooms billing onto this same folio (see /api/bookings/group). */
interface GroupBill {
    groupId: string
    rooms: Array<{
        bookingId: string
        roomId: string
        roomNumber: string
        nights: number
        stayCost: number
        paidAmount: number
    }>
    stayCost: number
    advancePaid: number
}

// Mirrors the server folio, including the late-checkout rule — if this preview
// left the overstay out, the cashier would quote a total the server then
// charged more than.
const calculateStayCost = (room: Room, booking: Booking) => {
    const price = room.room_types?.base_price || 0
    const nights = calculateNights(booking.check_in, booking.check_out)
        + lateCheckoutNights(booking.check_out, resolveDeparture(booking))
    return price * nights
}

/**
 * Checkout & settlement modal for a room stay: room cost + QR room-service
 * orders + manual charges, settled by cash / QR / split payment. Owns the
 * charges fetch and the call to /api/bookings/checkout; callers only react
 * to onSettled/onClose. Shared by the admin Bookings and Rooms pages.
 */
export default function RoomBillingModal({ room, booking, tables, activeOrders, restaurantName, restaurantAddress = '', restaurantPhone = '', onClose, onSettled }: RoomBillingModalProps) {
    // true after hydration (portals can't render during SSR)
    const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)
    const formatDate = useDateFormatter()
    const [charges, setCharges] = useState<RoomCharge[]>([])
    // Loading is derived: we're loading until charges have arrived for this booking
    const [chargesLoadedFor, setChargesLoadedFor] = useState<string | null>(null)
    const loadingDetails = booking ? chargesLoadedFor !== booking.id : false
    // Discount fields for room stay and food/beverage orders
    const [roomDiscount, setRoomDiscount] = useState('')
    const [orderDiscount, setOrderDiscount] = useState('')
    const [discountReason, setDiscountReason] = useState('')
    const [extraHourCharge, setExtraHourCharge] = useState('')
    const [applyRoomServiceCharge, setApplyRoomServiceCharge] = useState(true)
    const [roomServiceChargeInput, setRoomServiceChargeInput] = useState('')
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'qr_digital' | 'split' | 'credit'>('cash')
    const [historyModalOpen, setHistoryModalOpen] = useState(false)
    const [splitCashAmount, setSplitCashAmount] = useState('')
    const [splitQrAmount, setSplitQrAmount] = useState('')
    const [qrCodeId, setQrCodeId] = useState('')
    // Pre-filled from the booking's own guest details (still editable) rather
    // than asking again — the guest is already identified at checkout. Same
    // "blank means fall back" convention as bargainRate above, so no effect
    // is needed to sync it once the booking loads.
    const [creditCustomerNameInput, setCreditCustomerNameInput] = useState('')
    const [creditCustomerPhoneInput, setCreditCustomerPhoneInput] = useState('')
    const [guestEmailInput, setGuestEmailInput] = useState('')
    // 'split' and 'credit' always go through this confirmation popup —
    // 'split' because a typo in the amounts would otherwise silently
    // mischarge the guest, 'credit' because it needs a name/phone to post
    // against.
    const [showSettlementConfirm, setShowSettlementConfirm] = useState(false)
    const qrCodes = useQrCodes()
    const [isSaving, setIsSaving] = useState(false)
    const printInvoiceEnabled = useFeatureEnabled('printInvoiceEnabled')
    const printBillEnabled = useFeatureEnabled('printBillEnabled')
    const generateInvoiceEnabled = useFeatureEnabled('generateInvoiceEnabled')
    const irdSyncEnabled = useFeatureEnabled('irdSyncEnabled')
    const features = useFeatures()
    const { formatDateTime, calendar } = useDates()
    const { print: printInvoice } = usePrinter('invoice')
    // True once the checkout API confirms the room is settled — printing
    // happens after this, so the manager sees "Settled" immediately instead
    // of waiting on a printer that may be slow or not configured.
    const [invoiceSettled, setInvoiceSettled] = useState(false)
    const [showSettlementPrintPrompt, setShowSettlementPrintPrompt] = useState(false)
    const [settlementCopies, setSettlementCopies] = useState(1)

    useEffect(() => {
        if (!booking) return
        setGuestEmailInput(booking.guest_email || '')
        setPaymentMethod('cash')
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

    // A multi-room reservation settles as one bill, so this modal has to show
    // every room on it — not just the one the cashier happened to click. The
    // server is still authoritative (see computeFolioForStays); this is the
    // preview the cashier confirms before taking the money.
    const [loadedGroupBill, setLoadedGroupBill] = useState<GroupBill | null>(null)
    const [groupBillLoadedFor, setGroupBillLoadedFor] = useState<string | null>(null)
    // Derived rather than cleared in the effect, matching chargesLoadedFor
    // above: until the fetch lands for THIS booking, there is no group bill, so
    // a previous room's reservation can never bleed into the one on screen.
    const groupBill = booking && groupBillLoadedFor === booking.id ? loadedGroupBill : null
    useEffect(() => {
        if (!booking) return
        let cancelled = false
        fetch(`/api/bookings/group?bookingId=${booking.id}`)
            .then(r => r.json())
            .then(data => {
                if (cancelled) return
                setLoadedGroupBill(data.success && data.isGroup ? data : null)
                setGroupBillLoadedFor(booking.id)
            })
            .catch(err => console.error('Error loading group bill:', err))
        return () => { cancelled = true }
    }, [booking])

    // The room's own QR session carries booking_id, so its orders arrive in BOTH
    // qrOrderItems (by session) and linkedDiningOrders (by booking) — dedupe by
    // order-item id so the displayed total matches what the server bills.
    const allServiceOrderItems = Array.from(
        new Map([...qrOrderItems, ...linkedDiningOrders].map(it => [it.id, it])).values()
    ).filter((it: any) => it.status !== 'cancelled')

    const dineInOrderItems = useMemo(() => {
        return allServiceOrderItems.filter((it: any) => !it.is_room_order)
    }, [allServiceOrderItems])

    const qrRoomServiceOrderItems = useMemo(() => {
        return allServiceOrderItems.filter((it: any) => it.is_room_order)
    }, [allServiceOrderItems])

    const dineInTotal = useMemo(() => {
        return dineInOrderItems.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
    }, [dineInOrderItems])

    const qrRoomServiceTotal = useMemo(() => {
        return qrRoomServiceOrderItems.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
    }, [qrRoomServiceOrderItems])

    // For a group the room cost is every room's cost, since the guest pays once.
    const stayCost = groupBill
        ? groupBill.stayCost
        : (booking ? calculateStayCost(room, booking) : 0)
    const qrOrdersTotal = allServiceOrderItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
    const manualChargesTotal = charges.reduce((acc, c) => acc + Number(c.amount || 0), 0)

    // Pre-filled from the booking's own guest details (still editable) — the
    // guest is already identified at checkout, no need to ask again unless
    // it's actually a different person settling on credit.
    const creditCustomerName = creditCustomerNameInput || booking?.guest_name || ''
    const creditCustomerPhone = creditCustomerPhoneInput || booking?.guest_phone || ''

    const roomDiscountVal = roomDiscount.trim() !== '' ? parseFloat(roomDiscount) || 0 : 0
    const orderDiscountVal = orderDiscount.trim() !== '' ? parseFloat(orderDiscount) || 0 : 0
    const totalDiscountAmount = roomDiscountVal + orderDiscountVal

    const extraHourChargeVal = extraHourCharge.trim() !== '' ? parseFloat(extraHourCharge) || 0 : 0

    const discountInvalid = roomDiscountVal < 0 || roomDiscountVal > stayCost || orderDiscountVal < 0 || orderDiscountVal > qrOrdersTotal
    const effectiveStayCost = Math.max(0, stayCost - roomDiscountVal)
    // What the guest owes for orders: every service order against the stay,
    // room service and linked dine-in tables alike, less the order discount.
    const effectiveOrdersTotal = Math.max(0, qrOrdersTotal - orderDiscountVal)

    // Service charge on food items for direct room orders & room QR orders only
    // (linked dining tables excluded). Gated on the same settings the server
    // folio checks, so this can't quote a charge the settlement won't make.
    const autoServiceCharge = useMemo(
        () => autoRoomServiceCharge(allServiceOrderItems, features, room?.id),
        [allServiceOrderItems, features, room?.id],
    )
    // A room the settings exempt still gets the field — the override is billed
    // as a difference from the auto figure, which for these rooms is 0.
    const serviceChargeIsAutomatic = roomServiceChargeApplies(features, room?.id)
    const serviceCharge = resolveRoomServiceCharge(autoServiceCharge, roomServiceChargeInput)
    const roomServiceChargeAmount = applyRoomServiceCharge ? serviceCharge.charged : 0
    // A waive via the toggle is an override to zero as far as the API cares.
    const serviceChargeOverrideValue = !applyRoomServiceCharge ? 0 : serviceCharge.isOverridden ? serviceCharge.charged : undefined

    const grandTotal = effectiveStayCost + effectiveOrdersTotal + manualChargesTotal + extraHourChargeVal + roomServiceChargeAmount
    // Advances were taken per room, so a reservation's advance is their sum.
    const advancePaid = groupBill ? groupBill.advancePaid : (Number(booking?.paid_amount) || 0)
    const balanceDue = Math.max(0, grandTotal - advancePaid)

    const checkOutTime = booking ? new Date(booking.check_out) : null
    const currentTime = new Date()
    const isExceeded = checkOutTime ? currentTime > checkOutTime : false
    const extraHours = isExceeded && checkOutTime
        ? Math.ceil((currentTime.getTime() - checkOutTime.getTime()) / (1000 * 60 * 60))
        : 0
    // Nights the overstay has already added to the room cost above. Past the
    // grace period the stay is billed another full day automatically, so the
    // manual extra-hour field must not be offered for the same time again —
    // that would charge the guest twice for one overstay.
    const autoLateNights = booking
        ? lateCheckoutNights(booking.check_out, resolveDeparture(booking))
        : 0

    const resolvedCash = paymentMethod === 'cash' ? balanceDue
        : paymentMethod === 'split' ? (parseFloat(splitCashAmount) || 0)
        : 0
    const resolvedQr = paymentMethod === 'qr_digital' ? balanceDue
        : paymentMethod === 'split' ? (parseFloat(splitQrAmount) || 0)
        : 0
    // 'split' no longer requires cash+qr to exactly equal the balance due —
    // whatever's left over (if any) becomes credit, confirmed via the
    // settlement popup below (guards against a typo, not just a deliberate
    // part-credit sale).
    const resolvedCredit = paymentMethod === 'credit' ? balanceDue
        : paymentMethod === 'split' ? Math.max(0, balanceDue - resolvedCash - resolvedQr)
        : 0
    const overpaid = paymentMethod === 'split' && (resolvedCash + resolvedQr) > balanceDue + 0.01
    const creditFieldsInvalid = resolvedCredit > 0.01 && (!creditCustomerName.trim() || !creditCustomerPhone.trim())

    // Merge duplicate line items (same dish ordered at different times in the same
    // session) into a single row with summed quantity — prevents the same item
    // appearing twice on the printed bill (e.g. "Chili Momo Veg x1" twice instead
    // of "Chili Momo Veg x2").
    const mergeLineItems = (items: typeof allServiceOrderItems) => {
        const map = new Map<string, { name: string; quantity: number; unitPrice: number }>()
        for (const item of items) {
            const name = getItemDisplayName(item)
            const unitPrice = Number(item.unit_price)
            const key = `${name}__${unitPrice}`
            const existing = map.get(key)
            if (existing) {
                existing.quantity += item.quantity
            } else {
                map.set(key, { name, quantity: item.quantity, unitPrice })
            }
        }
        return Array.from(map.values())
    }

    // Same shape the Cashier POS invoice preview uses, so the printed receipt
    // is identical regardless of which screen settled the bill.
    const invoiceData: ActiveInvoice | null = booking ? {
        type: 'room',
        id: booking.id,
        // A multi-room reservation settles on one bill, so the receipt names
        // every room it covers and itemizes them below. Its rooms can be of
        // different types, so no single type name would be right.
        label: groupBill
            ? `Rooms ${groupBill.rooms.map(r => r.roomNumber).filter(Boolean).join(', ')}`
            : `Room ${room.room_number}`,
        roomType: groupBill ? undefined : room.room_types?.name,
        guestName: booking.guest_name,
        guestPhone: booking.guest_phone,
        nights: calculateNights(booking.check_in, booking.check_out),
        basePrice: room.room_types?.base_price || 0,
        stayCost: stayCost,
        roomLines: groupBill
            ? groupBill.rooms.map(r => ({ roomNumber: r.roomNumber, nights: r.nights, stayCost: r.stayCost }))
            : undefined,
        qrOrders: mergeLineItems(allServiceOrderItems),
        qrOrdersTotal,
        serviceCharge: roomServiceChargeAmount || undefined,
        manualCharges: charges.map(c => ({ id: c.id, description: c.description, amount: Number(c.amount) })),
        manualChargesTotal,
        total: grandTotal,
        advancePaid,
        advanceMethod: booking.advance_payment_method || 'none',
        balanceDue,
        paymentMethod: paymentMethod === 'split' ? 'both' : paymentMethod,
        cashPaid: resolvedCash,
        qrPaid: resolvedQr,
        creditPaid: resolvedCredit,
        discountAmount: totalDiscountAmount,
        discountReason: discountReason,
        extraHourCharge: extraHourChargeVal,
    } : null

    const handlePrintBill = async () => {
        if (!invoiceData) return
        const result = await printInvoice(buildInvoiceTicket(invoiceData, money, restaurantName, restaurantAddress, restaurantPhone, calendar))
        if (!result.ok) {
            toast.error(
                result.status === 'no-printer-selected'
                    ? 'No printer set for this till — pick one in Printer Settings.'
                    : 'Printer not connected — opening browser print instead.'
            )
            if (result.status !== 'no-printer-selected') window.print()
        }
    }

    // 'cash'/'qr_digital' are unambiguous — settle immediately. 'split' and
    // 'credit' open the confirmation popup instead (see showSettlementConfirm
    // above); its own Confirm button calls handleSettle directly once the
    // breakdown (and, if needed, customer details) are confirmed.
    const handleSettleClick = () => {
        if (discountInvalid) {
            toast.error('Discount amounts must be between 0 and the respective stay/order subtotals')
            return
        }
        if (totalDiscountAmount > 0 && !discountReason.trim()) {
            toast.error('A reason is required to apply a discount')
            return
        }
        if (paymentMethod === 'split' || paymentMethod === 'credit') {
            setShowSettlementConfirm(true)
            return
        }
        setShowSettlementPrintPrompt(true)
    }

    const handleSettle = async (overrideCopies?: number) => {
        if (!booking) return
        if (overpaid || creditFieldsInvalid) return

        setShowSettlementConfirm(false)
        setIsSaving(true)
        try {
            const res = await fetch(`/api/bookings/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: booking.id,
                    room_id: room.id,
                    total_amount: grandTotal,
                    cash_paid: resolvedCash,
                    qr_paid: resolvedQr,
                    qr_code_id: resolvedQr > 0 ? (qrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined)) : undefined,
                    session_id: sessionId,
                    discount_amount: totalDiscountAmount,
                    discount_reason: totalDiscountAmount > 0 
                        ? `Room: Rs. ${roomDiscountVal.toFixed(2)}, Food: Rs. ${orderDiscountVal.toFixed(2)} (Reason: ${discountReason.trim()})`
                        : undefined,
                    credit_amount: resolvedCredit,
                    customer_name: resolvedCredit > 0 ? creditCustomerName.trim() : undefined,
                    customer_phone: resolvedCredit > 0 ? creditCustomerPhone.trim() : undefined,
                    extra_hour_charge: extraHourChargeVal,
                    service_charge_override: serviceChargeOverrideValue,
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

            toast.success('Room billing settled and guest checked out successfully!')
            setIsSaving(false)
            setInvoiceSettled(true)

            // Trigger digital invoice email if provided
            if (guestEmailInput.trim()) {
                fetch(`/api/bookings/checkout/email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: booking.id,
                        email: guestEmailInput.trim()
                    })
                }).then(async r => {
                    if (r.ok) {
                        toast.success('Digital invoice sent to guest!')
                    } else {
                        const err = await r.json()
                        console.error('Failed to send digital invoice:', err.error)
                        toast.error(`Could not email receipt: ${err.error}`)
                    }
                }).catch(err => {
                    console.error('Email dispatch error:', err)
                })
            }

            const copiesToPrint = overrideCopies !== undefined ? overrideCopies : (usePrinterSettingsStore.getState().autoPrintBillOnSettle ? 1 : 0)
            if (copiesToPrint > 0 && printInvoiceEnabled && printBillEnabled) {
                for (let i = 0; i < copiesToPrint; i++) {
                    await handlePrintBill()
                }
            }

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

    // Blocks dismissing the modal mid-print — the off-screen receipt below is
    // what the print fallback targets, so it must stay mounted until printing
    // (fired inside handleSettle, right after invoiceSettled flips true) is done.
    const guardedClose = () => { if (!invoiceSettled) onClose() }

    return (
        <Modal
            open
            onClose={guardedClose}
            size="xl"
            ariaLabel={`Room ${room.room_number} billing`}
            className="bg-surface flex flex-col overflow-hidden max-h-[90vh] md:max-h-[85vh]"
        >
                <div className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-surface-muted/50 flex-shrink-0">
                    <div>
                        <h3 className="text-lg font-black text-ink">Room {room.room_number} stays details</h3>
                        <p className="text-xs text-ink-subtle mt-0.5">{room.room_types?.name} • Floor {room.floor || 'N/A'}</p>
                    </div>
                    <button onClick={guardedClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                </div>

                {loadingDetails ? (
                    <div className="p-6 flex-1 flex flex-col items-center justify-center gap-3">
                        <Loader2 size={32} className="animate-spin text-brand-500" />
                        <p className="text-xs text-ink-subtle font-semibold">Loading details...</p>
                    </div>
                ) : booking ? (
                    <>
                        <div className="space-y-6 p-6 overflow-y-auto flex-1">
                            <div className="grid grid-cols-2 gap-4 bg-surface-muted/50 border border-hairline rounded-2xl p-4 text-xs">
                                <div className="space-y-1.5">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest</p>
                                    <p className="font-extrabold text-ink text-sm">{booking.guest_name}</p>
                                    <p className="font-semibold text-ink-subtle">{booking.guest_phone}</p>
                                </div>
                                <div className="space-y-1 text-right border-l border-hairline pl-4">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase">Stay schedule</p>
                                    <p className="font-semibold text-ink-subtle">In: {formatDateTime(booking.check_in)}</p>
                                    <p className="font-semibold text-ink-subtle">Out: {formatDateTime(booking.check_out)}</p>
                                    {isExceeded && (
                                        <p className="text-[9px] text-rose-600 font-bold mt-1">
                                            ⚠ Exceeded by {extraHours} hr(s)
                                            {autoLateNights > 0
                                                ? ` — billed as ${autoLateNights} extra day${autoLateNights === 1 ? '' : 's'}`
                                                : ` — within ${LATE_CHECKOUT_GRACE_HOURS}h grace`}
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Stay billing breakdown</h4>
                                <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-hairline bg-surface">
                                    <div className="flex justify-between items-center p-4 text-xs">
                                        <div>
                                            <p className="font-extrabold text-ink">Room Stay Cost</p>
                                            {groupBill ? (
                                                <p className="text-[10px] text-ink-subtle">{groupBill.rooms.length} rooms on one bill</p>
                                            ) : (
                                                <p className="text-[10px] text-ink-subtle">{money(room.room_types?.base_price || 0)} / Night</p>
                                            )}
                                        </div>
                                        <span className="font-extrabold text-ink-subtle tabular-nums">{money(stayCost)}</span>
                                    </div>

                                    {/* A reservation's rooms itemized, so the cashier can see what the
                                        combined figure above is actually made of before charging it. */}
                                    {groupBill && groupBill.rooms.map(r => (
                                        <div key={r.bookingId} className="flex justify-between items-center py-2 px-4 pl-8 text-[11px] bg-surface-muted/30">
                                            <span className="font-bold text-ink-subtle">
                                                Room {r.roomNumber}
                                                <span className="ml-1.5 font-semibold opacity-70">
                                                    {r.nights} night{r.nights === 1 ? '' : 's'}
                                                </span>
                                            </span>
                                            <span className="font-bold text-ink-subtle tabular-nums">{money(r.stayCost)}</span>
                                        </div>
                                    ))}

                                    {extraHourChargeVal > 0 && (
                                        <div className="flex justify-between items-center p-4 text-xs bg-rose-50/20">
                                            <div>
                                                <p className="font-extrabold text-rose-700">Extra Hour Charge</p>
                                                <p className="text-[10px] text-rose-500">Late checkout fee</p>
                                            </div>
                                            <span className="font-extrabold text-rose-700 tabular-nums">{money(extraHourChargeVal)}</span>
                                        </div>
                                    )}

                                    {roomDiscountVal > 0 && (
                                        <div className="flex justify-between items-center p-4 text-xs bg-rose-50/40">
                                            <div>
                                                <p className="font-extrabold text-rose-600">Room Stay Discount</p>
                                                <p className="text-[10px] text-ink-subtle truncate max-w-[220px]">{discountReason || 'Reason required'}</p>
                                            </div>
                                            <span className="font-extrabold text-rose-600 tabular-nums">− {money(roomDiscountVal)}</span>
                                        </div>
                                    )}

                                    {orderDiscountVal > 0 && (
                                        <div className="flex justify-between items-center p-4 text-xs bg-rose-50/40">
                                            <div>
                                                <p className="font-extrabold text-rose-600">Order/Food Discount</p>
                                                <p className="text-[10px] text-gray-400 truncate max-w-[220px]">{discountReason || 'Reason required'}</p>
                                            </div>
                                            <span className="font-extrabold text-rose-600 tabular-nums">− {money(orderDiscountVal)}</span>
                                        </div>
                                    )}

                                    {/* Separate Section: Restaurant Dining (Dine-In / Table Orders) */}
                                    {dineInOrderItems.length > 0 && (
                                        <div className="p-4 space-y-2 border-t border-hairline bg-emerald-50/20">
                                            <div className="flex justify-between items-center text-xs">
                                                <p className="font-extrabold text-emerald-700 flex items-center gap-1.5">
                                                    <Utensils size={14} className="text-emerald-600" />
                                                    Restaurant Dining (Dine-In Table Orders)
                                                </p>
                                                <span className="font-extrabold text-emerald-700 tabular-nums">{money(dineInTotal)}</span>
                                            </div>
                                            <div className="space-y-1.5 pl-3 border-l-2 border-emerald-300">
                                                {dineInOrderItems.map((item, idx) => (
                                                    <div key={`dinein-item-${item.id || idx}`} className="flex justify-between text-[10px] text-ink-subtle">
                                                        <span>{getItemDisplayName(item)} ({item.quantity}×)</span>
                                                        <span className="tabular-nums font-semibold">{money(item.unit_price * item.quantity)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Separate Section: In-Room QR & Room Service Orders */}
                                    {qrRoomServiceOrderItems.length > 0 && (
                                        <div className="p-4 space-y-2 border-t border-hairline bg-indigo-50/20">
                                            <div className="flex justify-between items-center text-xs">
                                                <p className="font-extrabold text-indigo-700 flex items-center gap-1.5">
                                                    <QrCode size={14} className="text-indigo-600" />
                                                    In-Room QR & Room Service Orders
                                                </p>
                                                <span className="font-extrabold text-indigo-700 tabular-nums">{money(qrRoomServiceTotal)}</span>
                                            </div>
                                            <div className="space-y-1.5 pl-3 border-l-2 border-indigo-300">
                                                {qrRoomServiceOrderItems.map((item, idx) => (
                                                    <div key={`qr-item-${item.id || idx}`} className="flex justify-between text-[10px] text-ink-subtle">
                                                        <span>{getItemDisplayName(item)} ({item.quantity}×)</span>
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
                                                    <div key={c.id} className="flex justify-between text-[10px] text-ink-subtle">
                                                        <span className="capitalize">{c.description} ({c.charge_type})</span>
                                                        <span className="tabular-nums font-semibold">{money(c.amount)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Room Service Charge — auto figure where the room carries
                                        one, an empty field to add one by hand where it doesn't */}
                                    <div className="p-4 border-t border-hairline bg-surface-muted/20 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-extrabold text-ink flex items-center gap-1.5">
                                                        Room Service Charge
                                                        {serviceCharge.isOverridden && applyRoomServiceCharge && (
                                                            <span className="text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                                                                {serviceChargeIsAutomatic ? 'EDITED' : 'MANUAL'}
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="text-[10px] text-ink-subtle">
                                                        {serviceChargeIsAutomatic
                                                            ? `${ROOM_SERVICE_CHARGE_RATE * 100}% on room QR & direct room food orders · auto ${money(autoServiceCharge)}`
                                                            : 'Not charged automatically for this room — type an amount to add one'}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setApplyRoomServiceCharge(!applyRoomServiceCharge)}
                                                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                                                            applyRoomServiceCharge
                                                                ? 'bg-brand-500 text-white shadow-sm'
                                                                : 'bg-surface-muted text-ink-subtle border border-hairline hover:bg-surface-muted/80'
                                                        }`}
                                                    >
                                                        {applyRoomServiceCharge ? 'ON' : 'OFF'}
                                                    </button>
                                                    {serviceCharge.isOverridden && applyRoomServiceCharge && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setRoomServiceChargeInput('')}
                                                            title={serviceChargeIsAutomatic ? `Reset to the auto-calculated ${money(autoServiceCharge)}` : 'Clear the manual charge'}
                                                            className="p-1 rounded-md text-ink-subtle hover:text-brand-600 hover:bg-surface-muted transition"
                                                        >
                                                            <RotateCcw size={12} />
                                                        </button>
                                                    )}
                                                    <div className="relative w-28">
                                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            disabled={!applyRoomServiceCharge}
                                                            value={serviceCharge.isOverridden ? roomServiceChargeInput : (autoServiceCharge ? String(autoServiceCharge) : '')}
                                                            placeholder={autoServiceCharge ? String(autoServiceCharge) : '0.00'}
                                                            onChange={e => setRoomServiceChargeInput(e.target.value)}
                                                            aria-label="Room service charge"
                                                            className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-lg text-xs font-bold text-right tabular-nums bg-surface focus:outline-none focus:border-brand-500 disabled:opacity-50 disabled:bg-surface-muted"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            {applyRoomServiceCharge && roomServiceChargeAmount > 0 && (
                                                <div className="flex justify-between items-center text-xs pt-1 font-extrabold text-brand-700">
                                                    <span>Room Food Service Charge</span>
                                                    <span className="tabular-nums">+{money(roomServiceChargeAmount)}</span>
                                                </div>
                                            )}
                                    </div>
                                </div>
                            </div>

                            {/* Discounts section */}
                            <div className="border-2 border-amber-200 rounded-2xl p-4 space-y-4 bg-amber-50/60 shadow-sm">
                                <div className="flex items-center gap-2 pb-2 border-b border-amber-200/50">
                                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                        <Percent size={14} className="text-amber-700" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Discounts</p>
                                        <p className="text-[10px] text-amber-700/70 font-semibold">Apply discounts to Room rent and/or Food orders</p>
                                    </div>
                                </div>

                                <div className={qrOrdersTotal > 0 ? "grid grid-cols-2 gap-4" : "space-y-1"}>
                                    <div className="space-y-1">
                                        <label className="block text-[9px] font-black text-amber-800 uppercase">Room Discount</label>
                                        <div className="relative">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                            <input
                                                type="number"
                                                min="0"
                                                max={stayCost}
                                                placeholder="0.00"
                                                value={roomDiscount}
                                                onChange={e => setRoomDiscount(e.target.value)}
                                                className={`w-full pl-7 pr-2 py-2 border-2 rounded-xl text-xs font-bold bg-white focus:outline-none ${roomDiscountVal < 0 || roomDiscountVal > stayCost ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                            />
                                        </div>
                                        <span className="text-[9px] text-amber-700/60 font-semibold">Max: {money(stayCost)}</span>
                                    </div>

                                    {qrOrdersTotal > 0 && (
                                        <div className="space-y-1">
                                            <label className="block text-[9px] font-black text-amber-800 uppercase">Food Discount</label>
                                            <div className="relative">
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={qrOrdersTotal}
                                                    placeholder="0.00"
                                                    value={orderDiscount}
                                                    onChange={e => setOrderDiscount(e.target.value)}
                                                    className={`w-full pl-7 pr-2 py-2 border-2 rounded-xl text-xs font-bold bg-white focus:outline-none ${orderDiscountVal < 0 || orderDiscountVal > qrOrdersTotal ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                />
                                            </div>
                                            <span className="text-[9px] text-amber-700/60 font-semibold">Max: {money(qrOrdersTotal)}</span>
                                        </div>
                                    )}
                                </div>

                                {totalDiscountAmount > 0 && (
                                    <div className="space-y-1">
                                        <label className="block text-[9px] font-black text-amber-700 uppercase">Discount Reason (required)</label>
                                        <input
                                            type="text"
                                            value={discountReason}
                                            onChange={e => setDiscountReason(e.target.value)}
                                            placeholder="e.g. Regular guest / service delay compensation"
                                            className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-amber-500"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Extra Hour Charge Box (shown only if check-out time is exceeded) */}
                            {isExceeded && (
                                <div className="border-2 border-rose-200 rounded-2xl p-4 space-y-3 bg-rose-50/60 shadow-sm animate-scale-in">
                                    <div className="flex items-center gap-2 pb-2 border-b border-rose-200/50">
                                        <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                                            <Clock size={14} className="text-rose-700" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-black text-rose-800 uppercase tracking-wider">Late Checkout Alert</p>
                                            <p className="text-[10px] text-rose-700/70 font-semibold">
                                                Exceeded by {extraHours} hour(s)
                                                {autoLateNights > 0 && ` · ${autoLateNights} extra day${autoLateNights === 1 ? '' : 's'} already in the room cost`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[9px] font-black text-rose-800 uppercase">
                                            {autoLateNights > 0 ? 'Additional Charge (Optional)' : 'Extra Hour Charge (Optional)'}
                                        </label>
                                        {autoLateNights > 0 && (
                                            /* The overstay is already priced as whole days above. Anything
                                               typed here is on top of that, so say so — otherwise the
                                               obvious reading is that this is where the late fee goes, and
                                               the guest pays for the same hours twice. */
                                            <p className="text-[9px] text-rose-700/70 font-semibold">
                                                Past {LATE_CHECKOUT_GRACE_HOURS}h the stay is billed a full extra day automatically. Only add here if you are charging something beyond that.
                                            </p>
                                        )}
                                        <div className="relative">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-rose-700">Rs.</span>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder="0.00"
                                                value={extraHourCharge}
                                                onChange={e => setExtraHourCharge(e.target.value)}
                                                className="w-full pl-7 pr-2 py-2 border-2 border-rose-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-rose-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Send Digital Invoice */}
                            <div className="mt-3 pt-3 border-t border-dashed border-hairline">
                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Send Digital Invoice</label>
                                <input
                                    type="email"
                                    value={guestEmailInput}
                                    onChange={e => setGuestEmailInput(e.target.value)}
                                    placeholder="guest@example.com (optional)"
                                    className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                />
                            </div>

                            {/* Payment Method Selector */}
                            {irdSyncEnabled && (
                                <div className="pt-4">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Payment Method</p>
                                    <div className="grid grid-cols-4 gap-2">
                                        <button
                                            onClick={() => setPaymentMethod('cash')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                paymentMethod === 'cash'
                                                    ? 'border-brand-500 bg-orange-50/50 text-brand-500'
                                                    : 'border-hairline bg-surface text-ink-subtle hover:border-brand-500/50 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                                            Cash
                                        </button>
                                        <button
                                            onClick={() => setPaymentMethod('qr_digital')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                paymentMethod === 'qr_digital'
                                                    ? 'border-brand-500 bg-orange-50/50 text-brand-500'
                                                    : 'border-hairline bg-surface text-ink-subtle hover:border-brand-500/50 hover:text-brand-500'
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
                                                    ? 'border-brand-500 bg-orange-50/50 text-brand-500'
                                                    : 'border-hairline bg-surface text-ink-subtle hover:border-brand-500/50 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                                            Both
                                        </button>
                                        <button
                                            onClick={() => setPaymentMethod('credit')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                paymentMethod === 'credit'
                                                    ? 'border-brand-500 bg-orange-50/50 text-brand-500'
                                                    : 'border-hairline bg-surface text-ink-subtle hover:border-brand-500/50 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 9V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M22 17v-1a2 2 0 0 0-2-2h-1"/><rect width="8" height="8" x="14" y="14" rx="2"/></svg>
                                            Credit
                                        </button>
                                    </div>

                                    {paymentMethod === 'credit' && (
                                        <p className="mt-3 text-[10px] text-ink-subtle font-semibold text-center">
                                            You&apos;ll confirm the customer&apos;s name and phone in the next step.
                                        </p>
                                    )}

                                    {/* Split amount inputs — shown only when Both is selected */}
                                    {paymentMethod === 'split' && (
                                        <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-surface-muted/50 border border-hairline rounded-2xl">
                                            <div>
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Cash Amount</label>
                                                <div className="relative">
                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max={balanceDue}
                                                        placeholder="0.00"
                                                        value={splitCashAmount}
                                                        onChange={e => setSplitCashAmount(e.target.value)}
                                                        className="w-full pl-7 pr-2 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">QR / Digital Amount</label>
                                                <div className="relative">
                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max={balanceDue}
                                                        placeholder="0.00"
                                                        value={splitQrAmount}
                                                        onChange={e => setSplitQrAmount(e.target.value)}
                                                        className="w-full pl-7 pr-2 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                    />
                                                </div>
                                            </div>
                                            {/* Balance check — a shortfall is no longer an error: it becomes
                                                credit, confirmed (with customer details) in the next step. */}
                                            {(() => {
                                                const cash = parseFloat(splitCashAmount) || 0
                                                const qr = parseFloat(splitQrAmount) || 0
                                                const remainder = balanceDue - cash - qr
                                                if (remainder > 0.01) return (
                                                    <p className="col-span-2 text-[9px] text-amber-600 font-bold text-center">
                                                        Rs. {remainder.toFixed(2)} left over will go on customer credit
                                                    </p>
                                                )
                                                if (remainder < -0.01) return (
                                                    <p className="col-span-2 text-[9px] text-rose-500 font-bold text-center">
                                                        ⚠ Cash + QR exceeds the bill by {money(Math.abs(remainder))}
                                                    </p>
                                                )
                                                return (
                                                    <p className="col-span-2 text-[9px] text-emerald-600 font-bold text-center">✓ Amounts balanced</p>
                                                )
                                            })()}
                                        </div>
                                    )}

                                    {(paymentMethod === 'qr_digital' || paymentMethod === 'split') && qrCodes.length > 1 && (
                                        <div className="mt-3">
                                            <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Which QR did the guest scan?</label>
                                            <Select
                                                value={qrCodeId}
                                                onChange={e => setQrCodeId(e.target.value)}
                                                className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                            >
                                                <option value="">Select QR code…</option>
                                                {qrCodes.map(qr => (
                                                    <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="border-t border-hairline px-6 py-4 flex-shrink-0 bg-surface">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-ink-subtle uppercase">Total bill amount</span>
                                <span className="text-sm font-black text-ink-subtle tabular-nums">{money(grandTotal)}</span>
                            </div>
                            {advancePaid > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setHistoryModalOpen(true)}
                                    className="flex items-center justify-between w-full hover:underline cursor-pointer group transition-all"
                                >
                                    <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        Advance Paid ({advanceMethodLabel(booking.advance_payment_method)})
                                        <History className="w-3 h-3 inline ml-1 opacity-70 group-hover:opacity-100" />
                                    </span>
                                    <span className="text-sm font-black text-emerald-600 tabular-nums">− {money(advancePaid)}</span>
                                </button>
                            )}
                            <div className="flex items-center justify-between pt-1 border-t border-dashed border-hairline">
                                <div>
                                    <span className="text-[10px] font-bold text-ink-subtle uppercase">{advancePaid > 0 ? 'Balance Due' : 'Total Due'}</span>
                                    <p className="text-2xl font-black text-brand-500 tabular-nums">{money(balanceDue)}</p>
                                </div>
                                <div className="flex gap-2">
                                    {invoiceSettled ? (
                                        <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center gap-1.5">
                                            <CheckCircle2 size={14} />
                                            Settled
                                        </div>
                                    ) : (
                                        <>
                                            <button
                                                onClick={onClose}
                                                className="px-4 py-2 border border-hairline rounded-xl text-xs font-semibold hover:bg-surface-muted transition"
                                            >
                                                Close
                                            </button>
                                            {printInvoiceEnabled && printBillEnabled && (
                                                <button
                                                    onClick={handlePrintBill}
                                                    className="px-4 py-2 border border-hairline rounded-xl text-xs font-semibold hover:bg-surface-muted transition"
                                                >
                                                    Print Bill
                                                </button>
                                            )}
                                            <button
                                                onClick={handleSettleClick}
                                                disabled={isSaving || discountInvalid || (totalDiscountAmount > 0 && !discountReason.trim())}
                                                className="px-6 py-2 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-brand-500/10 disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                                                {!irdSyncEnabled ? 'Close Guest' : 'Settle & Checkout'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="p-6 flex-1 flex items-center justify-center">
                        <p className="text-xs text-ink-subtle">No active stay found for this room.</p>
                    </div>
                )}

                {/* Settlement Confirmation popup — gates every 'split' or
                    'credit' settlement behind one explicit confirm step: a
                    typo in the split amounts, or a missing customer name/
                    phone for the credit portion, surfaces here instead of
                    silently mischarging the guest. Rendered above the Modal
                    itself (z-[400] vs. its z-[200]). */}
                {mounted && showSettlementConfirm && createPortal(
                    <div
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[400] flex items-center justify-center p-4"
                        onClick={() => setShowSettlementConfirm(false)}
                    >
                        <div
                            className="bg-surface w-full max-w-sm rounded-[28px] shadow-2xl border border-hairline p-6 space-y-4"
                            onClick={e => e.stopPropagation()}
                        >
                            <div>
                                <h3 className="text-lg font-black text-ink">Confirm Settlement</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">Room {room.room_number}</p>
                            </div>

                            <div className="border border-hairline rounded-2xl p-4 space-y-2 text-xs">
                                {resolvedCash > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-ink-subtle font-semibold">Cash</span>
                                        <span className="font-bold text-ink tabular-nums">{money(resolvedCash)}</span>
                                    </div>
                                )}
                                {resolvedQr > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-ink-subtle font-semibold">QR / Digital</span>
                                        <span className="font-bold text-ink tabular-nums">{money(resolvedQr)}</span>
                                    </div>
                                )}
                                {resolvedCredit > 0.01 && (
                                    <div className="flex justify-between">
                                        <span className="text-amber-700 font-semibold">On Credit</span>
                                        <span className="font-bold text-amber-700 tabular-nums">{money(resolvedCredit)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between pt-2 border-t border-dashed border-hairline">
                                    <span className="text-[10px] font-bold text-ink-subtle uppercase">Balance Due</span>
                                    <span className="font-black text-ink tabular-nums">{money(balanceDue)}</span>
                                </div>
                            </div>

                            {overpaid ? (
                                <p className="text-[11px] text-rose-500 font-bold text-center">
                                    ⚠ Cash + QR exceeds the balance due — go back and fix the split before continuing.
                                </p>
                            ) : resolvedCredit > 0.01 && (
                                <div className="space-y-3">
                                    <p className="text-[11px] text-amber-700 font-semibold">
                                        {money(resolvedCredit)} will be added to this customer&apos;s credit account — confirm their details:
                                    </p>
                                    <div>
                                        <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Customer Name</label>
                                        <input
                                            type="text"
                                            value={creditCustomerName}
                                            onChange={e => setCreditCustomerNameInput(e.target.value)}
                                            placeholder="Guest name"
                                            className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Phone</label>
                                        <input
                                            type="tel"
                                            value={creditCustomerPhone}
                                            onChange={e => setCreditCustomerPhoneInput(e.target.value)}
                                            placeholder="98XXXXXXXX"
                                            className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => setShowSettlementConfirm(false)}
                                    className="flex-1 px-4 py-2 border border-hairline rounded-xl text-xs font-semibold hover:bg-surface-muted transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        setShowSettlementConfirm(false)
                                        setShowSettlementPrintPrompt(true)
                                    }}
                                    disabled={isSaving || overpaid || creditFieldsInvalid}
                                    className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-xs transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                >
                                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                                    Confirm &amp; Continue
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* Settlement Print Prompt Modal */}
                {showSettlementPrintPrompt && invoiceData && createPortal(
                    <div
                        className="fixed inset-0 bg-black/75 backdrop-blur-md z-[100000] flex items-center justify-center p-4 animate-in fade-in duration-150"
                        onClick={() => setShowSettlementPrintPrompt(false)}
                    >
                        <div
                            className="bg-surface w-full max-w-sm p-6 rounded-2xl shadow-2xl space-y-5 relative border border-hairline"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
                                    <Printer size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-ink text-base">Print Customer Bill?</h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">Select copies to print or mark paid without printing.</p>
                                </div>
                            </div>

                            <div className="bg-surface-muted p-3.5 rounded-xl border border-hairline flex items-center justify-between">
                                <span className="text-xs font-semibold text-ink">Bill Copies:</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSettlementCopies(Math.max(1, settlementCopies - 1))}
                                        className="w-8 h-8 rounded-lg bg-surface border border-hairline-strong font-bold text-ink hover:bg-surface-muted transition flex items-center justify-center text-sm shadow-sm"
                                    >
                                        -
                                    </button>
                                    <span className="w-8 text-center font-bold text-sm text-ink">{settlementCopies}</span>
                                    <button
                                        type="button"
                                        onClick={() => setSettlementCopies(Math.min(5, settlementCopies + 1))}
                                        className="w-8 h-8 rounded-lg bg-surface border border-hairline-strong font-bold text-ink hover:bg-surface-muted transition flex items-center justify-center text-sm shadow-sm"
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2.5 pt-1">
                                {(() => {
                                    const isCredit = paymentMethod === 'credit'
                                    const actionText = isCredit ? 'Mark Credit' : 'Mark Paid'
                                    return (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isSaving}
                                                onClick={() => {
                                                    setShowSettlementPrintPrompt(false)
                                                    handleSettle(settlementCopies)
                                                }}
                                                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white active:scale-95 transition shadow-sm flex items-center justify-center gap-2 ${
                                                    isCredit ? 'bg-purple-600 hover:bg-purple-700' : 'bg-brand-600 hover:bg-brand-700'
                                                }`}
                                            >
                                                <Printer size={15} /> Print {settlementCopies} {settlementCopies === 1 ? 'Copy' : 'Copies'} & {actionText}
                                            </button>

                                            <button
                                                type="button"
                                                disabled={isSaving}
                                                onClick={() => {
                                                    setShowSettlementPrintPrompt(false)
                                                    handleSettle(0)
                                                }}
                                                className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-ink bg-surface border border-hairline-strong hover:bg-surface-muted active:scale-95 transition flex items-center justify-center gap-2"
                                            >
                                                <CheckCircle2 size={15} /> Only {actionText} (No Print)
                                            </button>
                                        </>
                                    )
                                })()}

                                <button
                                    type="button"
                                    onClick={() => setShowSettlementPrintPrompt(false)}
                                    className="w-full py-1.5 text-xs font-medium text-ink-subtle hover:text-ink transition text-center"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* Off-screen receipt — not part of the review UI above, only exists
                    so Print Bill / the post-settle print fallback have a
                    print-container to target (see InvoiceReceipt's print CSS). */}
                {invoiceData && (
                    <div className="fixed -left-[9999px] top-0" aria-hidden>
                        <InvoiceReceipt invoice={invoiceData} money={money} formatDate={formatDate} restaurantName={restaurantName} restaurantAddress={restaurantAddress} restaurantPhone={restaurantPhone} />
                    </div>
                )}

                <AdvancePaymentHistoryModal
                    isOpen={historyModalOpen}
                    onClose={() => setHistoryModalOpen(false)}
                    bookingId={booking?.id || null}
                    guestName={booking?.guest_name}
                    roomNumber={room?.room_number}
                />
        </Modal>
    )
}
