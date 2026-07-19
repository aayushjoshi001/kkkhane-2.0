'use client'

import { useRef, useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid } from '@/app/(staff)/waiter/order-actions'
import { updateTakeoutStatusAction } from '@/app/(admin)/admin/takeout/actions'
import { useCurrency, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import { Banknote, CheckCircle, ChefHat, Clock, Loader2, CreditCard, Receipt, ShoppingBag, Flame, X, ShoppingCart, Percent } from 'lucide-react'
import PaymentVerificationFeed, { type PaymentClaim } from './PaymentVerificationFeed'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import Button from '@/components/ui/Button'
import { usePrinter } from '@/lib/print/usePrinter'
import { buildInvoiceTicket } from '@/lib/print/templates/invoiceTicket'


import { formatDateTime, calculateNights, advanceMethodLabel } from '@/lib/utils'
import { useQrCodes } from '@/lib/hooks/useQrCodes'

type OrderItem = { 
    id?: string
    quantity: number
    status?: string
    unit_price?: number
    menu_items: { name: string } | null 
}
type TableRef = { id?: string; label?: string; room_id?: string | null } | null

export type UnpaidOrder = {
    id: string
    status?: string
    total_amount: number
    delivered_at: string | null
    payment_status: string
    payment_method: string | null
    session_id: string | null
    booking_id?: string | null
    sessions: { id: string; seat_number?: number; tables: TableRef } | null
    order_items: OrderItem[]
}

export type ActiveOrder = {
    id: string
    status: string
    total_amount: number
    placed_at: string
    session_id: string | null
    booking_id?: string | null
    order_type?: 'dine_in' | 'takeout' | 'delivery'
    payment_status?: string
    customer_name?: string | null
    customer_phone?: string | null
    delivery_address?: string | null
    sessions: { id: string; seat_number?: number; tables: TableRef } | null
    order_items?: OrderItem[]
}

import CashierTableManager, { type TableWithSession } from './CashierTableManager'
import CashierRoomManager from './CashierRoomManager'
import InvoiceReceipt from '@/components/shared/InvoiceReceipt'

interface Props {
    restaurantId: string
    restaurantSlug: string
    userId: string
    initialUnpaid: UnpaidOrder[]
    initialActive: ActiveOrder[]
    initialClaims: PaymentClaim[]
    tables: TableWithSession[]
    rooms?: any[]
    isHotel?: boolean
    initialBookings?: any[]
}

// Label for an order's table, seat-aware: seat 2+ of a split table is always
// "4-2"; seat 1 only gets the "-1" suffix when its table is actually split
// (splitSessionIds), so ordinary single-session tables stay plain "4".
function tableLabel(
    sessions: { id?: string; seat_number?: number; tables: TableRef } | null,
    splitSessionIds?: Set<string>,
): string {
    const base = (sessions?.tables as { label?: string } | null)?.label ?? '?'
    const seat = sessions?.seat_number ?? 1
    if (seat >= 2 || (sessions?.id && splitSessionIds?.has(sessions.id))) return `${base}-${seat}`
    return base
}

export default function CashierClient({ 
    restaurantId, 
    restaurantSlug, 
    userId, 
    initialUnpaid, 
    initialActive, 
    initialClaims, 
    tables,
    rooms = [],
    isHotel = false,
    initialBookings = [],
}: Props) {
    const router = useRouter()
    const [unpaid, setUnpaid] = useState<UnpaidOrder[]>(initialUnpaid)
    const money = useCurrency()
    const printInvoiceEnabled = useFeatureEnabled('printInvoiceEnabled')
    const printBillEnabled = useFeatureEnabled('printBillEnabled')
    const showInvoiceEnabled = useFeatureEnabled('showInvoiceEnabled')
    const generateInvoiceEnabled = useFeatureEnabled('generateInvoiceEnabled')
    const irdSyncEnabled = useFeatureEnabled('irdSyncEnabled')
    const { print: printInvoice } = usePrinter('invoice')
    const [active, setActive] = useState<ActiveOrder[]>(initialActive)
    const [processingId, setProcessingId] = useState<string | null>(null)
    const [pendingClaims, setPendingClaims] = useState(
        initialClaims.filter(c => !c.staff_verified && !c.staff_rejected).length
    )
    const supabaseRef = useRef(createClient())
    const [activeTab, setActiveTab] = useState<'rooms' | 'tables' | 'space' | 'takeaway' | 'billing'>('billing')
    const [takeawaySubTab, setTakeawaySubTab] = useState<'takeaway' | 'delivery'>('takeaway')
    const [spaceFilter, setSpaceFilter] = useState<'all' | 'available' | 'reserved' | 'occupied' | 'dirty'>('all')
    const [roomsFilter, setRoomsFilter] = useState<'all' | 'available' | 'reserve' | 'occupied' | 'dirty' | 'closed'>('all')
    const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null)
    const [selectedOrder, setSelectedOrder] = useState<ActiveOrder | null>(null)
    
    // Stays and Billing states
    const [roomsState, setRoomsState] = useState<any[]>(rooms)
    const [bookings, setBookings] = useState<any[]>(initialBookings)
    const [billingSubTab, setBillingSubTab] = useState<'rooms' | 'tables'>('rooms')
    const [selectedBillingRoom, setSelectedBillingRoom] = useState<any | null>(null)
    const [selectedBillingTable, setSelectedBillingTable] = useState<any | null>(null)
    const [activeInvoice, setActiveInvoice] = useState<any | null>(null)
    const [isSettlingInvoice, setIsSettlingInvoice] = useState(false)
    // Synchronous re-entry guard: state updates from setIsSettlingInvoice are
    // batched/async, so a fast double-click can fire handleMarkPaid twice
    // before the button actually disables — settling the bill (and printing
    // the invoice) twice. A ref blocks re-entry the instant the first click lands.
    const isSettlingRef = useRef(false)
    // True once the bill is actually settled in the database — printing (which
    // can be slow or block on a native dialog if no printer is configured)
    // happens after this, so the cashier sees "Paid" immediately instead of a
    // spinner that looks stuck for as long as the print step takes.
    const [invoiceSettled, setInvoiceSettled] = useState(false)
    const [partnerRestaurantId, setPartnerRestaurantId] = useState<string | null>(null)

    useEffect(() => {
        const fetchPartner = async () => {
            const { data } = await supabaseRef.current
                .from('restaurants')
                .select('linked_restaurant_id')
                .eq('id', restaurantId)
                .maybeSingle()
            if (data?.linked_restaurant_id) {
                setPartnerRestaurantId(data.linked_restaurant_id)
            }
        }
        fetchPartner()
    }, [restaurantId])

    // For stay billing detail states
    const [loadingStayDetails, setLoadingStayDetails] = useState(false)
    const [billingStayBooking, setBillingStayBooking] = useState<any | null>(null)
    const [billingRoomCharges, setBillingRoomCharges] = useState<any[]>([])
    const [billingLinkedOrders, setBillingLinkedOrders] = useState<any[]>([])
    const filteredLinkedOrders = (() => {
        return billingLinkedOrders.filter(o => !o.is_room_order)
    })()
    const [billingPaymentMethod, setBillingPaymentMethod] = useState<'cash' | 'qr_digital' | 'both' | 'credit'>('cash')
    const [splitCashAmount, setSplitCashAmount] = useState<string>('')
    const [splitQrAmount, setSplitQrAmount] = useState<string>('')
    const [billingQrCodeId, setBillingQrCodeId] = useState<string>('')
    // Table bargain rate: blank means "no change", same convention as
    // RoomBillingModal's bargainRate — the input holds the new desired total,
    // not the discount amount itself.
    const [tableBargainRate, setTableBargainRate] = useState<string>('')
    const [tableBargainReason, setTableBargainReason] = useState<string>('')
    // Shared by both the room and table billing panels below — only one is
    // ever open at a time, so one pair of fields is enough. Only ever read
    // from the settlement confirmation popup now (see showSettlementConfirm) —
    // 'both'/'credit' settlements no longer show these inline.
    const [creditCustomerName, setCreditCustomerName] = useState<string>('')
    const [creditCustomerPhone, setCreditCustomerPhone] = useState<string>('')
    // Gates every 'both' or 'credit' settlement (room or table) behind one
    // confirmation popup — protects against a cashier's typo in the split
    // amounts, and is where a credit portion's name/phone gets collected.
    const [showSettlementConfirm, setShowSettlementConfirm] = useState(false)
    const [pendingInvoice, setPendingInvoice] = useState<{ type: 'room' | 'table'; item: any; data: any } | null>(null)
    const [isDirectCheckingOut, setIsDirectCheckingOut] = useState(false)
    const qrCodes = useQrCodes()

    const [mounted, setMounted] = useState(false)


    // Sync rooms state when prop changes
    useEffect(() => {
        setRoomsState(rooms)
    }, [rooms])

    // Sync bookings state when prop changes (e.g. on server reload or catch up)
    useEffect(() => {
        setBookings(initialBookings)
    }, [initialBookings])

    // Realtime subscriptions for rooms
    useRestaurantTable(restaurantId, 'rooms', (payload) => {
        if (payload.eventType === 'UPDATE') {
            const updatedRoom = payload.new as any
            setRoomsState((prev: any[]) => prev.map(r => r.id === updatedRoom.id ? { ...r, status: updatedRoom.status } : r))
            setSelectedBillingRoom((prev: any) => {
                if (!prev) return null
                return prev.id === updatedRoom.id ? { ...prev, status: updatedRoom.status } : prev
            })
        }
    })

    // Realtime subscriptions for bookings
    useRestaurantTable(restaurantId, 'bookings', (payload) => {
        if (payload.eventType === 'INSERT') {
            setBookings((prev: any[]) => [...prev, payload.new])
        } else if (payload.eventType === 'UPDATE') {
            const b = payload.new as any
            setBookings((prev: any[]) => prev.map(item => item.id === b.id ? b : item))
            if (billingStayBooking?.id === b.id) {
                setBillingStayBooking(b)
            }
        }
    })

    // Load booking stay details, manual charges, and linked dining orders concurrently when room is selected
    useEffect(() => {
        if (selectedBillingRoom) {
            // Always clear first so UI doesn't flash stale data
            setBillingStayBooking(null)
            setBillingRoomCharges([])
            setBillingLinkedOrders([])
            setLoadingStayDetails(true)

            // Fetch newest checked_in booking from API (ORDER BY created_at DESC)
            // This prevents showing old/orphaned bookings that were never checked out
            fetch(`/api/rooms/booking?roomId=${selectedBillingRoom.id}`)
                .then(res => res.json())
                .then(async (data) => {
                    if (data.success && data.data) {
                        const booking = data.data
                        try {
                            // Concurrently fetch charges and linked dining orders
                            const [chargesRes, ordersRes] = await Promise.all([
                                fetch(`/api/rooms/charges?bookingId=${booking.id}`).then(r => r.json()),
                                fetch(`/api/bookings/linked-orders?bookingId=${booking.id}`).then(r => r.json())
                            ])
                            
                            // Set all states simultaneously
                            setBillingStayBooking(booking)
                            if (chargesRes.success) {
                                setBillingRoomCharges(chargesRes.data || [])
                            }
                            if (ordersRes.success) {
                                setBillingLinkedOrders(ordersRes.items || [])
                            }
                        } catch (err) {
                            console.error('Error loading secondary billing details:', err)
                            // Set basic stay booking at least
                            setBillingStayBooking(booking)
                            setBillingRoomCharges([])
                            setBillingLinkedOrders([])
                        }
                    } else {
                        setBillingStayBooking(null)
                        setBillingRoomCharges([])
                        setBillingLinkedOrders([])
                    }
                })
                .catch(err => {
                    console.error('Error loading billing data:', err)
                    setBillingStayBooking(null)
                    setBillingRoomCharges([])
                    setBillingLinkedOrders([])
                })
                .finally(() => setLoadingStayDetails(false))
        } else {
            setBillingStayBooking(null)
            setBillingRoomCharges([])
            setBillingLinkedOrders([])
            setBillingPaymentMethod('cash')
            setSplitCashAmount('')
            setSplitQrAmount('')
            setBillingQrCodeId('')
            setCreditCustomerName('')
            setCreditCustomerPhone('')
        }
    }, [selectedBillingRoom, bookings])

    // Same reset for the table billing panel — keyed on the table's id so it
    // also fires when switching straight from one table to another, not just
    // on close.
    useEffect(() => {
        setBillingPaymentMethod('cash')
        setSplitCashAmount('')
        setSplitQrAmount('')
        setBillingQrCodeId('')
        setTableBargainRate('')
        setTableBargainReason('')
        setCreditCustomerName('')
        setCreditCustomerPhone('')
    }, [selectedBillingTable?.id])

    const calculateStayCost = (room: any, booking: any) => {
        if (!room || !booking) return 0
        const price = room.room_types?.base_price || 0
        const nights = calculateNights(booking.check_in, booking.check_out)
        return price * nights
    }

    const getRoomQrOrders = (room: any) => {
        if (!room) return []
        
        // Find the active booking for the room
        const booking = billingStayBooking ?? bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
        if (!booking) return []

        // Fetch all active/unpaid orders that are directly linked to this booking
        const allActive = active.filter(o => o.booking_id === booking.id)
        const allUnpaid = unpaid.filter(o => o.booking_id === booking.id)
        
        // Also fallback to match by session in case booking_id is not set but matchingTable activeSession is
        const matchingTable = tables.find(t => t.room_id === room.id)
        const sessionId = matchingTable?.activeSession?.id
        
        const additionalActive = sessionId ? active.filter(o => o.session_id === sessionId && o.booking_id !== booking.id) : []
        const additionalUnpaid = sessionId ? unpaid.filter(o => o.session_id === sessionId && o.booking_id !== booking.id) : []

        const combinedOrders = [...allActive, ...allUnpaid, ...additionalActive, ...additionalUnpaid]
        
        // De-duplicate orders by ID
        const uniqueOrdersMap = new Map<string, any>()
        for (const o of combinedOrders) {
            uniqueOrdersMap.set(o.id, o)
        }
        const uniqueOrders = Array.from(uniqueOrdersMap.values()).filter(o => {
            return o.sessions?.tables?.room_id !== null && o.sessions?.tables?.room_id !== undefined
        })

        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        for (const order of uniqueOrders) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                items.push({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity || 0,
                    unitPrice: Number(item.unit_price ?? 0),
                    status: item.status || order.status || 'unknown'
                })
            }
        }
        return items
    }

    const getTableSessionItems = (table: any) => {
        if (!table || !table.activeSession) return []
        const sessionId = table.activeSession.id
        const allActive = active.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaid.filter(o => o.session_id === sessionId)
        const combinedOrders = [...allActive, ...allUnpaid]

        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        for (const order of combinedOrders) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                items.push({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity || 0,
                    unitPrice: Number(item.unit_price ?? 0),
                    status: item.status || order.status || 'unknown'
                })
            }
        }
        return items
    }

    // The authoritative bill for a table session — sums each order's own
    // total_amount (already includes tax/service charge from placement time),
    // NOT unitPrice*quantity like getTableSessionItems above, which is only
    // the pre-tax line-item breakdown. /api/tables/checkout bills off this
    // same total_amount field, so the bargain rate and split-payment amounts
    // must be calculated against this number, not the pre-tax item sum —
    // otherwise a bargain rate entered against the wrong baseline over- or
    // under-charges the guest relative to what's displayed.
    const getTableSessionOrdersTotal = (table: any) => {
        if (!table || !table.activeSession) return 0
        const sessionId = table.activeSession.id
        const allActive = active.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaid.filter(o => o.session_id === sessionId)
        return [...allActive, ...allUnpaid].reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0)
    }

    const calculateGrandTotal = (room: any, booking: any) => {
        const stayCost = calculateStayCost(room, booking)
        const qrOrdersTotal = getRoomQrOrders(room).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
        const linkedOrdersTotal = filteredLinkedOrders.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
        const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        return stayCost + qrOrdersTotal + linkedOrdersTotal + manualChargesTotal
    }

    // Pure computation — no side effects — so compileInvoice below can inspect
    // the result (does this settlement involve credit? is it overpaid?) before
    // deciding whether to open the confirmation popup or go straight to the
    // invoice preview.
    const buildInvoiceData = (type: 'room' | 'table', item: any): any => {
        if (type === 'room') {
            const room = item
            // Prefer the freshly fetched billingStayBooking (newest checked_in via API)
            // This avoids showing stale data from a previous booking session
            const booking = billingStayBooking ?? bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
            if (!booking) return null

            const price = room.room_types?.base_price || 0
            const nights = calculateNights(booking.check_in, booking.check_out)
            const stayCost = price * nights

            const sessionOrders = getRoomQrOrders(room)
            const qrOrdersTotal = sessionOrders.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)

            const linkedOrdersTotal = filteredLinkedOrders.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
            const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
            const total = stayCost + qrOrdersTotal + linkedOrdersTotal + manualChargesTotal

            // Advance already paid at booking
            const advancePaid = Number(booking.paid_amount) || 0
            const balanceDue = Math.max(0, total - advancePaid)

            // Resolve split amounts (apply to balance due, not gross total).
            // Each branch is explicit (rather than falling through to an
            // "else") so a stale splitCashAmount left over from a previous
            // 'both' selection can't leak into a 'credit' settlement.
            const resolvedCash = billingPaymentMethod === 'cash' ? balanceDue
                : billingPaymentMethod === 'both' ? (parseFloat(splitCashAmount) || 0)
                : 0
            const resolvedQr = billingPaymentMethod === 'qr_digital' ? balanceDue
                : billingPaymentMethod === 'both' ? (parseFloat(splitQrAmount) || 0)
                : 0
            // 'both' no longer requires cash+qr to exactly equal the balance —
            // whatever's left over (if any) becomes credit, confirmed via the
            // settlement popup below (guards against a cashier's typo, not
            // just a deliberate part-credit sale).
            const resolvedCredit = billingPaymentMethod === 'credit' ? balanceDue
                : billingPaymentMethod === 'both' ? Math.max(0, balanceDue - resolvedCash - resolvedQr)
                : 0
            const overpaid = billingPaymentMethod === 'both' && (resolvedCash + resolvedQr) > balanceDue + 0.01

            return {
                type: 'room',
                id: room.id,
                label: `Room ${room.room_number}`,
                roomType: room.room_types?.name || 'Deluxe',
                guestName: booking.guest_name,
                guestPhone: booking.guest_phone,
                checkIn: booking.check_in,
                checkOut: booking.check_out,
                nights,
                basePrice: price,
                stayCost,
                qrOrders: getRoomQrOrders(room),
                qrOrdersTotal,
                linkedOrders: filteredLinkedOrders.map(item => ({
                    name: item.menu_items?.name || 'Item',
                    quantity: item.quantity,
                    unitPrice: Number(item.unit_price)
                })),
                linkedOrdersTotal,
                manualCharges: billingRoomCharges,
                manualChargesTotal,
                total,
                advancePaid,
                advanceMethod: booking.advance_payment_method || 'none',
                balanceDue,
                bookingId: booking.id,
                roomId: room.id,
                paymentMethod: billingPaymentMethod,
                cashPaid: resolvedCash,
                qrPaid: resolvedQr,
                creditPaid: resolvedCredit,
                overpaid,
                qrCodeId: (resolvedQr > 0) ? (billingQrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined)) : undefined,
                customerName: booking.guest_name,
                customerPhone: booking.guest_phone,
            }
        } else {
            const table = item
            const sessionOrders = getTableSessionItems(table)
            const itemsSubtotal = sessionOrders.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)
            // The authoritative, tax-inclusive total — /api/tables/checkout
            // bills off the same orders.total_amount field, so the bargain
            // rate must be calculated against this, not itemsSubtotal (which
            // is pre-tax and would understate what's actually charged).
            const subtotal = getTableSessionOrdersTotal(table)

            // Bargain rate: blank input = no change, standard subtotal stands
            // (same convention as RoomBillingModal's bargainRate) — the input
            // holds the new desired total, not the discount amount itself.
            const bargainRateEntered = tableBargainRate.trim() !== ''
            const bargainRateValue = bargainRateEntered ? parseFloat(tableBargainRate) || 0 : subtotal
            const discountAmount = bargainRateEntered ? Math.max(0, subtotal - bargainRateValue) : 0
            const total = subtotal - discountAmount

            const resolvedCash = billingPaymentMethod === 'cash' ? total
                : billingPaymentMethod === 'both' ? (parseFloat(splitCashAmount) || 0)
                : 0
            const resolvedQr = billingPaymentMethod === 'qr_digital' ? total
                : billingPaymentMethod === 'both' ? (parseFloat(splitQrAmount) || 0)
                : 0
            const resolvedCredit = billingPaymentMethod === 'credit' ? total
                : billingPaymentMethod === 'both' ? Math.max(0, total - resolvedCash - resolvedQr)
                : 0
            const overpaid = billingPaymentMethod === 'both' && (resolvedCash + resolvedQr) > total + 0.01

            return {
                type: 'table',
                id: table.id,
                label: `Table ${table.label}`,
                guestName: 'Table Guest',
                guestPhone: null,
                checkIn: table.activeSession.opened_at,
                checkOut: new Date().toISOString(),
                nights: 0,
                basePrice: 0,
                stayCost: 0,
                qrOrders: sessionOrders,
                qrOrdersTotal: itemsSubtotal,
                manualCharges: [],
                manualChargesTotal: 0,
                total,
                discountAmount,
                discountReason: discountAmount > 0 ? tableBargainReason.trim() : '',
                sessionId: table.activeSession.id,
                paymentMethod: billingPaymentMethod,
                cashPaid: resolvedCash,
                qrPaid: resolvedQr,
                creditPaid: resolvedCredit,
                overpaid,
                qrCodeId: (resolvedQr > 0) ? (billingQrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined)) : undefined,
                customerName: undefined,
                customerPhone: undefined,
            }
        }
    }

    // 'cash' and 'qr_digital' are unambiguous (one method, the full amount) —
    // straight to the invoice preview. 'both' and 'credit' always go through
    // the settlement confirmation popup first: 'both' because a typo in the
    // split fields would otherwise silently under- or over-charge, 'credit'
    // (whether the whole bill or a leftover from 'both') because it needs a
    // customer name + phone to post against.
    const compileInvoice = (type: 'room' | 'table', item: any) => {
        const data = buildInvoiceData(type, item)
        if (!data) return

        if (data.paymentMethod === 'both' || data.paymentMethod === 'credit') {
            // Seed the popup's name/phone from whatever identity is already
            // known (a room's own booking guest — blank for a table, where
            // there's no such default) rather than always starting blank.
            setCreditCustomerName(data.customerName || '')
            setCreditCustomerPhone(data.customerPhone || '')
            setPendingInvoice({ type, item, data })
            setShowSettlementConfirm(true)
            return
        }
        if (showInvoiceEnabled) {
            setActiveInvoice(data)
        } else {
            handleMarkPaid(data)
        }
    }

    // Confirm button on the settlement popup — folds the just-entered (or
    // pre-filled) customer details into the invoice and only now actually
    // opens the invoice preview / Mark Paid step.
    const finalizeSettlementConfirm = () => {
        if (!pendingInvoice) return
        const d = pendingInvoice.data
        const finalData = {
            ...d,
            guestName: d.creditPaid > 0.01 ? (creditCustomerName.trim() || d.guestName) : d.guestName,
            guestPhone: d.creditPaid > 0.01 ? (creditCustomerPhone.trim() || d.guestPhone) : d.guestPhone,
            customerName: d.creditPaid > 0.01 ? creditCustomerName.trim() : undefined,
            customerPhone: d.creditPaid > 0.01 ? creditCustomerPhone.trim() : undefined,
        }
        setShowSettlementConfirm(false)
        setPendingInvoice(null)
        if (showInvoiceEnabled) {
            setActiveInvoice(finalData)
        } else {
            handleMarkPaid(finalData)
        }
    }

    const cancelSettlementConfirm = () => {
        setShowSettlementConfirm(false)
        setPendingInvoice(null)
    }

    const handleCloseGuestDirectly = async (room: any) => {
        if (!room || isDirectCheckingOut) return
        setIsDirectCheckingOut(true)
        try {
            const booking = billingStayBooking ?? bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
            if (!booking) return

            const total = calculateGrandTotal(room, booking)
            const advancePaid = Number(booking.paid_amount) || 0
            const balanceDue = Math.max(0, total - advancePaid)
            const matchingTable = tables.find(t => t.room_id === room.id)
            const sessionId = matchingTable?.activeSession?.id

            // Settle all unpaid orders associated with this booking's session
            if (sessionId) {
                const sessionOrders = active.filter(o => o.session_id === sessionId)
                const sessionUnpaid = unpaid.filter(o => o.session_id === sessionId)
                const allUnpaid = [...sessionOrders, ...sessionUnpaid].filter(o => o.payment_status === 'unpaid')
                
                await Promise.all(
                    allUnpaid.map(order => markDeliveredAndCashPaid(order.id, 'cash'))
                )
            }

            const res = await fetch(`/api/bookings/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: booking.id,
                    room_id: room.id,
                    total_amount: total,
                    cash_paid: balanceDue,
                    qr_paid: 0,
                    session_id: sessionId || null,
                    credit_amount: 0,
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

            setBookings(prev => prev.map(b =>
                b.id === booking.id ? { ...b, status: 'checked_out' } : b
            ))
            setRoomsState(prev => prev.map(r =>
                r.id === room.id ? { ...r, status: 'dirty' } : r
            ))

            toast.success('Room guest checked out successfully!')
            setSelectedBillingRoom(null)
            router.refresh()
        } catch (err) {
            console.error('Error during direct checkout:', err)
            toast.error(err instanceof Error ? err.message : 'Checkout failed')
        } finally {
            setIsDirectCheckingOut(false)
        }
    }

    const handleMarkPaid = async (directInvoice?: any) => {
        const invoice = directInvoice || activeInvoice
        if (!invoice || isSettlingRef.current) return
        isSettlingRef.current = true
        setIsSettlingInvoice(true)
        try {
            if (invoice.type === 'room') {
                // Settle all unpaid orders associated with this room's session
                // client-side first — /api/bookings/checkout also settles
                // idempotently, but doing it here records exactly what the
                // cashier selected (Cash / QR / Both) per order for the EOD
                // report's cash-vs-digital breakdown.
                const sessionId = tables.find(t => t.room_id === invoice.roomId)?.activeSession?.id

                if (sessionId) {
                    const sessionOrders = active.filter(o => o.session_id === sessionId)
                    const sessionUnpaid = unpaid.filter(o => o.session_id === sessionId)
                    const allUnpaid = [...sessionOrders, ...sessionUnpaid].filter(o => o.payment_status === 'unpaid')

                    // For a split settlement there's no single right answer per
                    // order, so draw sequentially from the cash pool first, then
                    // the QR pool — whatever's left over (both pools exhausted)
                    // is the credit portion, which has no fitting method for
                    // markDeliveredAndCashPaid, so those orders are left unpaid
                    // here for /api/bookings/checkout's own settling to pick up
                    // without a payment_verifications row (no cash/qr method
                    // fits a credit sale).
                    let remainingCash = billingPaymentMethod === 'both' ? (parseFloat(splitCashAmount) || 0) : billingPaymentMethod === 'cash' ? Infinity : 0
                    let remainingQr = billingPaymentMethod === 'both' ? (parseFloat(splitQrAmount) || 0) : billingPaymentMethod === 'qr_digital' ? Infinity : 0
                    const methodForOrder = (amount: number): 'cash' | 'qr_scan' | null => {
                        if (remainingCash >= amount) {
                            remainingCash -= amount
                            return 'cash'
                        }
                        if (remainingQr >= amount) {
                            remainingQr -= amount
                            return 'qr_scan'
                        }
                        return null
                    }

                    if (billingPaymentMethod !== 'credit') {
                        // Independent per-order updates (each keyed by its own id) —
                        // settle them concurrently instead of one network round-trip
                        // at a time, which was the main reason "Mark Paid" felt slow
                        // on a big bill.
                        const results = await Promise.all(
                            allUnpaid.map(order => {
                                const method = methodForOrder(order.total_amount)
                                return method ? markDeliveredAndCashPaid(order.id, method) : Promise.resolve<{ error?: string; success?: boolean }>({ success: true })
                            })
                        )
                        const failed = results.find(res => res.error)
                        if (failed) throw new Error(failed.error)
                    }
                }

                const res = await fetch(`/api/bookings/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: invoice.bookingId,
                        room_id: invoice.roomId,
                        total_amount: invoice.total,
                        cash_paid: invoice.cashPaid,
                        qr_paid: invoice.qrPaid,
                        qr_code_id: invoice.qrCodeId,
                        session_id: sessionId || null,
                        credit_amount: invoice.creditPaid || 0,
                        customer_name: invoice.customerName,
                        customer_phone: invoice.customerPhone,
                    })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Failed to checkout booking')

                // Immediately update local state so UI reflects changes without refresh
                setBookings(prev => prev.map(b =>
                    b.id === invoice.bookingId ? { ...b, status: 'checked_out' } : b
                ))
                setRoomsState(prev => prev.map(r =>
                    r.id === invoice.roomId ? { ...r, status: 'dirty' } : r
                ))

                toast.success('Room billing settled and guest checked out successfully!')

                // `tables` is a server-fetched prop, never refreshed on the client —
                // the checkout just closed this room's dining session and marked its
                // orders paid in the DB. Without this, the next guest booked into the
                // room would still see the previous guest's now-settled orders here.
                router.refresh()
            } else {
                // The dine-in equivalent — /api/tables/checkout does its own
                // order settling, session closing, and ledger/credit posting
                // server-side (no client-side pre-settle loop needed).
                const res = await fetch(`/api/tables/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: invoice.sessionId,
                        cash_paid: invoice.cashPaid,
                        qr_paid: invoice.qrPaid,
                        credit_amount: invoice.creditPaid || 0,
                        qr_code_id: invoice.qrCodeId,
                        discount_amount: invoice.discountAmount || 0,
                        discount_reason: invoice.discountReason,
                        customer_name: invoice.customerName,
                        customer_phone: invoice.customerPhone,
                    })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Failed to checkout table')

                toast.success('Table session settled and closed successfully!')
            }

            // The bill is settled in the database at this point — the cashier
            // sees "Paid" immediately rather than a spinner that looks stuck for
            // as long as printing takes (which can block on a native browser
            // print dialog if no printer is configured for this till).
            isSettlingRef.current = false
            setIsSettlingInvoice(false)
            setInvoiceSettled(true)

            // Auto-print the invoice via QZ Tray as raw ESC/POS (same path as
            // the kitchen KOT printer). Only fall back to the browser dialog
            // when QZ is actually unreachable — not when no printer is picked,
            // since a thermal roll on a driverless raw queue can't be rasterized
            // by the browser anyway, and that just surfaced a confusing
            // "printer not available" dialog after a bill was already settled.
            if (printInvoiceEnabled && printBillEnabled) {
                const printResult = await printInvoice(buildInvoiceTicket(invoice, money))
                if (!printResult.ok) {
                    toast.error(
                        printResult.status === 'no-printer-selected'
                            ? 'Bill settled, but no printer is set for this till — pick one in Printer Settings.'
                            : 'Bill settled, but the printer isn’t connected — opening browser print instead.'
                    )
                    if (printResult.status !== 'no-printer-selected') window.print()
                }
            }

            setActiveInvoice(null)
            setSelectedBillingRoom(null)
            setSelectedBillingTable(null)
            setInvoiceSettled(false)
            window.location.reload()
        } catch (e: any) {
            toast.error(e.message || 'Failed to settle invoice')
        } finally {
            isSettlingRef.current = false
            setIsSettlingInvoice(false)
        }
    }

    // Manual re-print of the current invoice. Goes through QZ Tray as raw
    // ESC/POS (the same path the kitchen KOT printer uses), so it prints a
    // clean receipt on a thermal roll instead of the browser rasterizing an
    // A4 page to a driverless raw queue. Only if QZ can't be reached at all do
    // we fall back to the browser print dialog for driver-based printers.
    const handlePrintBill = async () => {
        if (!activeInvoice) return
        const result = await printInvoice(buildInvoiceTicket(activeInvoice, money))
        if (!result.ok) {
            toast.error(
                result.status === 'no-printer-selected'
                    ? 'No printer set for this till — pick one in Printer Settings.'
                    : 'Printer not connected — opening browser print instead.'
            )
            if (result.status !== 'no-printer-selected') window.print()
        }
    }

    // Set default active tab correctly
    useEffect(() => {
        setMounted(true)
        if (isHotel) {
            setActiveTab('rooms')
            setBillingSubTab('rooms')
        } else {
            setBillingSubTab('tables')
        }
    }, [isHotel])

    const spaceCounts = useMemo(() => {
        let all = tables.length
        let available = 0
        let reserved = 0
        let occupied = 0
        let dirty = 0
        for (const t of tables) {
            const rawStatus = t.activeSession ? 'active' : (t.table_status || 'available')
            const status = (isHotel && rawStatus === 'dirty') ? 'available' : rawStatus
            if (status === 'active') occupied++
            else if (status === 'dirty') dirty++
            else if (status === 'reserved') reserved++
            else available++
        }
        return { all, available, reserved, occupied, dirty }
    }, [tables])

    const roomsCounts = useMemo(() => {
        let all = rooms.length
        let available = rooms.filter(r => r.status === 'available').length
        let reserve = 0 // dummy count for reserve status
        let occupied = rooms.filter(r => r.status === 'occupied').length
        let dirty = rooms.filter(r => r.status === 'dirty').length
        let closed = rooms.filter(r => r.status === 'maintenance').length
        return { all, available, reserve, occupied, dirty, closed }
    }, [rooms])

    const billingStayBookingRef = useRef(billingStayBooking)
    useEffect(() => {
        billingStayBookingRef.current = billingStayBooking
    }, [billingStayBooking])

    useRestaurantTable(restaurantId, 'orders', async (payload) => {
        const supabase = supabaseRef.current
        
        // Refresh linked orders in real-time if a stay details panel is open
        const currentBooking = billingStayBookingRef.current
        if (currentBooking) {
            fetch(`/api/bookings/linked-orders?bookingId=${currentBooking.id}`)
                .then(res => res.json())
                .then(ordersData => {
                    if (ordersData.success) {
                        setBillingLinkedOrders(ordersData.items || [])
                    }
                })
                .catch(err => console.error('Error refreshing linked dining orders in real-time:', err))
        }

        if (payload.eventType === 'INSERT') {
            const { data } = await supabase
                .from('orders')
                .select(`id, status, total_amount, placed_at, session_id, booking_id, order_type, customer_name, customer_phone, delivery_address, sessions ( id, seat_number, tables ( id, label, room_id ) ), order_items ( id, quantity, status, unit_price, menu_items ( name ) )`)
                .eq('id', payload.new.id)
                .single()
            if (data) setActive(prev => [...prev, data as unknown as ActiveOrder])
        } else if (payload.eventType === 'UPDATE') {
            const { id, status, payment_status } = payload.new
            if (status === 'delivered' && payment_status === 'unpaid') {
                // Fetch full record to show in unpaid list
                const { data } = await supabase
                    .from('orders')
                    .select(`id, total_amount, delivered_at, payment_status, payment_method, session_id, booking_id, sessions ( id, seat_number, tables ( id, label, room_id ) ), order_items ( quantity, unit_price, menu_items ( name ) )`)
                    .eq('id', id)
                    .single()
                if (data) {
                    setUnpaid(prev => [...prev, data as unknown as UnpaidOrder])
                }
                setActive(prev => prev.filter(o => o.id !== id))
            } else if (payment_status === 'paid' || status === 'cancelled') {
                setUnpaid(prev => prev.filter(o => o.id !== id))
                setActive(prev => prev.filter(o => o.id !== id))
            } else {
                setActive(prev => prev.map(o => o.id === id ? { 
                    ...o, 
                    status, 
                    total_amount: payload.new.total_amount,
                    booking_id: payload.new.booking_id,
                    order_type: payload.new.order_type,
                    customer_name: payload.new.customer_name,
                    customer_phone: payload.new.customer_phone,
                    delivery_address: payload.new.delivery_address
                } : o))
            }
        }
    })

    const handleCashPay = async (orderId: string) => {
        setProcessingId(orderId)
        const res = await markDeliveredAndCashPaid(orderId)
        if (res.error) toast.error(res.error)
        else {
            setUnpaid(prev => prev.filter(o => o.id !== orderId))
            toast.success('Payment collected ✓')
        }
        setProcessingId(null)
    }

    // Seat-1 session ids of split tables — their orders must display as "4-1"
    // even though seat 1 alone can't tell it belongs to a split table.
    const splitSessionIds = useMemo(() => {
        const ids = new Set<string>()
        for (const t of tables as any[]) {
            if (t.activeSession && (t.otherActiveSessions?.length ?? 0) > 0) ids.add(t.activeSession.id)
        }
        return ids
    }, [tables])

    // One billing card per active session — a split table (Table 4-1, 4-2, ...)
    // settles each seat as its own independent bill, so each seat session becomes
    // its own entry with the seat-suffixed label and that seat's session as
    // `activeSession` (which is all the downstream items/total/checkout code reads).
    const billingTableEntries = useMemo(() => {
        const entries: any[] = []
        for (const t of tables as any[]) {
            const tableSessions = [t.activeSession, ...(t.otherActiveSessions || [])].filter(Boolean)
            for (const s of tableSessions) {
                if (s.booking_id) continue
                const split = tableSessions.length > 1 || (s.seat_number ?? 1) >= 2
                entries.push({
                    ...t,
                    label: split ? `${t.label}-${s.seat_number ?? 1}` : t.label,
                    activeSession: s,
                    otherActiveSessions: [],
                    uiKey: `${t.id}:${s.seat_number ?? 1}`,
                })
            }
        }
        return entries
    }, [tables])

    // Group unpaid by session
    const unpaidBySession = useMemo(() => {
        const groups = new Map<string, { label: string; orders: UnpaidOrder[]; total: number }>()
        for (const o of unpaid) {
            const key = o.session_id ?? o.id
            const label = tableLabel(o.sessions, splitSessionIds)
            if (!groups.has(key)) groups.set(key, { label, orders: [], total: 0 })
            const g = groups.get(key)!
            g.orders.push(o)
            g.total += o.total_amount ?? 0
        }
        return [...groups.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label))
    }, [unpaid, splitSessionIds])

    const activeDineIn = useMemo(() => active.filter(o => o.order_type === 'dine_in' || o.session_id !== null), [active])
    const activeTakeoutDelivery = useMemo(() => active.filter(o => o.order_type === 'takeout' || o.order_type === 'delivery'), [active])

    // Group active by session for the pipeline view
    const activePipeline = useMemo(() => {
        const groups = new Map<string, { label: string; orders: ActiveOrder[] }>()
        for (const o of activeDineIn) {
            const key = o.session_id ?? o.id
            const label = tableLabel(o.sessions, splitSessionIds)
            if (!groups.has(key)) groups.set(key, { label, orders: [] })
            groups.get(key)!.orders.push(o)
        }
        return [...groups.entries()].sort(([, a], [, b]) => a.label.localeCompare(b.label))
    }, [activeDineIn, splitSessionIds])

    const handleUpdateStatus = async (orderId: string, status: 'confirmed' | 'cancelled') => {
        const res = await updateTakeoutStatusAction(orderId, status)
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`Order ${status === 'confirmed' ? 'confirmed' : 'cancelled'}`)
            if (status === 'cancelled') {
                setActive(prev => prev.filter(o => o.id !== orderId))
            } else {
                setActive(prev => prev.map(o => o.id === orderId ? { ...o, status: 'confirmed' } : o))
            }
        }
    }

    const totalUnpaid = unpaid.reduce((s, o) => s + (o.total_amount ?? 0), 0)

    const tabs: { id: 'rooms' | 'tables' | 'space' | 'takeaway' | 'billing'; label: string }[] = isHotel ? [
        { id: 'rooms', label: 'Rooms' },
        { id: 'tables', label: 'Tables' },
        { id: 'takeaway', label: 'Takeaway/Delivery' },
        { id: 'billing', label: 'Billing' },
    ] : [
        { id: 'space', label: 'Space' },
        { id: 'takeaway', label: 'Takeaway/Delivery' },
        { id: 'billing', label: 'Billing' },
    ]

    return (
        <div className="space-y-5">
            {/* Header Actions Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface rounded-2xl border border-hairline p-4 shadow-sm">
                <div>
                    <h2 className="text-lg font-black text-ink">Cashier POS Dashboard</h2>
                    <p className="text-caption text-ink-subtle">Manage table orders, room stays, billing, and settlements.</p>
                </div>

            </div>

            {/* Cashier Tab Navigation */}
            <div className={`grid ${isHotel ? 'grid-cols-4' : 'grid-cols-3'} border-b border-hairline mb-4 bg-surface sticky top-14 z-20 -mx-3 px-3 md:mx-0 md:px-0`}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center justify-center gap-1.5 py-4 text-xs md:text-sm font-bold whitespace-nowrap transition-colors relative focus:outline-none w-full ${
                                isActive ? 'text-[var(--brand-500)]' : 'text-ink-muted hover:text-ink'
                            }`}
                        >
                            {tab.id === 'takeaway' && activeTakeoutDelivery.length > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {activeTakeoutDelivery.length}
                                </span>
                            )}
                            {tab.id === 'billing' && unpaid.length > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-red-100 text-red-700'
                                }`}>
                                    {unpaid.length}
                                </span>
                            )}
                            <span>{tab.label}</span>
                            {isActive && (
                                <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[var(--brand-500)] rounded-t-full" />
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Tab Contents */}
            <div>
                {activeTab === 'rooms' && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Sticky Sub-tabs / Filters for Rooms */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className="grid grid-cols-6 gap-1.5 sm:gap-2.5 w-full">
                                {([
                                    { key: 'all', label: 'ALL', count: roomsCounts.all },
                                    { key: 'available', label: 'Available', count: roomsCounts.available },
                                    { key: 'reserve', label: 'Reserve', count: roomsCounts.reserve },
                                    { key: 'occupied', label: 'Occupied', count: roomsCounts.occupied },
                                    { key: 'dirty', label: 'Dirty', count: roomsCounts.dirty },
                                    { key: 'closed', label: 'Closed', count: roomsCounts.closed }
                                ] as const).map(({ key, label, count }) => {
                                    const isActive = roomsFilter === key
                                    const activeColors = {
                                        all: 'bg-[var(--color-primary)] text-white',
                                        available: 'bg-emerald-500 text-white',
                                        reserve: 'bg-blue-500 text-white',
                                        occupied: 'bg-indigo-500 text-white',
                                        dirty: 'bg-amber-500 text-white',
                                        closed: 'bg-rose-500 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setRoomsFilter(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2 px-1 sm:py-2.5 sm:px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <CashierRoomManager
                            rooms={roomsState}
                            setRooms={setRoomsState}
                            bookings={bookings}
                            setBookings={setBookings}
                            restaurantId={restaurantId}
                            partnerRestaurantId={partnerRestaurantId}
                            roomsFilter={roomsFilter}
                            tables={tables}
                            activeOrders={active}
                            unpaidOrders={unpaid}
                            onGoToBilling={(room) => {
                                setActiveTab('billing')
                                setBillingSubTab('rooms')
                                setSelectedBillingRoom(room)
                            }}
                            onOrderPlaced={async (orderId) => {
                                const supabase = supabaseRef.current
                                const { data } = await supabase
                                    .from('orders')
                                    .select(`id, status, total_amount, placed_at, session_id, booking_id, order_type, customer_name, customer_phone, delivery_address, sessions ( id, seat_number, tables ( id, label, room_id ) ), order_items ( id, quantity, status, unit_price, menu_items ( name ) )`)
                                    .eq('id', orderId)
                                    .single()
                                if (data) {
                                    setActive(prev => {
                                        if (prev.some(o => o.id === orderId)) {
                                            return prev.map(o => o.id === orderId ? (data as unknown as ActiveOrder) : o)
                                        }
                                        return [...prev, data as unknown as ActiveOrder]
                                    })
                                }
                            }}
                        />
                    </div>
                )}

                {(activeTab === 'space' || activeTab === 'tables') && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Sticky Sub-tabs / Filters */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className={`flex overflow-x-auto no-scrollbar gap-1.5 sm:gap-2.5 w-full py-1 sm:grid ${isHotel ? 'sm:grid-cols-4' : 'sm:grid-cols-5'}`}>
                                {([
                                    { key: 'all', label: 'ALL', count: spaceCounts.all },
                                    { key: 'available', label: 'Available', count: spaceCounts.available },
                                    { key: 'reserved', label: 'Reserved', count: spaceCounts.reserved },
                                    { key: 'dirty', label: 'Dirty', count: spaceCounts.dirty },
                                    { key: 'occupied', label: 'Occupied', count: spaceCounts.occupied }
                                ] as const)
                                .filter(({ key }) => !(isHotel && key === 'dirty'))
                                .map(({ key, label, count }) => {
                                    const isActive = spaceFilter === key
                                    const activeColors = {
                                        all: 'bg-[var(--color-primary)] text-white',
                                        available: 'bg-emerald-500 text-white',
                                        reserved: 'bg-blue-500 text-white',
                                        occupied: 'bg-brand-500 text-white',
                                        dirty: 'bg-amber-500 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setSpaceFilter(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2 px-3 sm:py-2.5 sm:px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 shrink-0 w-auto sm:w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        <CashierTableManager
                            initialTables={tables}
                            restaurantId={restaurantId}
                            activeOrders={active}
                            unpaidOrders={unpaid}
                            userId={userId}
                            spaceFilter={spaceFilter}
                            onSwitchToBilling={(sessionId) => {
                                setActiveTab('billing')
                                setHighlightSessionId(sessionId)
                            }}
                            isHotel={isHotel}
                        />
                    </div>
                )}

                {activeTab === 'takeaway' && (
                    <div className="flex flex-col gap-4 w-full">
                        {/* Top action row */}
                        <div className="flex justify-between items-center bg-surface rounded-2xl border border-hairline p-4 shadow-sm">
                            <div>
                                <h3 className="text-sm font-bold text-ink-muted">Takeaway &amp; Delivery Panel</h3>
                                <p className="text-caption text-ink-subtle">Monitor status and manage takeaway/delivery orders.</p>
                            </div>
                            <button 
                                onClick={() => {
                                    if (restaurantSlug) {
                                        window.open(`/takeout/${restaurantSlug}`, '_blank')
                                    } else {
                                        toast.error('Restaurant slug not found')
                                    }
                                }}
                                className="bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] font-extrabold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition shadow-sm"
                            >
                                Manual Takeaway/Delivery
                            </button>
                        </div>

                        {/* Sub-tabs / Filters */}
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex items-center w-full justify-center">
                            <div className="grid grid-cols-2 gap-2 sm:gap-4 w-full">
                                {([
                                    { key: 'takeaway', label: 'Takeaway orders', count: activeTakeoutDelivery.filter(o => o.order_type === 'takeout').length },
                                    { key: 'delivery', label: 'Delivery orders', count: activeTakeoutDelivery.filter(o => o.order_type === 'delivery').length }
                                ] as const).map(({ key, label, count }) => {
                                    const isActive = takeawaySubTab === key
                                    const activeColors = {
                                        takeaway: 'bg-amber-500 text-white',
                                        delivery: 'bg-purple-600 text-white',
                                    }
                                    
                                     return (
                                        <button
                                            key={key}
                                            onClick={() => setTakeawaySubTab(key)}
                                            className={`relative flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all active:scale-95 w-full whitespace-nowrap ${
                                                isActive 
                                                    ? activeColors[key] 
                                                    : 'bg-surface border border-hairline text-ink-subtle hover:bg-surface-muted hover:text-ink-muted shadow-sm'
                                            }`}
                                        >
                                            {count > 0 && (
                                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                                    isActive ? 'bg-surface/20 text-white' : 'bg-red-100 text-red-700'
                                                }`}>
                                                    {count}
                                                </span>
                                            )}
                                            <span>{label}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* List grid */}
                        <div className="bg-surface rounded-[24px] border border-hairline p-5 shadow-sm">
                            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                                {activeTakeoutDelivery.filter(o => o.order_type === (takeawaySubTab === 'takeaway' ? 'takeout' : 'delivery')).length === 0 ? (
                                    <div className="col-span-full py-12 text-center text-xs text-ink-subtle font-semibold">
                                        No active {takeawaySubTab === 'takeaway' ? 'takeaway' : 'delivery'} orders
                                    </div>
                                ) : (
                                    activeTakeoutDelivery.filter(o => o.order_type === (takeawaySubTab === 'takeaway' ? 'takeout' : 'delivery')).map(order => {
                                        const statusColors = {
                                            pending: 'border-yellow-200 bg-yellow-50/10 text-yellow-700',
                                            confirmed: 'border-blue-200 bg-blue-50/10 text-blue-700',
                                            preparing: 'border-brand-200 bg-brand-50/10 text-orange-700',
                                            ready: 'border-emerald-200 bg-emerald-50/10 text-emerald-700',
                                        } as any
                                        const cls = statusColors[order.status] || 'border-hairline bg-surface text-ink-subtle'

                                        return (
                                            <button
                                                key={order.id}
                                                onClick={() => setSelectedOrder(order)}
                                                className={`aspect-square rounded-[20px] border flex flex-col items-center justify-center p-3 text-center transition-all duration-300 ${cls} hover:-translate-y-1 hover:shadow-md active:scale-95`}
                                            >
                                                <span className="text-sm font-black tracking-tight text-ink block font-mono">
                                                    #{order.id.slice(0, 4).toUpperCase()}
                                                </span>
                                                <span className="text-[9px] font-extrabold uppercase tracking-wide mt-2.5 px-2 py-0.5 rounded bg-surface/60 border border-black/5 shadow-sm">
                                                    {order.status === 'ready' ? 'Ready' : order.status}
                                                </span>
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'billing' && (
                    <div className="space-y-5">
                        {/* Online payment claims (UPI/card) awaiting verification */}
                        <PaymentVerificationFeed
                            initialClaims={initialClaims}
                            restaurantId={restaurantId}
                            userId={userId}
                            onPendingCountChange={setPendingClaims}
                        />
                        {/* Awaiting Payment section */}
                        <div>
                            {isHotel && (
                                <div className="border-b border-hairline pb-3 mb-4 flex items-center justify-between">
                                    <h2 className="text-sm font-semibold text-ink-muted flex items-center gap-2">
                                        <Receipt size={14} className="text-red-400" />
                                        Awaiting Settlement
                                    </h2>
                                    <div className="flex bg-surface-muted p-1 rounded-xl border border-hairline">
                                        <button
                                            onClick={() => setBillingSubTab('rooms')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'rooms' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Rooms ({roomsState.filter(r => r.status === 'occupied').length})
                                        </button>
                                        <button
                                            onClick={() => setBillingSubTab('tables')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'tables' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Tables ({billingTableEntries.length})
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!isHotel && (
                                <h2 className="text-sm font-semibold text-ink-muted mb-4 flex items-center gap-2">
                                    <Receipt size={14} className="text-red-400" />
                                    Awaiting Payment
                                </h2>
                            )}

                            {((isHotel && billingSubTab === 'rooms') ? roomsState.filter(r => r.status === 'occupied') : billingTableEntries).length === 0 ? (
                                <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-10 text-center">
                                    <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
                                    <p className="text-sm font-medium text-ink-subtle">All bills settled</p>
                                    <p className="text-xs text-gray-300 mt-1">No pending payments in this category</p>
                                </div>
                            ) : (
                                <div>
                                    {isHotel && billingSubTab === 'rooms' ? (
                                        // Occupied Rooms Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {roomsState.filter(r => r.status === 'occupied').map(room => {
                                                const booking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
                                                const stayCost = calculateStayCost(room, booking)
                                                const qrOrdersTotal = getRoomQrOrders(room).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
                                                const total = stayCost + qrOrdersTotal
                                                
                                                return (
                                                    <button
                                                        key={room.id}
                                                        onClick={() => setSelectedBillingRoom(room)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight">
                                                            Room {room.room_number}
                                                        </span>
                                                        {booking && (
                                                            <span className="text-[10px] font-bold text-ink-subtle mt-1.5 truncate max-w-full">
                                                                {booking.guest_name}
                                                            </span>
                                                        )}
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            Awaiting Pay
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        // Occupied Tables Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {billingTableEntries.map(table => {
                                                const sessionItems = getTableSessionItems(table)
                                                const total = sessionItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)

                                                return (
                                                    <button
                                                        key={table.uiKey}
                                                        onClick={() => setSelectedBillingTable(table)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight">
                                                            Table {table.label}
                                                        </span>
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            {sessionItems.length} items unpaid
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>



                        {/* Active Pipeline — read-only overview for cashier */}
                        {/* Active Pipeline — read-only overview for cashier */}
                        {!isHotel && activePipeline.length > 0 && (
                            <div>
                                <h2 className="text-sm font-semibold text-ink-muted mb-3 flex items-center gap-2">
                                    <ChefHat size={14} className="text-orange-400" />
                                    In Pipeline (Dine-In)
                                    <span className="ml-1 bg-brand-100 text-brand-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{activeDineIn.length}</span>
                                </h2>
                                <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden">
                                    <div className="divide-y divide-gray-50">
                                        {activePipeline.map(([sessionKey, { label, orders: tableOrders }]) => {
                                            const worstStatus = tableOrders.some(o => o.status === 'ready') ? 'ready'
                                                : tableOrders.some(o => o.status === 'preparing') ? 'preparing'
                                                : 'pending'
                                            const statusConfig = {
                                                ready:    { dot: 'bg-emerald-500 animate-pulse', label: 'Ready',    cls: 'text-emerald-700' },
                                                preparing:{ dot: 'bg-brand-400 animate-pulse',  label: 'Cooking',  cls: 'text-orange-700' },
                                                pending:  { dot: 'bg-amber-300',                 label: 'Pending',  cls: 'text-amber-700' },
                                            }
                                            const sc = statusConfig[worstStatus]
                                            const total = tableOrders.reduce((s, o) => s + (o.total_amount ?? 0), 0)

                                            return (
                                                <div key={sessionKey} className="px-4 py-3 flex items-center gap-3">
                                                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${sc.dot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-sm text-ink">Table {label}</span>
                                                            <span className={`text-[10px] font-semibold ${sc.cls}`}>{sc.label}</span>
                                                        </div>
                                                        <p className="text-xs text-ink-subtle mt-0.5">
                                                            {tableOrders.length} order{tableOrders.length !== 1 ? 's' : ''}
                                                        </p>
                                                    </div>
                                                    <span className="text-sm font-semibold text-ink-muted tabular-nums shrink-0">{money(total)}</span>
                                                    <Clock size={13} className="text-gray-300 shrink-0" />
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {unpaid.length === 0 && (isHotel ? true : activePipeline.length === 0) && activeTakeoutDelivery.length === 0 && pendingClaims === 0 && (
                            <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-12 text-center">
                                <CreditCard size={36} className="mx-auto text-gray-200 mb-3" />
                                <p className="text-base font-semibold text-ink-subtle">All quiet at the counter</p>
                                <p className="text-sm text-gray-350 mt-1">No active orders or pending payments</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Takeaway/Delivery Order Detail Modal */}
            {mounted && selectedOrder && createPortal(
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setSelectedOrder(null)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md overflow-hidden transform transition-all"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-h3 font-black text-ink font-mono">
                                    Order #{selectedOrder.id.substring(0, 6).toUpperCase()}
                                </h3>
                                <p className="text-caption text-ink-subtle mt-0.5 capitalize">
                                    {selectedOrder.order_type} · {selectedOrder.status}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedOrder(null)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
                            {/* Customer info */}
                            <div className="space-y-1 text-xs text-ink-muted bg-surface-muted p-3.5 rounded-xl border border-hairline">
                                <p className="font-bold text-ink text-sm">{selectedOrder.customer_name || 'Customer'}</p>
                                <p className="font-mono">{selectedOrder.customer_phone}</p>
                                {selectedOrder.order_type === 'delivery' && selectedOrder.delivery_address && (
                                    <p className="text-ink-subtle italic mt-1 bg-surface p-2.5 rounded border border-hairline">
                                        {selectedOrder.delivery_address}
                                    </p>
                                )}
                            </div>

                            {/* Order Items */}
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Order Items</h4>
                                <div className="space-y-2 border border-hairline rounded-xl p-3 bg-surface-muted/50 divide-y divide-gray-100">
                                    {(selectedOrder.order_items || []).map((item, idx) => {
                                        const price = Number(item.unit_price ?? 0)
                                        const qty = item.quantity || 0
                                        return (
                                            <div key={idx} className="flex justify-between items-center py-2 text-xs">
                                                <div className="flex-1 min-w-0 pr-2">
                                                    <p className="font-extrabold text-ink truncate text-[13px]">
                                                        {item.menu_items?.name || 'Item'}
                                                    </p>
                                                    <p className="text-[10px] text-ink-subtle capitalize">
                                                        Status: <span className="text-brand-500 font-extrabold">{item.status || selectedOrder.status}</span>
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-3 shrink-0">
                                                    <span className="text-xs font-extrabold text-brand-600 bg-brand-50 border border-brand-100/50 px-2 py-0.5 rounded-lg tabular-nums">
                                                        {qty}×
                                                    </span>
                                                    <span className="font-semibold text-ink-muted tabular-nums">
                                                        {money(price * qty)}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Total Amount & Prepaid status */}
                            <div className="flex flex-col gap-2 pt-3 border-t border-hairline">
                                <div className="flex justify-between items-center font-bold text-sm">
                                    <span className="text-ink-muted">Total Amount:</span>
                                    <span className="text-brand-600 text-base tabular-nums">{money(selectedOrder.total_amount)}</span>
                                </div>

                                <div className="flex items-center justify-between mt-1 text-xs">
                                    <span className="text-ink-subtle font-bold">Payment Status:</span>
                                    {selectedOrder.payment_status === 'paid' ? (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold px-3 py-1 rounded-full text-[10px]">
                                            ✓ Prepaid
                                        </span>
                                    ) : (
                                        <span className="bg-red-50 text-red-700 border border-red-200 font-extrabold px-3 py-1 rounded-full text-[10px]">
                                            Awaiting Payment
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons if Pending */}
                            {selectedOrder.status === 'pending' && (
                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    <button
                                        onClick={async () => {
                                            await handleUpdateStatus(selectedOrder.id, 'cancelled')
                                            setSelectedOrder(null)
                                        }}
                                        className="w-full bg-surface border border-red-200 text-red-700 hover:bg-red-50 font-extrabold text-xs py-3 rounded-xl transition duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-1.5"
                                    >
                                        Cancel Order
                                    </button>
                                    <button
                                        onClick={async () => {
                                            await handleUpdateStatus(selectedOrder.id, 'confirmed')
                                            setSelectedOrder(null)
                                        }}
                                        className="w-full bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] font-extrabold text-xs py-3 rounded-xl transition duration-200 active:scale-95 shadow-sm flex items-center justify-center gap-1.5"
                                    >
                                        Confirm Order
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Billing Stay Details modal */}
            {mounted && selectedBillingRoom && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingRoom(null)}
                >
                    <div 
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline flex flex-col max-h-[90vh] md:max-h-[85vh] animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-surface-muted/50 flex-shrink-0">
                            <div>
                                <h3 className="text-lg font-black text-ink">Room {selectedBillingRoom.room_number} stays details</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">{selectedBillingRoom.room_types?.name} • Floor {selectedBillingRoom.floor || 'N/A'}</p>
                            </div>
                            <button onClick={() => setSelectedBillingRoom(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        {loadingStayDetails ? (
                            <div className="p-6 flex-1 flex flex-col items-center justify-center gap-3">
                                <Loader2 size={32} className="animate-spin text-brand-500" />
                                <p className="text-xs text-ink-subtle font-semibold">Loading details...</p>
                            </div>
                        ) : billingStayBooking ? (
                            <>
                                <div className="space-y-6 p-6 overflow-y-auto flex-1">
                                <div className="grid grid-cols-2 gap-4 bg-surface-muted/50 border border-hairline rounded-2xl p-4 text-xs">
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest</p>
                                        <p className="font-extrabold text-ink text-sm">{billingStayBooking.guest_name}</p>
                                        <p className="font-semibold text-ink-muted">{billingStayBooking.guest_phone}</p>
                                    </div>
                                    <div className="space-y-1 text-right border-l border-hairline pl-4">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase">Stay schedule</p>
                                        <p className="font-semibold text-ink-muted">In: {formatDateTime(billingStayBooking.check_in)}</p>
                                        <p className="font-semibold text-ink-muted">Out: {formatDateTime(billingStayBooking.check_out)}</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Stay billing breakdown</h4>
                                    <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface">
                                        <div className="flex justify-between items-center p-4 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">Room Stay Cost</p>
                                                <p className="text-[10px] text-ink-subtle">{money(selectedBillingRoom.room_types?.base_price || 0)} / Night</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(calculateStayCost(selectedBillingRoom, billingStayBooking))}</span>
                                        </div>

                                        {billingLinkedOrders.length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-indigo-650 font-semibold">Service Orders (QR + Dining)</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                                                    {billingLinkedOrders.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span>{item.menu_items?.name || 'Item'} ({item.quantity}×)</span>
                                                            <span className="tabular-nums font-semibold">{money(Number(item.unit_price) * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {billingRoomCharges.length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-amber-650 font-semibold">Additional stay charges</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-amber-100">
                                                    {billingRoomCharges.map((c) => (
                                                        <div key={c.id} className="flex justify-between text-[10px] text-ink-muted">
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
                                {irdSyncEnabled && (
                                <div className="pt-4">
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Payment Method</p>
                                    <div className="grid grid-cols-4 gap-2">
                                        <button
                                            onClick={() => setBillingPaymentMethod('cash')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'cash'
                                                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                    : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                                            Cash
                                        </button>
                                        <button
                                            onClick={() => setBillingPaymentMethod('qr_digital')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'qr_digital'
                                                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                    : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                                            QR / Digital
                                        </button>
                                        <button
                                            onClick={() => {
                                                setBillingPaymentMethod('both')
                                                setSplitCashAmount('')
                                                setSplitQrAmount('')
                                            }}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'both'
                                                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                    : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                                            Both
                                        </button>
                                        <button
                                            onClick={() => setBillingPaymentMethod('credit')}
                                            className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                billingPaymentMethod === 'credit'
                                                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                    : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                            }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 9V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M22 17v-1a2 2 0 0 0-2-2h-1"/><rect width="8" height="8" x="14" y="14" rx="2"/></svg>
                                            Credit
                                        </button>
                                    </div>

                                    {billingPaymentMethod === 'credit' && (
                                        <p className="mt-3 text-[10px] text-ink-subtle font-semibold text-center">
                                            You&apos;ll confirm the customer&apos;s name and phone in the next step.
                                        </p>
                                    )}

                                    {/* Split amount inputs — shown only when Both is selected */}
                                    {billingPaymentMethod === 'both' && (() => {
                                        const total = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                        const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                        const balanceDue = Math.max(0, total - advancePaid)
                                        return (
                                            <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-surface-muted/40 border border-hairline rounded-2xl">
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
                                                    const grandTotal = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                                    const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                                    const balanceDue = Math.max(0, grandTotal - advancePaid)
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
                                        )
                                    })()}

                                    {(billingPaymentMethod === 'qr_digital' || billingPaymentMethod === 'both') && qrCodes.length > 1 && (
                                        <div className="mt-3">
                                            <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Which QR did the guest scan?</label>
                                            <select
                                                value={billingQrCodeId}
                                                onChange={e => setBillingQrCodeId(e.target.value)}
                                                className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                            >
                                                <option value="">Select QR code…</option>
                                                {qrCodes.map(qr => (
                                                    <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                            <div className="border-t border-hairline px-6 py-4 flex-shrink-0 bg-surface">
                                    {/* Gross Total + Advance row */}
                                    {(() => {
                                        const grandTotal = calculateGrandTotal(selectedBillingRoom, billingStayBooking)
                                        const advancePaid = Number(billingStayBooking?.paid_amount) || 0
                                        const balanceDue = Math.max(0, grandTotal - advancePaid)
                                        return (
                                            <>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-bold text-ink-subtle uppercase">Total bill amount</span>
                                                    <span className="text-sm font-black text-ink-muted tabular-nums">{money(grandTotal)}</span>
                                                </div>
                                                {advancePaid > 0 && (
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1">
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                            Advance Paid ({advanceMethodLabel(billingStayBooking?.advance_payment_method)})
                                                        </span>
                                                        <span className="text-sm font-black text-emerald-600 tabular-nums">− {money(advancePaid)}</span>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between pt-1 border-t border-dashed border-hairline">
                                                    <div>
                                                        <span className="text-[10px] font-bold text-ink-subtle uppercase">{advancePaid > 0 ? 'Balance Due' : 'Total Due'}</span>
                                                        <p className="text-2xl font-black text-brand-600 tabular-nums">{money(balanceDue)}</p>
                                                    </div>
                                                    <div className="flex gap-2 items-center">
                                                        <Button variant="secondary" onClick={() => setSelectedBillingRoom(null)}>Close</Button>
                                                        {!irdSyncEnabled ? (
                                                            <Button
                                                                variant="primary"
                                                                loading={isDirectCheckingOut}
                                                                onClick={() => handleCloseGuestDirectly(selectedBillingRoom)}
                                                                className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs animate-scale-in"
                                                            >
                                                                Close Guest
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="primary"
                                                                onClick={() => compileInvoice('room', selectedBillingRoom)}
                                                                className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs animate-scale-in"
                                                            >
                                                                Generate Invoice
                                                            </Button>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    })()}
                                </div>
                            </>
                        ) : (
                            <div className="p-6 flex-1 flex items-center justify-center">
                                <div className="p-8 text-center border border-dashed border-hairline-strong rounded-xl w-full">
                                    <p className="text-sm text-ink-subtle">No active booking session found.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {/* Billing Table Details modal */}
            {mounted && selectedBillingTable && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingTable(null)}
                >
                    <div 
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline p-6 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline pb-4">
                            <div>
                                <h3 className="text-lg font-black text-ink">Table {selectedBillingTable.label} details</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">Capacity: {selectedBillingTable.capacity} Seats</p>
                            </div>
                            <button onClick={() => setSelectedBillingTable(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Session order items</h4>
                            {getTableSessionItems(selectedBillingTable).length > 0 ? (
                                <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface p-4 space-y-2">
                                    {getTableSessionItems(selectedBillingTable).map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center py-1.5 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">{item.name}</p>
                                                <p className="text-[10px] text-ink-subtle">Qty: {item.quantity} × {money(item.unitPrice)}</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(item.unitPrice * item.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center border border-dashed border-hairline-strong rounded-xl text-xs text-ink-subtle font-semibold">
                                    No items ordered in this session yet
                                </div>
                            )}
                        </div>

                        {(() => {
                            // The authoritative, tax-inclusive total — matches
                            // exactly what /api/tables/checkout bills off
                            // (orders.total_amount), unlike the raw item list
                            // above which is pre-tax and would understate it.
                            const itemsSubtotal = getTableSessionItems(selectedBillingTable).reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0)
                            const tableSubtotal = getTableSessionOrdersTotal(selectedBillingTable)
                            const taxOrServiceAdjustment = tableSubtotal - itemsSubtotal
                            const bargainRateEntered = tableBargainRate.trim() !== ''
                            const bargainRateValue = bargainRateEntered ? parseFloat(tableBargainRate) || 0 : tableSubtotal
                            const tableDiscountAmount = bargainRateEntered ? Math.max(0, tableSubtotal - bargainRateValue) : 0
                            const tableDiscountInvalid = bargainRateEntered && (bargainRateValue < 0 || bargainRateValue > tableSubtotal)
                            const tableTotal = tableSubtotal - tableDiscountAmount

                            return (
                                <>
                                    {Math.abs(taxOrServiceAdjustment) > 0.01 && (
                                        <div className="flex justify-between items-center px-1 text-xs">
                                            <span className="text-ink-subtle font-semibold">Tax / Service charge</span>
                                            <span className="font-bold text-ink-muted tabular-nums">{money(taxOrServiceAdjustment)}</span>
                                        </div>
                                    )}

                                    {/* Bargain rate */}
                                    <div className="border-2 border-amber-200 rounded-2xl p-4 space-y-3 bg-amber-50/60 shadow-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                                    <Percent size={14} className="text-amber-700" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Bargain Rate</p>
                                                    <p className="text-[10px] text-amber-700/70 font-semibold">Standard total: {money(tableSubtotal)}</p>
                                                </div>
                                            </div>
                                            <div className="relative w-32">
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={tableSubtotal}
                                                    placeholder={tableSubtotal.toFixed(2)}
                                                    value={tableBargainRate}
                                                    onChange={e => setTableBargainRate(e.target.value)}
                                                    className={`w-full pl-7 pr-2 py-2 border-2 rounded-xl text-xs font-bold bg-white focus:outline-none ${tableDiscountInvalid ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                />
                                            </div>
                                        </div>
                                        {tableDiscountInvalid && (
                                            <p className="text-[9px] text-rose-500 font-bold">Rate must be between Rs. 0 and the standard total.</p>
                                        )}
                                        {tableDiscountAmount > 0 && (
                                            <div>
                                                <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Reason (required)</label>
                                                <input
                                                    type="text"
                                                    value={tableBargainReason}
                                                    onChange={e => setTableBargainReason(e.target.value)}
                                                    placeholder="e.g. Repeat guest, manager approved"
                                                    className="w-full px-3 py-2 border-2 border-amber-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-amber-500"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment Method Selector */}
                                    {irdSyncEnabled && (
                                    <div>
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Payment Method</p>
                                        <div className="grid grid-cols-4 gap-2">
                                            <button
                                                onClick={() => setBillingPaymentMethod('cash')}
                                                className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                    billingPaymentMethod === 'cash'
                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                        : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                                }`}
                                            >
                                                <Banknote size={15} />
                                                Cash
                                            </button>
                                            <button
                                                onClick={() => setBillingPaymentMethod('qr_digital')}
                                                className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                    billingPaymentMethod === 'qr_digital'
                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                        : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                                }`}
                                            >
                                                <CreditCard size={15} />
                                                QR / Digital
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setBillingPaymentMethod('both')
                                                    setSplitCashAmount('')
                                                    setSplitQrAmount('')
                                                }}
                                                className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                    billingPaymentMethod === 'both'
                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                        : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                                }`}
                                            >
                                                <Receipt size={15} />
                                                Both
                                            </button>
                                            <button
                                                onClick={() => setBillingPaymentMethod('credit')}
                                                className={`flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-2xl border-2 text-xs font-bold transition-all duration-150 ${
                                                    billingPaymentMethod === 'credit'
                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                        : 'border-hairline bg-surface text-ink-muted hover:border-brand-300 hover:text-brand-500'
                                                }`}
                                            >
                                                <ShoppingBag size={15} />
                                                Credit
                                            </button>
                                        </div>

                                        {billingPaymentMethod === 'both' && (
                                            <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-surface-muted/40 border border-hairline rounded-2xl">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Cash Amount</label>
                                                    <div className="relative">
                                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={tableTotal}
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
                                                            max={tableTotal}
                                                            placeholder="0.00"
                                                            value={splitQrAmount}
                                                            onChange={e => setSplitQrAmount(e.target.value)}
                                                            className="w-full pl-7 pr-2 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                        />
                                                    </div>
                                                </div>
                                                {(() => {
                                                    const cash = parseFloat(splitCashAmount) || 0
                                                    const qr = parseFloat(splitQrAmount) || 0
                                                    const remainder = tableTotal - cash - qr
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

                                        {billingPaymentMethod === 'qr_digital' && qrCodes.length > 1 && (
                                            <div className="mt-3">
                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Which QR did the guest scan?</label>
                                                <select
                                                    value={billingQrCodeId}
                                                    onChange={e => setBillingQrCodeId(e.target.value)}
                                                    className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                >
                                                    <option value="">Select QR code…</option>
                                                    {qrCodes.map(qr => (
                                                        <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {billingPaymentMethod === 'credit' && (
                                            <p className="mt-3 text-[10px] text-ink-subtle font-semibold text-center">
                                                You&apos;ll confirm the customer&apos;s name and phone in the next step.
                                            </p>
                                        )}
                                    </div>
                                    )}

                                    <div className="border-t border-hairline pt-4 flex items-center justify-between mt-2">
                                        <div>
                                            <span className="text-[10px] font-bold text-ink-subtle uppercase">Total session bill</span>
                                            <p className="text-2xl font-black text-brand-600 tabular-nums">{money(tableTotal)}</p>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <Button variant="secondary" onClick={() => setSelectedBillingTable(null)}>Close</Button>
                                            {!irdSyncEnabled ? (
                                                <Button
                                                    variant="primary"
                                                    onClick={() => {
                                                        const data = buildInvoiceData('table', selectedBillingTable)
                                                        if (data) {
                                                            setActiveInvoice(data)
                                                        }
                                                    }}
                                                    className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs animate-scale-in"
                                                 >
                                                     Close Guest
                                                 </Button>
                                            ) : (
                                                <Button
                                                    variant="primary"
                                                    disabled={
                                                        tableDiscountInvalid ||
                                                        (tableDiscountAmount > 0 && !tableBargainReason.trim())
                                                    }
                                                    onClick={() => compileInvoice('table', selectedBillingTable)}
                                                    className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs animate-scale-in"
                                                >
                                                    Generate Invoice
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )
                        })()}
                    </div>
                </div>,
                document.body
            )}

            {/* Settlement Confirmation modal — gates every 'both' or 'credit'
                settlement (room or table) behind one explicit confirm step,
                showing the exact Cash/QR/Credit breakdown so a typo in the
                split amounts (not just a deliberate part-credit sale) gets
                caught before anything is charged, and collecting the
                customer's name/phone right here when credit is involved. */}
            {mounted && showSettlementConfirm && pendingInvoice && createPortal(
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100000] flex items-center justify-center p-4 animate-in fade-in duration-200"
                    onClick={cancelSettlementConfirm}
                >
                    <div
                        className="bg-surface w-full max-w-sm rounded-[28px] shadow-2xl border border-hairline p-6 space-y-4 animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div>
                            <h3 className="text-lg font-black text-ink">Confirm Settlement</h3>
                            <p className="text-xs text-ink-subtle mt-0.5">{pendingInvoice.data.label}</p>
                        </div>

                        <div className="border border-hairline rounded-2xl p-4 space-y-2 text-xs">
                            {pendingInvoice.data.cashPaid > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-ink-subtle font-semibold">Cash</span>
                                    <span className="font-bold text-ink tabular-nums">{money(pendingInvoice.data.cashPaid)}</span>
                                </div>
                            )}
                            {pendingInvoice.data.qrPaid > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-ink-subtle font-semibold">QR / Digital</span>
                                    <span className="font-bold text-ink tabular-nums">{money(pendingInvoice.data.qrPaid)}</span>
                                </div>
                            )}
                            {pendingInvoice.data.creditPaid > 0.01 && (
                                <div className="flex justify-between">
                                    <span className="text-amber-700 font-semibold">On Credit</span>
                                    <span className="font-bold text-amber-700 tabular-nums">{money(pendingInvoice.data.creditPaid)}</span>
                                </div>
                            )}
                            <div className="flex justify-between pt-2 border-t border-dashed border-hairline">
                                <span className="text-[10px] font-bold text-ink-subtle uppercase">Total</span>
                                <span className="font-black text-ink tabular-nums">{money(pendingInvoice.data.total)}</span>
                            </div>
                        </div>

                        {pendingInvoice.data.overpaid ? (
                            <p className="text-[11px] text-rose-500 font-bold text-center">
                                ⚠ Cash + QR exceeds the total — go back and fix the split before continuing.
                            </p>
                        ) : pendingInvoice.data.creditPaid > 0.01 && (
                            <div className="space-y-3">
                                <p className="text-[11px] text-amber-700 font-semibold">
                                    {money(pendingInvoice.data.creditPaid)} will be added to this customer&apos;s credit account — enter their details to continue:
                                </p>
                                <div>
                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Customer Name</label>
                                    <input
                                        type="text"
                                        value={creditCustomerName}
                                        onChange={e => setCreditCustomerName(e.target.value)}
                                        placeholder="Customer name"
                                        className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Phone</label>
                                    <input
                                        type="tel"
                                        value={creditCustomerPhone}
                                        onChange={e => setCreditCustomerPhone(e.target.value)}
                                        placeholder="98XXXXXXXX"
                                        className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button variant="secondary" className="flex-1" onClick={cancelSettlementConfirm}>Cancel</Button>
                            <Button
                                variant="primary"
                                className="flex-1 bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 text-white font-bold"
                                disabled={
                                    pendingInvoice.data.overpaid ||
                                    (pendingInvoice.data.creditPaid > 0.01 && (!creditCustomerName.trim() || !creditCustomerPhone.trim()))
                                }
                                onClick={finalizeSettlementConfirm}
                            >
                                Confirm &amp; Continue
                            </Button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Invoice Preview Overlay modal */}
            {mounted && activeInvoice && createPortal(
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
                    onClick={() => { if (!invoiceSettled) setActiveInvoice(null) }}
                >
                    <div
                        className="bg-white w-full max-w-sm p-5 space-y-4 shadow-2xl relative border-t-8 border-brand-500"
                        onClick={e => e.stopPropagation()}
                    >
                        <InvoiceReceipt invoice={activeInvoice} money={money} />

                        {/* Invoice Footer Actions (Print, Mark Paid, Close) */}
                        <div className="flex gap-2 pt-3 border-t border-gray-100 print-actions flex-wrap">
                            {invoiceSettled ? (
                                <div className="flex-1 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold flex items-center justify-center gap-1.5">
                                    <CheckCircle size={13} />
                                    Paid — printing receipt…
                                </div>
                            ) : (
                                <>
                                    <Button
                                        variant="secondary"
                                        onClick={() => setActiveInvoice(null)}
                                        className="font-bold flex-1 text-[10px] py-1.5 min-w-[70px]"
                                    >
                                        Cancel
                                    </Button>
                                    {printInvoiceEnabled && printBillEnabled && (
                                        <button
                                            onClick={handlePrintBill}
                                            className="flex-1 py-1.5 px-3 border border-gray-300 rounded-xl text-[10px] font-bold text-gray-700 bg-white hover:bg-gray-50 transition active:scale-95 text-center flex items-center justify-center gap-1.5 shadow-sm min-w-[70px] animate-scale-in"
                                        >
                                            Print Bill
                                        </button>
                                    )}
                                    {!irdSyncEnabled ? (
                                        <Button
                                            variant="primary"
                                            loading={isSettlingInvoice}
                                            onClick={handleMarkPaid}
                                            className="font-bold flex-1 bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 text-[10px] text-white py-1.5 min-w-[70px] animate-scale-in"
                                        >
                                            Close Guest
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            loading={isSettlingInvoice}
                                            onClick={handleMarkPaid}
                                            className="font-bold flex-1 bg-emerald-600 hover:bg-emerald-700 border-emerald-600 hover:border-emerald-700 text-[10px] text-white py-1.5 min-w-[70px] animate-scale-in"
                                        >
                                            Mark Paid
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    )
}
