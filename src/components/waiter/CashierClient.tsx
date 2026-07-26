'use client'

import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { markDeliveredAndCashPaid } from '@/app/(staff)/waiter/order-actions'
import { updateTakeoutStatusAction } from '@/app/(admin)/admin/takeout/actions'
import { useCurrency, useFeatureEnabled, useDateFormatter, useFeatures } from '@/lib/contexts/FeatureContext'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import { Banknote, CheckCircle, ChefHat, Clock, Loader2, CreditCard, Receipt, ShoppingBag, Flame, X, ShoppingCart, Percent, PenLine } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import Button from '@/components/ui/Button'
import { usePrinter } from '@/lib/print/usePrinter'
import { buildInvoiceTicket } from '@/lib/print/templates/invoiceTicket'
import { buildStationTicket } from '@/lib/print/templates/stationTicket'
import { itemsForStation, STATION_META, type StationKind } from '@/lib/stations'
import { claimForPrinting, releasePrintClaim, fetchOrdersWithUnprintedItems, OUTSTANDING_PRINT_SELECT } from '@/lib/print/printClaims'
import KotPrintFallback from '@/components/kitchen/KotPrintFallback'
import type { KitchenOrder } from '@/components/kitchen/OrderQueue'
import ManualEntryClient from '@/app/(admin)/admin/manual-entry/ManualEntryClient'
import CashierOrdersPanel from './CashierOrdersPanel'
import type { BankAccount, ExpenseCategory, Supplier, Session } from '@/types/database'
import QuickOrderModal from './QuickOrderModal'


import { calculateNights, advanceMethodLabel, getItemDisplayName } from '@/lib/utils'
import { useQrCodes } from '@/lib/hooks/useQrCodes'

// Auto-print retry/fallback tuning, matching the kitchen screen's.
const KOT_PRINT_MAX_RETRIES = 2
const KOT_PRINT_RETRY_MS = 2500

// Backstop sweep for outstanding tickets. Slow on purpose: realtime carries the
// normal case, so this only has to cover a channel that is wedged rather than
// disconnected — a state no reconnect callback ever fires for.
const OUTSTANDING_POLL_MS = 60_000

type OrderItem = {
    id?: string
    quantity: number
    status?: string
    unit_price?: number
    needs_confirmation?: boolean
    menu_items: { name: string } | null
}
type TableRef = { id?: string; label?: string; room_id?: string | null } | null
type BookingRoomRef = { id: string; rooms?: { id: string; room_number: string } | null } | null

export type UnpaidOrder = {
    id: string
    status?: string
    total_amount: number
    placed_at: string
    delivered_at: string | null
    payment_status: string
    payment_method: string | null
    session_id: string | null
    booking_id?: string | null
    order_type?: 'dine_in' | 'takeout' | 'delivery'
    customer_name?: string | null
    customer_phone?: string | null
    delivery_address?: string | null
    sessions: { id: string; seat_number?: number; booking_id?: string | null; tables: TableRef; bookings?: BookingRoomRef } | null
    bookings?: BookingRoomRef
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
    sessions: { id: string; seat_number?: number; booking_id?: string | null; tables: TableRef; bookings?: BookingRoomRef } | null
    bookings?: BookingRoomRef
    order_items?: OrderItem[]
}

import CashierTableManager, { type TableWithSession } from './CashierTableManager'
import CashierRoomManager from './CashierRoomManager'
import InvoiceReceipt from '@/components/shared/InvoiceReceipt'
import Select from '@/components/ui/Select'
import { useDates } from '@/lib/contexts/CalendarContext'

interface Props {
    restaurantId: string
    restaurantSlug: string
    restaurantName: string
    restaurantAddress?: string
    restaurantPhone?: string
    userId: string
    initialUnpaid: UnpaidOrder[]
    initialActive: ActiveOrder[]
    tables: TableWithSession[]
    rooms?: any[]
    isHotel?: boolean
    initialBookings?: any[]
    userRole: string
    manualEntryBankAccounts: BankAccount[]
    manualEntrySuppliers: Supplier[]
    manualEntryStaffList: { id: string; full_name: string }[]
    manualEntryExpenseCategories: ExpenseCategory[]
    manualEntryIngredients: { id: string; name: string; unit: string; stock_quantity: number }[]
    manualEntryHasOpenSession: boolean
    manualEntrySessionId: string | null
}

// Label for an order's table, seat-aware: seat 2+ of a split table is always
// "4-2"; seat 1 only gets the "-1" suffix when its table is actually split
// (splitSessionIds), so ordinary single-session tables stay plain "4".
export function tableLabel(
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
    restaurantName,
    restaurantAddress = '',
    restaurantPhone = '',
    userId,
    initialUnpaid, 
    initialActive,
    tables,
    rooms = [],
    isHotel = false,
    initialBookings = [],
    userRole,
    manualEntryBankAccounts,
    manualEntrySuppliers,
    manualEntryStaffList,
    manualEntryExpenseCategories,
    manualEntryIngredients,
    manualEntryHasOpenSession,
    manualEntrySessionId,
}: Props) {
    const router = useRouter()
    const [showManualEntry, setShowManualEntry] = useState(false)
    const { confirm } = useConfirmStore()
    const [unpaid, setUnpaid] = useState<UnpaidOrder[]>(initialUnpaid)
    const money = useCurrency()
    const features = useFeatures()
    const formatDate = useDateFormatter()
    const printInvoiceEnabled = useFeatureEnabled('printInvoiceEnabled')
    const printBillEnabled = useFeatureEnabled('printBillEnabled')
    const showInvoiceEnabled = useFeatureEnabled('showInvoiceEnabled')
    const generateInvoiceEnabled = useFeatureEnabled('generateInvoiceEnabled')
    const irdSyncEnabled = useFeatureEnabled('irdSyncEnabled')
    const { formatDateTime, calendar } = useDates()
    const { print: printInvoice } = usePrinter('invoice')
    const { print: printKot, networkPrinter: kotNetworkPrinter } = usePrinter('kot')
    const { print: printBot, networkPrinter: botNetworkPrinter } = usePrinter('bot')

    // Station tickets that reached no thermal printer, queued for the browser
    // fallback. A queue rather than a single slot: QZ Tray down for a whole
    // shift would otherwise drop every ticket but the most recent.
    const [ticketFallbackQueue, setTicketFallbackQueue] = useState<{ order: KitchenOrder; station: StationKind }[]>([])
    const dequeueTicketFallback = useCallback(() => setTicketFallbackQueue(q => q.slice(1)), [])

    // Pending retry timers, cleared on unmount so a queued retry can't fire
    // (and setState) after the panel is gone.
    const printRetryTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
    useEffect(() => () => {
        const timers = printRetryTimers.current
        timers.forEach(clearTimeout)
        timers.clear()
    }, [])

    /**
     * Auto-print one station's ticket for an order, with the safety net the
     * kitchen screen already had: retry a transient LAN failure, fall back to a
     * browser print on this device, and always say what happened.
     *
     * Previously a failed cashier auto-print was a console.error and nothing
     * else — indistinguishable, from behind the till, from KOT printing simply
     * not being wired up. A misconfigured LAN printer silently cost every
     * ticket.
     */
    const printStationTicket = useCallback((
        order: KitchenOrder,
        station: StationKind,
        // Called only when this ticket produced no paper at all, so the caller
        // can hand its claim back and leave the lines outstanding.
        onProducedNothing?: (itemIds: string[]) => void,
    ) => {
        const items = itemsForStation(order.order_items, station)
        if (items.length === 0) return
        // Project to this station's lines so the browser fallback renders the
        // same subset the thermal ticket would.
        const projected = { ...order, order_items: items }
        const send = station === 'bar' ? printBot : printKot
        const network = station === 'bar' ? botNetworkPrinter : kotNetworkPrinter
        const abbr = STATION_META[station].ticketAbbr

        // Hoisted so it can recurse for retries without referencing the
        // surrounding useCallback before it is declared.
        function attemptPrint(attempt: number) {
            void send(buildStationTicket(projected, station, restaurantName)).then((result) => {
                if (result.ok) {
                    if (result.usedLocalFallback) {
                        toast(`${abbr} printer unreachable — printed on this device instead.`)
                    }
                    return
                }
                // Retry a transient LAN failure before giving up on the roll the
                // ticket belongs on. A missing printer or a trust block needs a
                // human, not another attempt.
                const transient = result.status === 'not-running' || result.status === 'print-failed'
                if (network && transient && attempt < KOT_PRINT_MAX_RETRIES) {
                    const t = setTimeout(() => {
                        printRetryTimers.current.delete(t)
                        attemptPrint(attempt + 1)
                    }, KOT_PRINT_RETRY_MS)
                    printRetryTimers.current.add(t)
                    return
                }
                // The browser fallback is still paper, so the claim stands.
                setTicketFallbackQueue(q => [...q, { order: projected, station }])
                toast.error(
                    result.status === 'no-printer-selected'
                        ? `No ${abbr} printer set — printed via browser instead. Set one in Printer Settings.`
                        : network
                            ? `${abbr} printer unreachable after ${KOT_PRINT_MAX_RETRIES + 1} tries — printed via browser instead.`
                            : `${abbr} printer not connected — printed via browser instead.`
                )
            }).catch((err) => {
                // Nothing was printed and no fallback was queued, so the claim
                // must go back or these lines are lost to a ticket that never
                // existed.
                console.error(`[Cashier ${abbr} print] threw:`, err)
                onProducedNothing?.(items.map(i => i.id).filter(Boolean))
                toast.error(`${abbr} print failed — the order stays queued to print.`)
            })
        }
        attemptPrint(0)
    }, [printKot, printBot, kotNetworkPrinter, botNetworkPrinter, restaurantName])

    /**
     * Claim this order's unprinted lines, then print exactly what we won.
     *
     * The claim is the whole coordination story: it is a conditional UPDATE, so
     * if a kitchen station is also open only one of us gets the lines back and
     * the other prints nothing. Nothing is remembered in this component — the
     * database is the record of what has printed, which is what lets a tab that
     * was closed, asleep or disconnected still pick the work up later.
     */
    const claimAndPrint = useCallback(async (order: KitchenOrder) => {
        // Items still awaiting cashier confirmation (QR self-orders) are not
        // ours to print — they go out from the Order Confirmation panel once
        // confirmed.
        const printable = (order.order_items || []).filter(i => !i.needs_confirmation && i.id && !i.kot_printed_at)
        if (printable.length === 0) return
        const wonIds = await claimForPrinting(supabaseRef.current, printable.map(i => i.id))
        if (wonIds.length === 0) return // another station got there first
        const won = new Set(wonIds)
        const scoped = { ...order, order_items: printable.filter(i => won.has(i.id)) }
        // Each is a no-op when the order has no lines for that station. Handing
        // the claim back on total failure keeps the lines outstanding rather
        // than losing them to a claim that printed nothing.
        printStationTicket(scoped, 'kitchen', releaseIds => void releasePrintClaim(supabaseRef.current, releaseIds))
        printStationTicket(scoped, 'bar', releaseIds => void releasePrintClaim(supabaseRef.current, releaseIds))
    }, [printStationTicket])

    /**
     * Print everything nobody has printed yet.
     *
     * Runs on mount, on realtime reconnect and on a slow poll. Because
     * outstanding work is a database query rather than a memory of events seen,
     * this recovers every gap uniformly: an order placed while no station was
     * open at all, one missed during a wifi blip, or one whose printer was down
     * at the time. The claim makes running it often harmless.
     */
    const printOutstanding = useCallback(async () => {
        if (!features?.kotEnabled) return
        const orders = await fetchOrdersWithUnprintedItems(supabaseRef.current, restaurantId)
        for (const order of orders) await claimAndPrint(order)
    }, [features?.kotEnabled, restaurantId, claimAndPrint])

    // Mount + slow poll. The poll is the backstop that makes auto-print survive
    // a realtime channel that is wedged rather than disconnected — a state the
    // reconnect callback never fires for.
    useEffect(() => {
        if (!features?.kotEnabled) return
        void printOutstanding()
        const id = setInterval(() => { void printOutstanding() }, OUTSTANDING_POLL_MS)
        return () => clearInterval(id)
    }, [features?.kotEnabled, printOutstanding])

    const [active, setActive] = useState<ActiveOrder[]>(initialActive)
    const [processingId, setProcessingId] = useState<string | null>(null)
    const supabaseRef = useRef(createClient())
    const [activeTab, setActiveTab] = useState<'rooms' | 'tables' | 'space' | 'billing' | 'orders'>('billing')
    const [spaceFilter, setSpaceFilter] = useState<'all' | 'available' | 'reserved' | 'occupied' | 'dirty'>('all')
    const [roomsFilter, setRoomsFilter] = useState<'all' | 'available' | 'reserve' | 'occupied' | 'dirty' | 'closed'>('all')
    const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null)

    // Stays and Billing states
    const [roomsState, setRoomsState] = useState<any[]>(rooms)
    // Local, realtime-patchable copy of the `tables` prop — table sessions
    // opening/closing needs to reflect live in the Billing tab (a newly
    // seated table, or one just paid off) without a page refresh.
    const [tablesState, setTablesState] = useState<TableWithSession[]>(tables)
    const [roomTypeFilter, setRoomTypeFilter] = useState<string>('all')
    const [billingRoomTypeFilter, setBillingRoomTypeFilter] = useState<string>('all')

    const roomTypesList = useMemo(() => {
        const unique = new Map()
        roomsState.forEach(r => {
            if (r.type_id && r.room_types?.name) {
                unique.set(r.type_id, r.room_types.name)
            }
        })
        return Array.from(unique.entries()).map(([id, name]) => ({ id, name }))
    }, [roomsState])

    const filteredBillingRooms = useMemo(() => {
        return roomsState
            .filter(r => r.status === 'occupied')
            .filter(r => billingRoomTypeFilter === 'all' || r.type_id === billingRoomTypeFilter)
    }, [roomsState, billingRoomTypeFilter])

    const [bookings, setBookings] = useState<any[]>(initialBookings)
    const [billingSubTab, setBillingSubTab] = useState<'all' | 'rooms' | 'tables' | 'takeout' | 'delivery'>('rooms')
    const [selectedBillingRoom, setSelectedBillingRoom] = useState<any | null>(null)
    const [selectedBillingTable, setSelectedBillingTable] = useState<any | null>(null)
    const [selectedBillingOrder, setSelectedBillingOrder] = useState<UnpaidOrder | null>(null)
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
    const filteredRoomOrders = useMemo(() => {
        return billingLinkedOrders.filter(o => o.is_room_order && o.status !== 'cancelled')
    }, [billingLinkedOrders])
    const filteredLinkedOrders = useMemo(() => {
        return billingLinkedOrders.filter(o => !o.is_room_order && o.status !== 'cancelled')
    }, [billingLinkedOrders])
    const [billingPaymentMethod, setBillingPaymentMethod] = useState<'cash' | 'qr_digital' | 'both' | 'credit'>('cash')
    const [splitCashAmount, setSplitCashAmount] = useState<string>('')
    const [splitQrAmount, setSplitQrAmount] = useState<string>('')
    const [billingQrCodeId, setBillingQrCodeId] = useState<string>('')
    const [showTakeoutQuickOrder, setShowTakeoutQuickOrder] = useState<boolean>(false)
    // Bargain rate for the takeaway/delivery order billing panel (PR #96). The
    // table billing panel uses foodDiscount below instead; only one panel is
    // ever open at a time, so this state is dedicated to takeaway/delivery.
    const [tableBargainRate, setTableBargainRate] = useState<string>('')
    const [tableBargainReason, setTableBargainReason] = useState<string>('')
    // Table Food Discount: entered directly (like foodDiscount in room service)
    const [tableDiscount, setTableDiscount] = useState<string>('')
    const [tableDiscountReason, setTableDiscountReason] = useState<string>('')
    const [roomDiscount, setRoomDiscount] = useState<string>('')
    const [foodDiscount, setFoodDiscount] = useState<string>('')
    const [discountReason, setDiscountReason] = useState<string>('')
    const [extraHourCharge, setExtraHourCharge] = useState<string>('')

    useEffect(() => {
        setRoomDiscount('')
        setFoodDiscount('')
        setDiscountReason('')
        setExtraHourCharge('')
        setBillingPaymentMethod('cash')
        setSplitCashAmount('')
        setSplitQrAmount('')
        setBillingQrCodeId('')
        setCreditCustomerName('')
        setCreditCustomerPhone('')
    }, [selectedBillingRoom?.id])
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
    const [pendingInvoice, setPendingInvoice] = useState<{ type: 'room' | 'table' | 'takeout' | 'delivery'; item: any; data: any } | null>(null)
    const [isDirectCheckingOut, setIsDirectCheckingOut] = useState(false)
    const qrCodes = useQrCodes()

    const [mounted, setMounted] = useState(false)


    // Sync rooms state when prop changes
    useEffect(() => {
        setRoomsState(rooms)
    }, [rooms])

    // Sync tables state when prop changes
    useEffect(() => {
        setTablesState(tables)
    }, [tables])

    // Sync unpaid/active order state when props change — previously missing,
    // unlike rooms/bookings/tables above, so a server refresh (e.g. the
    // realtime reconnect catch-up below) never actually reached these two.
    useEffect(() => {
        setUnpaid(initialUnpaid)
    }, [initialUnpaid])

    useEffect(() => {
        setActive(initialActive)
    }, [initialActive])

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

    // Realtime subscriptions for table sessions — a table becoming newly
    // occupied (or its session closing once paid) needs to show up in/drop
    // out of the Billing tab's Tables grid without a manual refresh.
    // Mirrors CashierTableManager.tsx's identical patch logic exactly.
    useRestaurantTable(restaurantId, 'sessions', (payload) => {
        if (payload.eventType === 'INSERT') {
            const s = payload.new as Session
            const seatNumber = s.seat_number ?? 1
            const patch = seatNumber === 1
                ? { activeSession: s }
                : (t: TableWithSession) => ({ otherActiveSessions: [...(t.otherActiveSessions || []).filter(x => x.id !== s.id), s] })

            setTablesState(prev => prev.map(t => t.id === s.table_id
                ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
                : t))
            setSelectedBillingTable((prev: any) => prev?.id === s.table_id
                ? { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
                : prev)
        } else if (payload.eventType === 'UPDATE') {
            const s = payload.new as Session
            const isClosed = s.status === 'closed' || s.status === 'expired'

            setTablesState(prev => prev.map(t => {
                if (t.activeSession?.id === s.id) {
                    return { ...t, activeSession: isClosed ? null : s }
                }
                if (t.otherActiveSessions?.some(x => x.id === s.id)) {
                    return {
                        ...t,
                        otherActiveSessions: isClosed
                            ? t.otherActiveSessions.filter(x => x.id !== s.id)
                            : t.otherActiveSessions.map(x => x.id === s.id ? s : x)
                    }
                }
                return t
            }))
            setSelectedBillingTable((prev: any) => {
                if (!prev) return null
                if (prev.activeSession?.id === s.id) {
                    return { ...prev, activeSession: isClosed ? null : s }
                }
                if (prev.otherActiveSessions?.some((x: Session) => x.id === s.id)) {
                    return {
                        ...prev,
                        otherActiveSessions: isClosed
                            ? prev.otherActiveSessions.filter((x: Session) => x.id !== s.id)
                            : prev.otherActiveSessions.map((x: Session) => x.id === s.id ? s : x)
                    }
                }
                return prev
            })
        }
    })

    useRestaurantTable(restaurantId, 'tables', (payload) => {
        if (payload.eventType !== 'UPDATE') return
        const u = payload.new as TableWithSession
        const patch = {
            table_status: u.table_status,
            cleaning_claimed_by: u.cleaning_claimed_by ?? null,
            cleaning_claimed_at: u.cleaning_claimed_at ?? null,
        }
        setTablesState(prev => prev.map(t => t.id === u.id ? { ...t, ...patch } : t))
        setSelectedBillingTable((prev: any) => prev?.id === u.id ? { ...prev, ...patch } : prev)
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
        setTableDiscount('')
        setTableDiscountReason('')
        setCreditCustomerName('')
        setCreditCustomerPhone('')
    }, [selectedBillingTable?.id])

    // Same reset for the takeaway/delivery order billing panel — shares the
    // table panel's bargain-rate/payment-method state since only one of the
    // two panels is ever open at a time.
    useEffect(() => {
        setBillingPaymentMethod('cash')
        setSplitCashAmount('')
        setSplitQrAmount('')
        setBillingQrCodeId('')
        setTableBargainRate('')
        setTableBargainReason('')
        setCreditCustomerName(selectedBillingOrder?.customer_name || '')
        setCreditCustomerPhone(selectedBillingOrder?.customer_phone || '')
    }, [selectedBillingOrder?.id])

    const calculateStayCost = (room: any, booking: any) => {
        if (!room || !booking) return 0
        const price = room.room_types?.base_price || 0
        const nights = calculateNights(booking.check_in, booking.check_out)
        return price * nights
    }

    const getRoomQrOrders = (room: any) => {
        if (!room) return []
        if (filteredRoomOrders.length > 0) {
            // Merge duplicate items (same dish ordered at different times)
            const mergeMap = new Map<string, { name: string; quantity: number; unitPrice: number; status: string }>()
            for (const item of filteredRoomOrders) {
                const name = getItemDisplayName(item)
                const unitPrice = Number(item.unit_price ?? 0)
                const key = `${name}__${unitPrice}`
                const existing = mergeMap.get(key)
                if (existing) {
                    existing.quantity += item.quantity || 0
                } else {
                    mergeMap.set(key, { name, quantity: item.quantity || 0, unitPrice, status: 'active' })
                }
            }
            return Array.from(mergeMap.values())
        }
        
        // Fallback for immediate UI responsiveness before API returns
        const booking = billingStayBooking ?? bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
        if (!booking) return []

        const allActive = active.filter(o => o.booking_id === booking.id)
        const allUnpaid = unpaid.filter(o => o.booking_id === booking.id)
        const matchingTable = tablesState.find(t => t.room_id === room.id)
        const sessionId = matchingTable?.activeSession?.id
        const additionalActive = sessionId ? active.filter(o => o.session_id === sessionId && o.booking_id !== booking.id) : []
        const additionalUnpaid = sessionId ? unpaid.filter(o => o.session_id === sessionId && o.booking_id !== booking.id) : []

        const combinedOrders = [...allActive, ...allUnpaid, ...additionalActive, ...additionalUnpaid]
        const uniqueOrdersMap = new Map<string, any>()
        for (const o of combinedOrders) {
            uniqueOrdersMap.set(o.id, o)
        }
        const items: { name: string; quantity: number; unitPrice: number; status: string }[] = []
        const mergeMap = new Map<string, { name: string; quantity: number; unitPrice: number; status: string }>()
        for (const order of Array.from(uniqueOrdersMap.values())) {
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                const name = getItemDisplayName(item)
                const unitPrice = Number(item.unit_price ?? 0)
                const key = `${name}__${unitPrice}`
                const existing = mergeMap.get(key)
                if (existing) {
                    existing.quantity += item.quantity || 0
                } else {
                    mergeMap.set(key, {
                        name,
                        quantity: item.quantity || 0,
                        unitPrice,
                        status: item.status || order.status || 'unknown'
                    })
                }
            }
        }
        return Array.from(mergeMap.values())
    }

    const stayCost = selectedBillingRoom && billingStayBooking ? calculateStayCost(selectedBillingRoom, billingStayBooking) : 0
    const qrOrdersTotal = selectedBillingRoom ? filteredRoomOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0) : 0
    const linkedOrdersTotal = selectedBillingRoom ? filteredLinkedOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0) : 0
    const totalFoodOrders = qrOrdersTotal + linkedOrdersTotal

    const roomDiscountVal = roomDiscount.trim() !== '' ? parseFloat(roomDiscount) || 0 : 0
    const foodDiscountVal = foodDiscount.trim() !== '' ? parseFloat(foodDiscount) || 0 : 0
    const totalDiscountAmount = roomDiscountVal + foodDiscountVal

    const extraHourChargeVal = extraHourCharge.trim() !== '' ? parseFloat(extraHourCharge) || 0 : 0

    const discountInvalid = roomDiscountVal < 0 || roomDiscountVal > stayCost || foodDiscountVal < 0 || foodDiscountVal > totalFoodOrders

    const checkOutTime = billingStayBooking ? new Date(billingStayBooking.check_out) : null
    const currentTime = new Date()
    const isExceeded = checkOutTime ? currentTime > checkOutTime : false
    const extraHours = isExceeded && checkOutTime
        ? Math.ceil((currentTime.getTime() - checkOutTime.getTime()) / (1000 * 60 * 60))
        : 0

    const getTableSessionItems = (table: any) => {
        if (!table || !table.activeSession) return []
        const sessionId = table.activeSession.id
        const allActive = active.filter(o => o.session_id === sessionId)
        const allUnpaid = unpaid.filter(o => o.session_id === sessionId)
        const combinedOrders = [...allActive, ...allUnpaid]

        const itemsMap: Record<string, { id: string; name: string; quantity: number; unitPrice: number; status: string }> = {}
        for (const order of combinedOrders) {
            if (order.status === 'cancelled') continue
            const orderItems = order.order_items || []
            for (const item of orderItems) {
                if (item.status === 'cancelled') continue
                const name = getItemDisplayName(item)
                const unitPrice = Number(item.unit_price ?? 0)
                
                const key = `${name}-${unitPrice}`
                if (itemsMap[key]) {
                    itemsMap[key].quantity += item.quantity || 0
                } else {
                    itemsMap[key] = {
                        id: item.id || '',
                        name,
                        quantity: item.quantity || 0,
                        unitPrice,
                        status: item.status || order.status || 'unknown'
                    }
                }
            }
        }
        return Object.values(itemsMap)
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
        return [...allActive, ...allUnpaid]
            .filter(o => o.status !== 'cancelled')
            .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0)
    }

    const calculateGrandTotal = (room: any, booking: any) => {
        const stayCost = calculateStayCost(room, booking)
        const qrOrdersTotal = filteredRoomOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0)
        const linkedOrdersTotal = filteredLinkedOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0)
        const totalFoodOrders = qrOrdersTotal + linkedOrdersTotal

        const roomDiscountVal = roomDiscount.trim() !== '' ? parseFloat(roomDiscount) || 0 : 0
        const foodDiscountVal = foodDiscount.trim() !== '' ? parseFloat(foodDiscount) || 0 : 0

        const effectiveStayCost = Math.max(0, stayCost - roomDiscountVal)
        const effectiveFoodOrders = Math.max(0, totalFoodOrders - foodDiscountVal)
        const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        const extraHourChargeVal = extraHourCharge.trim() !== '' ? parseFloat(extraHourCharge) || 0 : 0
        return effectiveStayCost + effectiveFoodOrders + manualChargesTotal + extraHourChargeVal
    }

    // Pure computation — no side effects — so compileInvoice below can inspect
    // the result (does this settlement involve credit? is it overpaid?) before
    // deciding whether to open the confirmation popup or go straight to the
    // invoice preview.
    const buildInvoiceData = (type: 'room' | 'table' | 'takeout' | 'delivery', item: any): any => {
        if (type === 'room') {
            const room = item
            // Prefer the freshly fetched billingStayBooking (newest checked_in via API)
            // This avoids showing stale data from a previous booking session
            const booking = billingStayBooking ?? bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
            if (!booking) return null

            const price = room.room_types?.base_price || 0
            const nights = calculateNights(booking.check_in, booking.check_out)
            const stayCost = price * nights

            // Merge duplicate items (same dish ordered at different times in the same session)
            const mergeFn = (rawItems: any[]) => {
                const map = new Map<string, { name: string; quantity: number; unitPrice: number }>()
                for (const item of rawItems) {
                    const name = getItemDisplayName(item)
                    const unitPrice = Number(item.unit_price ?? 0)
                    const key = `${name}__${unitPrice}`
                    const existing = map.get(key)
                    if (existing) {
                        existing.quantity += item.quantity || 0
                    } else {
                        map.set(key, { name, quantity: item.quantity || 0, unitPrice })
                    }
                }
                return Array.from(map.values())
            }
            const sessionOrders = mergeFn(filteredRoomOrders)
            const qrOrdersTotal = filteredRoomOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0)

            const linkedOrders = mergeFn(filteredLinkedOrders)
            const linkedOrdersTotal = filteredLinkedOrders.reduce((sum, item) => sum + (Number(item.unit_price ?? 0) * (item.quantity || 0)), 0)
            const manualChargesTotal = billingRoomCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
            const total = calculateGrandTotal(room, booking)

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
                qrOrders: sessionOrders,
                qrOrdersTotal,
                linkedOrders,
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
                discountAmount: (parseFloat(roomDiscount) || 0) + (parseFloat(foodDiscount) || 0),
                discountReason: discountReason,
                extraHourCharge: extraHourChargeVal,
            }
        } else if (type === 'table') {
            const table = item
            const sessionOrders = getTableSessionItems(table)
            const itemsSubtotal = sessionOrders.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)
            // The authoritative, tax-inclusive total — /api/tables/checkout
            // bills off the same orders.total_amount field, so the bargain
            // rate must be calculated against this, not itemsSubtotal (which
            // is pre-tax and would understate what's actually charged).
            const subtotal = getTableSessionOrdersTotal(table)

            // Food Discount: discount amount entered directly
            const discountAmount = tableDiscount.trim() !== '' ? parseFloat(tableDiscount) || 0 : 0
            const total = Math.max(0, subtotal - discountAmount)

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
                discountReason: discountAmount > 0 ? tableDiscountReason.trim() : '',
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
        } else {
            // Takeaway ('takeout') or delivery — a single standalone order,
            // no session to draw items/total from. order.total_amount is the
            // same already-tax/promo/loyalty-adjusted authoritative figure
            // the new /api/orders/checkout route bills off.
            const order: UnpaidOrder = item
            const lineItems = (order.order_items || []).map(oi => ({
                name: getItemDisplayName(oi),
                quantity: oi.quantity,
                unitPrice: Number(oi.unit_price) || 0,
            }))
            const itemsSubtotal = lineItems.reduce((sum, o) => sum + (o.unitPrice * o.quantity), 0)
            const subtotal = Number(order.total_amount) || 0

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
                type,
                id: order.id,
                orderId: order.id,
                label: order.customer_name || (type === 'delivery' ? 'Delivery Guest' : 'Takeaway Guest'),
                guestName: order.customer_name || 'Walk-in Customer',
                guestPhone: order.customer_phone || null,
                nights: 0,
                basePrice: 0,
                stayCost: 0,
                qrOrders: lineItems,
                qrOrdersTotal: itemsSubtotal,
                manualCharges: [],
                manualChargesTotal: 0,
                total,
                discountAmount,
                discountReason: discountAmount > 0 ? tableBargainReason.trim() : '',
                paymentMethod: billingPaymentMethod,
                cashPaid: resolvedCash,
                qrPaid: resolvedQr,
                creditPaid: resolvedCredit,
                overpaid,
                qrCodeId: (resolvedQr > 0) ? (billingQrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined)) : undefined,
                customerName: order.customer_name || undefined,
                customerPhone: order.customer_phone || undefined,
            }
        }
    }

    // 'cash' and 'qr_digital' are unambiguous (one method, the full amount) —
    // straight to the invoice preview. 'both' and 'credit' always go through
    // the settlement confirmation popup first: 'both' because a typo in the
    // split fields would otherwise silently under- or over-charge, 'credit'
    // (whether the whole bill or a leftover from 'both') because it needs a
    // customer name + phone to post against.
    const compileInvoice = (type: 'room' | 'table' | 'takeout' | 'delivery', item: any) => {
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
            const matchingTable = tablesState.find(t => t.room_id === room.id)
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
                    discount_amount: (parseFloat(roomDiscount) || 0) + (parseFloat(foodDiscount) || 0),
                    discount_reason: discountReason || undefined,
                    extra_hour_charge: extraHourChargeVal,
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
                const sessionId = tablesState.find(t => t.room_id === invoice.roomId)?.activeSession?.id

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
                        discount_amount: invoice.discountAmount || 0,
                        discount_reason: invoice.discountReason,
                        extra_hour_charge: invoice.extraHourCharge || 0,
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
            } else if (invoice.type === 'table') {
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
            } else {
                // Takeaway/delivery — a single standalone order, no session.
                const res = await fetch(`/api/orders/checkout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        order_id: invoice.orderId,
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
                if (!res.ok) throw new Error(data.error || 'Failed to checkout order')

                toast.success(`${invoice.type === 'delivery' ? 'Delivery' : 'Takeaway'} order settled successfully!`)
            }

            // The bill is settled in the database at this point already — what
            // happens next is purely about paper. window.print() opens the
            // browser's own print dialog (pick a printer, preview, cancel);
            // it's a blocking call, so this line doesn't return until the
            // cashier closes that dialog one way or the other. Whether they
            // print or cancel makes no difference to the settlement above —
            // it already happened.
            isSettlingRef.current = false
            setIsSettlingInvoice(false)
            setInvoiceSettled(true)

            if (printInvoiceEnabled && printBillEnabled) {
                const result = await printInvoice(buildInvoiceTicket(invoice, money, restaurantName, restaurantAddress, restaurantPhone, calendar))
                if (!result.ok) {
                    toast.error(
                        result.status === 'no-printer-selected'
                            ? 'No printer set for this till — pick one in Printer Settings.'
                            : 'Printer not connected — opening browser print instead.'
                    )
                    if (result.status !== 'no-printer-selected') window.print()
                }
            }

            setActiveInvoice(null)
            setSelectedBillingRoom(null)
            setSelectedBillingTable(null)
            setSelectedBillingOrder(null)
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
        const result = await printInvoice(buildInvoiceTicket(activeInvoice, money, restaurantName, restaurantAddress, restaurantPhone, calendar))
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
        let all = tablesState.length
        let available = 0
        let reserved = 0
        let occupied = 0
        let dirty = 0
        for (const t of tablesState) {
            const rawStatus = t.activeSession ? 'active' : (t.table_status || 'available')
            const status = (isHotel && rawStatus === 'dirty') ? 'available' : rawStatus
            if (status === 'active') occupied++
            else if (status === 'dirty') dirty++
            else if (status === 'reserved') reserved++
            else available++
        }
        return { all, available, reserved, occupied, dirty }
    }, [tablesState, isHotel])

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
            const { data, error } = await supabase
                .from('orders')
                .select(OUTSTANDING_PRINT_SELECT)
                .eq('id', payload.new.id)
                .single()
            // Previously silent — if this fetch fails (RLS, network, ...) the new
            // order just never shows up anywhere in Billing/Orders, with no sign why.
            if (error) console.error('[Cashier orders realtime] INSERT fetch failed:', error)
            if (data) {
                // Guard against a duplicate/replayed INSERT event (reconnects,
                // redelivery) adding the same order twice — React then throws
                // on the duplicate order.id key everywhere this list renders.
                setActive(prev => prev.some(o => o.id === data.id) ? prev : [...prev, data as unknown as ActiveOrder])

                // Auto-print the KOT/BOT if KOT printing is enabled. Dedupes per
                // item, retries, and falls back to a browser print.
                if (features?.kotEnabled) {
                    void claimAndPrint(data as unknown as KitchenOrder)
                }
            }
        } else if (payload.eventType === 'UPDATE') {
            const { id, status, payment_status } = payload.new
            if (status === 'delivered' && payment_status === 'unpaid') {
                // Fetch full record to show in unpaid list
                const { data, error } = await supabase
                    .from('orders')
                    .select(`id, total_amount, placed_at, delivered_at, payment_status, payment_method, session_id, booking_id, order_type, customer_name, customer_phone, delivery_address, sessions ( id, seat_number, tables ( id, label, room_id ) ), order_items ( id, quantity, status, unit_price, needs_confirmation, menu_items ( name ) )`)
                    .eq('id', id)
                    .single()
                if (error) console.error('[Cashier orders realtime] UPDATE (unpaid) fetch failed:', error)
                if (data) {
                    // Same duplicate-event guard as the INSERT branch above —
                    // a second UPDATE landing on the same order (e.g. a
                    // follow-up write setting delivered_at) would otherwise
                    // push a second copy of it into `unpaid`.
                    setUnpaid(prev => prev.some(o => o.id === data.id) ? prev : [...prev, data as unknown as UnpaidOrder])
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
    }, () => {
        // Fires whenever the shared realtime channel (re)connects, including
        // after a drop (laptop sleep, network blip, a backgrounded tab) — the
        // one gap incremental postgres_changes patches can never close, since
        // anything that happened while disconnected was never delivered.
        // router.refresh() re-runs the server fetch; the resync effects above
        // (initialUnpaid/initialActive/rooms/bookings/tables) pick the fresh
        // props back up.
        console.log('[CashierClient] Realtime reconnected — refreshing to catch up on any missed updates')
        router.refresh()
        // router.refresh() restores the board but prints nothing, so an order
        // placed during the drop would silently never reach the kitchen.
        void printOutstanding()
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
        for (const t of tablesState as any[]) {
            if (t.activeSession && (t.otherActiveSessions?.length ?? 0) > 0) ids.add(t.activeSession.id)
        }
        return ids
    }, [tablesState])

    // One billing card per active session — a split table (Table 4-1, 4-2, ...)
    // settles each seat as its own independent bill, so each seat session becomes
    // its own entry with the seat-suffixed label and that seat's session as
    // `activeSession` (which is all the downstream items/total/checkout code reads).
    const billingTableEntries = useMemo(() => {
        const entries: any[] = []
        for (const t of tablesState as any[]) {
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
    }, [tablesState])

    // Unpaid takeaway/delivery orders — each is its own billing target (no
    // session to group by, unlike dine-in tables).
    const billingTakeoutEntries = useMemo(() => unpaid.filter(o => o.order_type === 'takeout'), [unpaid])
    const billingDeliveryEntries = useMemo(() => unpaid.filter(o => o.order_type === 'delivery'), [unpaid])

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

    const tabs: { id: 'rooms' | 'tables' | 'space' | 'billing' | 'orders'; label: string; shortLabel?: string }[] = isHotel ? [
        { id: 'rooms', label: 'Rooms' },
        { id: 'tables', label: 'Tables' },
        { id: 'billing', label: 'Billing' },
        { id: 'orders', label: 'Orders' },
    ] : [
        { id: 'space', label: 'Space' },
        { id: 'billing', label: 'Billing' },
        { id: 'orders', label: 'Orders' },
    ]

    const ordersNeedingConfirmationCount = active.filter(o =>
        (o.order_items || []).some(i => i.needs_confirmation) ||
        ((o.order_type === 'takeout' || o.order_type === 'delivery') && o.status === 'pending')
    ).length

    return (
        <div className="space-y-5">
            {/* Header Actions Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface rounded-2xl border border-hairline p-4 shadow-sm">
                <div>
                    <h2 className="text-lg font-black text-ink">Cashier POS Dashboard</h2>
                    <p className="text-caption text-ink-subtle">Manage table orders, room stays, billing, and settlements.</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => setShowTakeoutQuickOrder(true)}
                        className="flex items-center gap-2 text-sm font-bold text-ink-muted bg-surface border border-hairline hover:bg-surface-muted px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                    >
                        <ShoppingBag size={15} />
                        Manual Takeaway/Delivery
                    </button>
                    {!!features.financeEnabled && (features.manualEntryEnabled ?? true) && (
                        <button
                            onClick={() => setShowManualEntry(true)}
                            className="flex items-center gap-2 text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                        >
                            <PenLine size={15} />
                            Manual Entry
                        </button>
                    )}
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
                            className={`flex items-center justify-center gap-1.5 py-4 px-1 text-xs md:text-sm font-bold whitespace-nowrap transition-colors relative focus:outline-none w-full ${
                                isActive ? 'text-[var(--brand-500)]' : 'text-ink-muted hover:text-ink'
                            }`}
                        >
                            {tab.id === 'billing' && unpaid.length > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-red-100 text-red-700'
                                }`}>
                                    {unpaid.length}
                                </span>
                            )}
                            {tab.id === 'orders' && ordersNeedingConfirmationCount > 0 && (
                                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md min-w-[18px] text-center ${
                                    isActive ? 'bg-[var(--brand-500)] text-white' : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {ordersNeedingConfirmationCount}
                                </span>
                            )}
                            <span className="sm:hidden truncate">{tab.shortLabel ?? tab.label}</span>
                            <span className="hidden sm:inline">{tab.label}</span>
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
                        <div className="sticky top-28 z-20 bg-canvas -mx-3 px-3 md:mx-0 md:px-0 py-2 border-b border-hairline flex flex-col md:flex-row items-center w-full justify-between gap-3 shadow-sm">
                            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2.5 w-full md:w-auto flex-1">
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
                            {/* Room Category Filter select */}
                            <div className="w-full md:w-60 flex items-center gap-2 shrink-0 md:justify-end">
                                <span className="text-[10px] font-black text-ink-subtle uppercase shrink-0">Type:</span>
                                <Select
                                    value={roomTypeFilter}
                                    onChange={(e) => setRoomTypeFilter(e.target.value)}
                                    className="w-full md:w-48 text-xs"
                                >
                                    <option value="all">All Room Types</option>
                                    {roomTypesList.map(type => (
                                        <option key={type.id} value={type.id}>{type.name}</option>
                                    ))}
                                </Select>
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
                            roomTypeFilter={roomTypeFilter}
                            tables={tablesState}
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
                            initialTables={tablesState}
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

                {activeTab === 'billing' && (
                    <div className="space-y-5">
                        {/* Awaiting Payment section */}
                        <div>
                            <div className="border-b border-hairline pb-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <h2 className="text-sm font-semibold text-ink-muted flex items-center gap-2">
                                    <Receipt size={14} className="text-red-400" />
                                    Awaiting Payment
                                </h2>
                                <div className="flex items-center gap-3">
                                    {billingSubTab === 'rooms' && (
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] font-black text-ink-subtle uppercase shrink-0">Type:</span>
                                            <Select
                                                value={billingRoomTypeFilter}
                                                onChange={(e) => setBillingRoomTypeFilter(e.target.value)}
                                                className="w-48 text-xs"
                                            >
                                                <option value="all">All Room Types</option>
                                                {roomTypesList.map(type => (
                                                    <option key={type.id} value={type.id}>{type.name}</option>
                                                ))}
                                            </Select>
                                        </div>
                                    )}
                                    <div className="flex bg-surface-muted p-1 rounded-xl border border-hairline shrink-0 flex-wrap">
                                        <button
                                            onClick={() => setBillingSubTab('all')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'all' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            All ({
                                                (isHotel ? roomsState.filter(r => r.status === 'occupied').length : 0)
                                                + billingTableEntries.length + billingTakeoutEntries.length + billingDeliveryEntries.length
                                            })
                                        </button>
                                        {isHotel && (
                                            <button
                                                onClick={() => setBillingSubTab('rooms')}
                                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                    billingSubTab === 'rooms' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                                }`}
                                            >
                                                Rooms ({roomsState.filter(r => r.status === 'occupied').length})
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setBillingSubTab('tables')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'tables' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Tables ({billingTableEntries.length})
                                        </button>
                                        <button
                                            onClick={() => setBillingSubTab('takeout')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'takeout' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Takeaway ({billingTakeoutEntries.length})
                                        </button>
                                        <button
                                            onClick={() => setBillingSubTab('delivery')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                                billingSubTab === 'delivery' ? 'bg-white text-ink shadow-sm' : 'text-ink-subtle hover:text-ink-muted'
                                            }`}
                                        >
                                            Delivery ({billingDeliveryEntries.length})
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {(() => {
                                const occupiedRooms = isHotel ? roomsState.filter((r: any) => r.status === 'occupied') : []
                                const activeList = billingSubTab === 'all' ? [...occupiedRooms, ...billingTableEntries, ...billingTakeoutEntries, ...billingDeliveryEntries]
                                    : billingSubTab === 'rooms' ? filteredBillingRooms
                                    : billingSubTab === 'tables' ? billingTableEntries
                                    : billingSubTab === 'takeout' ? billingTakeoutEntries
                                    : billingDeliveryEntries

                                if (activeList.length === 0) {
                                    return (
                                        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-10 text-center">
                                            <CheckCircle size={32} className="mx-auto text-emerald-300 mb-2" />
                                            <p className="text-sm font-medium text-ink-subtle">All bills settled</p>
                                            <p className="text-xs text-gray-300 mt-1">No pending payments in this category</p>
                                        </div>
                                    )
                                }

                                if (billingSubTab === 'all') {
                                    // Combined grid — each card renders per its own kind
                                    // (room / table / takeaway / delivery) but routes to
                                    // the same selection handlers the dedicated tabs use.
                                    return (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {occupiedRooms.map((room: any) => {
                                                const booking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')
                                                return (
                                                    <button
                                                        key={`room:${room.id}`}
                                                        onClick={() => setSelectedBillingRoom(room)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
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
                                            {billingTableEntries.map(table => {
                                                const sessionItems = getTableSessionItems(table)
                                                return (
                                                    <button
                                                        key={`table:${table.uiKey}`}
                                                        onClick={() => setSelectedBillingTable(table)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
                                                            Table {table.label}
                                                        </span>
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            {sessionItems.length} items unpaid
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                            {[...billingTakeoutEntries, ...billingDeliveryEntries].map(order => (
                                                <button
                                                    key={`order:${order.id}`}
                                                    onClick={() => setSelectedBillingOrder(order)}
                                                    className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                >
                                                    <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
                                                        {order.customer_name || 'Walk-in'}
                                                    </span>
                                                    <span className="text-[10px] font-bold text-ink-subtle mt-1.5 truncate max-w-full">
                                                        #{order.id.slice(0, 8).toUpperCase()}
                                                    </span>
                                                    {order.customer_phone && (
                                                        <span className="text-[10px] font-bold text-ink-subtle truncate max-w-full">
                                                            {order.customer_phone}
                                                        </span>
                                                    )}
                                                    <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                        {order.order_type === 'delivery' ? 'Delivery' : 'Takeaway'}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )
                                }

                                if (billingSubTab === 'rooms') {
                                    return (
                                        // Occupied Rooms Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {filteredBillingRooms.map(room => {
                                                const booking = bookings.find(b => b.room_id === room.id && b.status === 'checked_in')

                                                return (
                                                    <button
                                                        key={room.id}
                                                        onClick={() => setSelectedBillingRoom(room)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
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
                                    )
                                }

                                if (billingSubTab === 'tables') {
                                    return (
                                        // Occupied Tables Grid
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {billingTableEntries.map(table => {
                                                const sessionItems = getTableSessionItems(table)

                                                return (
                                                    <button
                                                        key={table.uiKey}
                                                        onClick={() => setSelectedBillingTable(table)}
                                                        className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                                    >
                                                        <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
                                                            Table {table.label}
                                                        </span>
                                                        <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                            {sessionItems.length} items unpaid
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )
                                }

                                // Takeaway / Delivery Grid — one box per unpaid order, no
                                // session grouping. Customer name, short order id, phone.
                                const orderEntries = billingSubTab === 'takeout' ? billingTakeoutEntries : billingDeliveryEntries
                                return (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                        {orderEntries.map(order => (
                                            <button
                                                key={order.id}
                                                onClick={() => setSelectedBillingOrder(order)}
                                                className="aspect-square rounded-[20px] border border-red-200 bg-red-50/10 flex flex-col items-center justify-center p-4 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95"
                                            >
                                                <span className="text-lg font-black text-ink block leading-tight truncate max-w-full px-1">
                                                    {order.customer_name || 'Walk-in'}
                                                </span>
                                                <span className="text-[10px] font-bold text-ink-subtle mt-1.5 truncate max-w-full">
                                                    #{order.id.slice(0, 8).toUpperCase()}
                                                </span>
                                                {order.customer_phone && (
                                                    <span className="text-[10px] font-bold text-ink-subtle truncate max-w-full">
                                                        {order.customer_phone}
                                                    </span>
                                                )}
                                                <span className="uppercase tracking-wide mt-2 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border border-red-100 bg-red-50 text-red-700">
                                                    Awaiting Pay
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )
                            })()}
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

                    </div>
                )}

                {activeTab === 'orders' && (
                    <CashierOrdersPanel
                        active={active}
                        unpaid={unpaid}
                        splitSessionIds={splitSessionIds}
                        money={money}
                        onUpdateTakeoutStatus={handleUpdateStatus}
                        restaurantName={restaurantName}
                        onCancelOrder={(orderId) => {
                            setActive(prev => prev.filter(o => o.id !== orderId))
                            setUnpaid(prev => prev.filter(o => o.id !== orderId))
                        }}
                        onCancelOrderItem={(orderId, itemId, cancelQuantity) => {
                            const updateItems = (orders: any[]) => {
                                return orders.map(o => {
                                    if (o.id !== orderId) return o
                                    const targetItem = (o.order_items || []).find((i: any) => i.id === itemId)
                                    if (!targetItem) return o

                                    let updatedItems: any[]
                                    if (cancelQuantity >= targetItem.quantity) {
                                        updatedItems = (o.order_items || []).map((i: any) => i.id === itemId ? { ...i, status: 'cancelled' } : i)
                                    } else {
                                        updatedItems = []
                                        for (const i of o.order_items || []) {
                                            if (i.id === itemId) {
                                                updatedItems.push({
                                                    ...i,
                                                    quantity: i.quantity - cancelQuantity
                                                })
                                                updatedItems.push({
                                                    ...i,
                                                    id: `${itemId}-cancelled`,
                                                    quantity: cancelQuantity,
                                                    status: 'cancelled'
                                                })
                                            } else {
                                                updatedItems.push(i)
                                            }
                                        }
                                    }
                                    return {
                                        ...o,
                                        order_items: updatedItems
                                    }
                                }).filter(o => {
                                    if (o.id === orderId) {
                                        return (o.order_items || []).some((i: any) => i.status !== 'cancelled')
                                    }
                                    return true
                                })
                            }
                            setActive(prev => updateItems(prev))
                            setUnpaid(prev => updateItems(prev))
                        }}
                    />
                )}
            </div>

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
                                        {isExceeded && (
                                            <p className="text-[9px] text-rose-600 font-bold mt-1">⚠ Exceeded by {extraHours} hr(s)</p>
                                        )}
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
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(stayCost)}</span>
                                        </div>

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
                                                    <p className="font-extrabold text-rose-600 font-bold">Room Stay Discount</p>
                                                    <p className="text-[10px] text-gray-400 truncate max-w-[220px]">{discountReason || 'Reason required'}</p>
                                                </div>
                                                <span className="font-extrabold text-rose-600 tabular-nums">− {money(roomDiscountVal)}</span>
                                            </div>
                                        )}

                                        {foodDiscountVal > 0 && (
                                            <div className="flex justify-between items-center p-4 text-xs bg-rose-50/40">
                                                <div>
                                                    <p className="font-extrabold text-rose-600 font-bold">Order/Food Discount</p>
                                                    <p className="text-[10px] text-gray-400 truncate max-w-[220px]">{discountReason || 'Reason required'}</p>
                                                </div>
                                                <span className="font-extrabold text-rose-600 tabular-nums">− {money(foodDiscountVal)}</span>
                                            </div>
                                        )}

                                        {billingLinkedOrders.length > 0 && (
                                            <div className="p-4 space-y-2">
                                                <p className="font-extrabold text-xs text-indigo-650 font-semibold">Service Orders (QR + Dining)</p>
                                                <div className="space-y-1.5 pl-3 border-l-2 border-indigo-100">
                                                    {billingLinkedOrders.map((item) => (
                                                        <div key={item.id} className="flex justify-between text-[10px] text-ink-muted">
                                                            <span>{getItemDisplayName(item)} ({item.quantity}×)</span>
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

                                {/* Extra Hour Charge Box (shown only if check-out time is exceeded) */}
                                {isExceeded && (
                                    <div className="border border-rose-200 rounded-2xl p-4 space-y-3 bg-rose-50/40 shadow-sm animate-scale-in">
                                        <div className="flex items-center gap-2 pb-2 border-b border-rose-100">
                                            <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                                                <Clock size={14} className="text-rose-700" />
                                            </div>
                                            <div>
                                                <p className="text-xs font-black text-rose-800 uppercase tracking-wider">Late Checkout Alert</p>
                                                <p className="text-[10px] text-rose-700/70 font-semibold">Exceeded by {extraHours} hour(s)</p>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="block text-[9px] font-black text-rose-800 uppercase">Extra Hour Charge (Optional)</label>
                                            <div className="relative">
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-rose-700">Rs.</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    placeholder="0.00"
                                                    value={extraHourCharge}
                                                    onChange={e => setExtraHourCharge(e.target.value)}
                                                    className="w-full pl-7 pr-2 py-2 border border-rose-200 rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-rose-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Discounts section */}
                                <div className="border border-hairline rounded-2xl p-4 space-y-4 bg-surface-muted/30">
                                    <div className="flex items-center gap-2 pb-2 border-b border-hairline">
                                        <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                            <Percent size={14} className="text-amber-700" />
                                        </div>
                                        <div>
                                            <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Discounts</p>
                                            <p className="text-[10px] text-amber-700/70 font-semibold">Apply discounts to Room rent and/or Food orders</p>
                                        </div>
                                    </div>

                                    <div className={totalFoodOrders > 0 ? "grid grid-cols-2 gap-4" : "space-y-1"}>
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
                                                    className={`w-full pl-7 pr-2 py-2 border rounded-xl text-xs font-bold bg-surface focus:outline-none ${roomDiscountVal < 0 || roomDiscountVal > stayCost ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                />
                                            </div>
                                            <span className="text-[9px] text-amber-700/60 font-semibold">Max: {money(stayCost)}</span>
                                        </div>

                                        {totalFoodOrders > 0 && (
                                            <div className="space-y-1">
                                                <label className="block text-[9px] font-black text-amber-800 uppercase">Food Discount</label>
                                                <div className="relative">
                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max={totalFoodOrders}
                                                        placeholder="0.00"
                                                        value={foodDiscount}
                                                        onChange={e => setFoodDiscount(e.target.value)}
                                                        className={`w-full pl-7 pr-2 py-2 border rounded-xl text-xs font-bold bg-surface focus:outline-none ${foodDiscountVal < 0 || foodDiscountVal > totalFoodOrders ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                    />
                                                </div>
                                                <span className="text-[9px] text-amber-700/60 font-semibold">Max: {money(totalFoodOrders)}</span>
                                            </div>
                                        )}
                                    </div>

                                    {totalDiscountAmount > 0 && (
                                        <div className="space-y-1">
                                            <label className="block text-[9px] font-black text-amber-800 uppercase">Discount Reason (required)</label>
                                            <input
                                                type="text"
                                                value={discountReason}
                                                onChange={e => setDiscountReason(e.target.value)}
                                                placeholder="e.g. Regular guest / service delay compensation"
                                                className="w-full px-3 py-2 border rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-amber-500"
                                            />
                                        </div>
                                    )}
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
                                            <Select
                                                value={billingQrCodeId}
                                                onChange={e => setBillingQrCodeId(e.target.value)}
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
                                                                disabled={discountInvalid || (totalDiscountAmount > 0 && !discountReason.trim())}
                                                                onClick={() => handleCloseGuestDirectly(selectedBillingRoom)}
                                                                className="px-6 text-xs animate-scale-in"
                                                            >
                                                                Close Guest
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                variant="primary"
                                                                disabled={discountInvalid || (totalDiscountAmount > 0 && !discountReason.trim())}
                                                                onClick={() => compileInvoice('room', selectedBillingRoom)}
                                                                className="px-6 text-xs animate-scale-in"
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
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline flex flex-col max-h-[90vh] md:max-h-[85vh] animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline px-6 py-4 bg-surface-muted/50 flex-shrink-0">
                            <div>
                                <h3 className="text-lg font-black text-ink">Table {selectedBillingTable.label} details</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">Capacity: {selectedBillingTable.capacity} Seats</p>
                            </div>
                            <button onClick={() => setSelectedBillingTable(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        <div className="space-y-6 p-6 overflow-y-auto flex-1">
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Session order items</h4>
                                {getTableSessionItems(selectedBillingTable).length > 0 ? (
                                    <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface p-4 space-y-2">
                                        {getTableSessionItems(selectedBillingTable).map((item) => (
                                            <div key={item.id} className="flex justify-between items-center py-1.5 text-xs">
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
                                const tableDiscountAmount = tableDiscount.trim() !== '' ? parseFloat(tableDiscount) || 0 : 0
                                const tableDiscountInvalid = tableDiscountAmount < 0 || tableDiscountAmount > tableSubtotal

                                return (
                                    <div className="space-y-6">
                                        {Math.abs(taxOrServiceAdjustment) > 0.01 && (
                                            <div className="flex justify-between items-center px-1 text-xs">
                                                <span className="text-ink-subtle font-semibold">Tax / Service charge</span>
                                                <span className="font-bold text-ink-muted tabular-nums">{money(taxOrServiceAdjustment)}</span>
                                            </div>
                                        )}
                                        {tableDiscountAmount > 0 && (
                                            <div className="flex justify-between items-center px-1 text-xs text-rose-600">
                                                <span className="font-semibold">Food Discount</span>
                                                <span className="font-extrabold tabular-nums">− {money(tableDiscountAmount)}</span>
                                            </div>
                                        )}

                                        {/* Food Discount */}
                                        <div className="border-2 border-amber-200 rounded-2xl p-4 space-y-3 bg-amber-50/60 shadow-sm">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                                        <Percent size={14} className="text-amber-700" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Food Discount</p>
                                                        <p className="text-[10px] text-amber-700/70 font-semibold">Standard total: {money(tableSubtotal)}</p>
                                                    </div>
                                                </div>
                                                <div className="relative w-32">
                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max={tableSubtotal}
                                                        placeholder="0.00"
                                                        value={tableDiscount}
                                                        onChange={e => setTableDiscount(e.target.value)}
                                                        className={`w-full pl-7 pr-2 py-2 border-2 rounded-xl text-xs font-bold bg-white focus:outline-none ${tableDiscountInvalid ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                    />
                                                </div>
                                            </div>
                                            {tableDiscountInvalid && (
                                                <p className="text-[9px] text-rose-500 font-bold">Discount must be between Rs. 0 and the standard total.</p>
                                            )}
                                            {tableDiscountAmount > 0 && (
                                                <div>
                                                    <label className="block text-[9px] font-black text-amber-700 uppercase mb-1">Reason (required)</label>
                                                    <input
                                                        type="text"
                                                        value={tableDiscountReason}
                                                        onChange={e => setTableDiscountReason(e.target.value)}
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
                                                                max={tableSubtotal - tableDiscountAmount}
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
                                                                max={tableSubtotal - tableDiscountAmount}
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
                                                        const remainder = (tableSubtotal - tableDiscountAmount) - cash - qr
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
                                                    <Select
                                                        value={billingQrCodeId}
                                                        onChange={e => setBillingQrCodeId(e.target.value)}
                                                        className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                    >
                                                        <option value="">Select QR code…</option>
                                                        {qrCodes.map(qr => (
                                                            <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                        ))}
                                                    </Select>
                                                </div>
                                            )}

                                            {billingPaymentMethod === 'credit' && (
                                                <p className="mt-3 text-[10px] text-ink-subtle font-semibold text-center">
                                                    You&apos;ll confirm the customer&apos;s name and phone in the next step.
                                                </p>
                                            )}
                                        </div>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>

                        {/* Fixed Footer */}
                        {(() => {
                            const tableSubtotal = getTableSessionOrdersTotal(selectedBillingTable)
                            const tableDiscountAmount = tableDiscount.trim() !== '' ? parseFloat(tableDiscount) || 0 : 0
                            const tableDiscountInvalid = tableDiscountAmount < 0 || tableDiscountAmount > tableSubtotal
                            const tableTotal = Math.max(0, tableSubtotal - tableDiscountAmount)

                            return (
                                <div className="border-t border-hairline px-6 py-4 flex-shrink-0 bg-surface flex items-center justify-between">
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
                                                className="px-6 text-xs animate-scale-in"
                                             >
                                                 Close Guest
                                             </Button>
                                        ) : (
                                            <Button
                                                variant="primary"
                                                disabled={
                                                    tableDiscountInvalid ||
                                                    (tableDiscountAmount > 0 && !tableDiscountReason.trim())
                                                }
                                                onClick={() => compileInvoice('table', selectedBillingTable)}
                                                className="px-6 text-xs animate-scale-in"
                                            >
                                                Generate Invoice
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })()}
                    </div>
                </div>,
                document.body
            )}

            {/* Takeaway/delivery order details modal — same structure as the
                table one above, but a single standalone order (no session,
                no getTableSessionItems). */}
            {mounted && selectedBillingOrder && createPortal(
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
                    onClick={() => setSelectedBillingOrder(null)}
                >
                    <div
                        className="bg-surface w-full max-w-2xl rounded-[28px] shadow-2xl overflow-hidden border border-hairline p-6 space-y-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-hairline pb-4">
                            <div>
                                <h3 className="text-lg font-black text-ink">{selectedBillingOrder.customer_name || 'Walk-in Customer'}</h3>
                                <p className="text-xs text-ink-subtle mt-0.5">
                                    #{selectedBillingOrder.id.slice(0, 8).toUpperCase()}
                                    {selectedBillingOrder.customer_phone && <> · {selectedBillingOrder.customer_phone}</>}
                                </p>
                                {selectedBillingOrder.order_type === 'delivery' && selectedBillingOrder.delivery_address && (
                                    <p className="text-xs text-ink-subtle mt-0.5">{selectedBillingOrder.delivery_address}</p>
                                )}
                            </div>
                            <button onClick={() => setSelectedBillingOrder(null)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"><X size={16} /></button>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider">Order items</h4>
                            {(selectedBillingOrder.order_items || []).length > 0 ? (
                                <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface p-4 space-y-2">
                                    {selectedBillingOrder.order_items.map((oi, idx) => (
                                        <div key={oi.id || idx} className="flex justify-between items-center py-1.5 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink">{getItemDisplayName(oi)}</p>
                                                <p className="text-[10px] text-ink-subtle">Qty: {oi.quantity} × {money(Number(oi.unit_price) || 0)}</p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money((Number(oi.unit_price) || 0) * oi.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center border border-dashed border-hairline-strong rounded-xl text-xs text-ink-subtle font-semibold">
                                    No items on this order
                                </div>
                            )}
                        </div>

                        {(() => {
                            const orderSubtotal = Number(selectedBillingOrder.total_amount) || 0
                            const bargainRateEntered = tableBargainRate.trim() !== ''
                            const bargainRateValue = bargainRateEntered ? parseFloat(tableBargainRate) || 0 : orderSubtotal
                            const orderDiscountAmount = bargainRateEntered ? Math.max(0, orderSubtotal - bargainRateValue) : 0
                            const orderDiscountInvalid = bargainRateEntered && (bargainRateValue < 0 || bargainRateValue > orderSubtotal)
                            const orderTotal = orderSubtotal - orderDiscountAmount
                            const invoiceType = selectedBillingOrder.order_type === 'delivery' ? 'delivery' : 'takeout'

                            return (
                                <>
                                    {/* Bargain rate */}
                                    <div className="border-2 border-amber-200 rounded-2xl p-4 space-y-3 bg-amber-50/60 shadow-sm">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                                    <Percent size={14} className="text-amber-700" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-amber-800 uppercase tracking-wider">Bargain Rate</p>
                                                    <p className="text-[10px] text-amber-700/70 font-semibold">Standard total: {money(orderSubtotal)}</p>
                                                </div>
                                            </div>
                                            <div className="relative w-32">
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-amber-700">Rs.</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max={orderSubtotal}
                                                    placeholder={orderSubtotal.toFixed(2)}
                                                    value={tableBargainRate}
                                                    onChange={e => setTableBargainRate(e.target.value)}
                                                    className={`w-full pl-7 pr-2 py-2 border-2 rounded-xl text-xs font-bold bg-white focus:outline-none ${orderDiscountInvalid ? 'border-rose-400 focus:border-rose-500' : 'border-amber-200 focus:border-amber-500'}`}
                                                />
                                            </div>
                                        </div>
                                        {orderDiscountInvalid && (
                                            <p className="text-[9px] text-rose-500 font-bold">Rate must be between Rs. 0 and the standard total.</p>
                                        )}
                                        {orderDiscountAmount > 0 && (
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
                                                            max={orderTotal}
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
                                                            max={orderTotal}
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
                                                    const remainder = orderTotal - cash - qr
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
                                                <Select
                                                    value={billingQrCodeId}
                                                    onChange={e => setBillingQrCodeId(e.target.value)}
                                                    className="w-full px-3 py-2 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                >
                                                    <option value="">Select QR code…</option>
                                                    {qrCodes.map(qr => (
                                                        <option key={qr.id} value={qr.id}>{qr.label}</option>
                                                    ))}
                                                </Select>
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
                                            <span className="text-[10px] font-bold text-ink-subtle uppercase">Total bill</span>
                                            <p className="text-2xl font-black text-brand-600 tabular-nums">{money(orderTotal)}</p>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                            <Button variant="secondary" onClick={() => setSelectedBillingOrder(null)}>Close</Button>
                                            {!irdSyncEnabled ? (
                                                <Button
                                                    variant="primary"
                                                    onClick={() => {
                                                        const data = buildInvoiceData(invoiceType, selectedBillingOrder)
                                                        if (data) {
                                                            setActiveInvoice(data)
                                                        }
                                                    }}
                                                    className="bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 px-6 font-bold text-white text-xs animate-scale-in"
                                                >
                                                    Close Order
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="primary"
                                                    disabled={
                                                        orderDiscountInvalid ||
                                                        (orderDiscountAmount > 0 && !tableBargainReason.trim())
                                                    }
                                                    onClick={() => compileInvoice(invoiceType, selectedBillingOrder)}
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
                        <InvoiceReceipt invoice={activeInvoice} money={money} formatDate={formatDate} restaurantName={restaurantName} restaurantAddress={restaurantAddress} restaurantPhone={restaurantPhone} />

                        {/* Invoice Footer Actions (Print, Mark Paid, Close) */}
                        <div className="flex gap-2 pt-3 border-t border-gray-100 print-actions flex-wrap">
                            {invoiceSettled ? (
                                <div className="flex-1 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold flex items-center justify-center gap-1.5">
                                    <CheckCircle size={13} />
                                    Paid
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
                                            onClick={() => handleMarkPaid()}
                                            className="font-bold flex-1 bg-brand-500 hover:bg-brand-600 border-brand-500 hover:border-brand-600 text-[10px] text-white py-1.5 min-w-[70px] animate-scale-in"
                                        >
                                            Close Guest
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            loading={isSettlingInvoice}
                                            onClick={() => handleMarkPaid()}
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

            {/* Manual Entry Modal — inline, no navigation away from the dashboard */}
            {mounted && showManualEntry && createPortal(
                <div
                    className="fixed inset-0 z-[9999] flex items-start justify-center p-4 md:p-8 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
                    onClick={() => setShowManualEntry(false)}
                >
                    <div
                        className="bg-canvas rounded-[24px] border border-hairline shadow-2xl w-full max-w-5xl my-auto overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-end px-4 py-2.5 border-b border-hairline bg-surface">
                            <button
                                onClick={() => setShowManualEntry(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6 max-h-[85vh] overflow-y-auto">
                            <ManualEntryClient
                                bankAccounts={manualEntryBankAccounts}
                                suppliers={manualEntrySuppliers}
                                staffList={manualEntryStaffList}
                                expenseCategories={manualEntryExpenseCategories}
                                ingredients={manualEntryIngredients}
                                hasOpenSession={manualEntryHasOpenSession}
                                sessionId={manualEntrySessionId}
                                userRole={userRole}
                            />
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {showTakeoutQuickOrder && (
                <QuickOrderModal
                    isOpen={showTakeoutQuickOrder}
                    onClose={() => setShowTakeoutQuickOrder(false)}
                    restaurantId={restaurantId}
                    isManualTakeoutDelivery={true}
                />
            )}

            {/* Browser-print fallback for tickets no thermal printer took. One
                at a time — window.print() is modal, so the queue drains as each
                afterprint fires. */}
            {ticketFallbackQueue.length > 0 && (
                <KotPrintFallback
                    order={ticketFallbackQueue[0].order}
                    station={ticketFallbackQueue[0].station}
                    onDone={dequeueTicketFallback}
                />
            )}

        </div>
    )
}
