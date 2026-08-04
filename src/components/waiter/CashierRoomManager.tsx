'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRestaurantTable } from '@/lib/realtime/useRestaurantTable'
import { createClient } from '@/lib/supabase/client'
import { Users, X, Check, Bed, ClipboardList, Loader2, CreditCard, RefreshCw, Calendar, FileText, Plus, Landmark, Utensils, ArrowLeftRight, History, RotateCcw, Car, Pencil, Layers, Link2, Unlink, AlertTriangle, Lock } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { useCurrency, useFeatures, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { type TableWithSession } from './CashierTableManager'
import { type GroupBill } from '@/lib/bookingGroup'
import { calculateNights, getBookingCustomPrice, getBookingKycNote, advanceMethodLabel, getItemDisplayName, defaultStayWindowInputs } from '@/lib/utils'
import { describeGuestMix, totalGuests } from '@/lib/guests'
import QuickOrderModal from './QuickOrderModal'
import { openSession } from '@/app/(staff)/waiter/actions'
import { useQrCodes } from '@/lib/hooks/useQrCodes'
import { useGuestLookup, type GuestSuggestion } from '@/lib/hooks/useGuestLookup'
import GuestSuggestionList from './GuestSuggestionList'
import { getRoomStatusConfig } from '@/lib/roomStatus'
import { autoRoomServiceCharge, resolveRoomServiceCharge, roomServiceChargeApplies, ROOM_SERVICE_CHARGE_RATE } from '@/lib/roomServiceCharge'
import Select from '@/components/ui/Select'
import { NepaliDateInput, NepaliDateTimeInput } from '@/components/ui/NepaliDateInput'
import { useDates } from '@/lib/contexts/CalendarContext'
import AdvancePaymentHistoryModal from '@/components/admin/AdvancePaymentHistoryModal'

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
    roomTypeFilter = 'all',
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
    roomTypeFilter?: string
    tables: TableWithSession[]
    activeOrders: any[]
    unpaidOrders: any[]
    // The service charge the cashier settled on here rides along, so the
    // billing panel opens on the same figure instead of resetting to auto.
    onGoToBilling?: (room: any, serviceChargeOverride?: number) => void
    onOrderPlaced?: (orderId: string) => void
}) {
    const [selectedRoom, setSelectedRoom] = useState<RoomWithTypes | null>(null)
    const [activeBooking, setActiveBooking] = useState<any | null>(null)
    const [loadingBooking, setLoadingBooking] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false)
    const [mounted, setMounted] = useState(false)
    // Both service-charge edits are stamped with the room they were made on, so
    // opening the next folio starts from auto again without an effect having to
    // chase selectedRoom and clear them.
    const [serviceChargeEdit, setServiceChargeEdit] = useState<{ roomId: string; value: string } | null>(null)
    const [serviceChargeOffRoomId, setServiceChargeOffRoomId] = useState<string | null>(null)
    const features = useFeatures()
    const irdSyncEnabled = features?.irdSyncEnabled ?? false
    const money = useCurrency()
    const supabaseRef = useRef(createClient())
    const manualEntryEnabled = useFeatureEnabled('manualEntryEnabled')
    const { formatDateTime } = useDates()

    // Sub-modal and drawer states
    const [bookingFormOpen, setBookingFormOpen] = useState(false)
    const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
    const [confirmDirtyOpen, setConfirmDirtyOpen] = useState(false)
    
    // Manual charge addition states
    const [manualCharges, setManualCharges] = useState<any[]>([])
    const [linkedDiningOrders, setLinkedDiningOrders] = useState<any[]>([])
    // The rest of the reservation when this room is one of several booked
    // together (see /api/bookings/group). They settle on one bill, so the room
    // cost and advance shown in this drawer have to be the reservation's, not
    // just this room's share. Null for an ordinary single-room stay.
    const [stayGroup, setStayGroup] = useState<GroupBill | null>(null)
    const filteredLinkedDiningOrders = (() => {
        return linkedDiningOrders.filter(o => !o.is_room_order && o.status !== 'cancelled')
    })()
    const [loadingCharges, setLoadingCharges] = useState(false)
    const [showAddChargeForm, setShowAddChargeForm] = useState(false)
    const [newCharge, setNewCharge] = useState({
        charge_type: 'minibar',
        description: '',
        amount: ''
    })
    // Room move ("the guest is in 201 but wants 305")
    const [moveOpen, setMoveOpen] = useState(false)
    const [moveTargetId, setMoveTargetId] = useState<string>('')
    const [moveReason, setMoveReason] = useState('')
    const [moving, setMoving] = useState(false)

    const [foodOrderModalOpen, setFoodOrderModalOpen] = useState(false)
    const [createdSessionId, setCreatedSessionId] = useState<string | null>(null)
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    // Helper to reset booking form + sub-views when opening/closing a room modal
    const resetRoomModal = () => {
        setBookingFormOpen(false)
        setConfirmCloseOpen(false)
        setConfirmDirtyOpen(false)
        setShowAddChargeForm(false)
        setMoveOpen(false)
        setMoveTargetId('')
        setMoveReason('')
        setBookingForm({ guest_name: '', guest_phone: '', kyc_type: '', kyc: '', check_in: '', check_out: '', custom_room_price: '', adult_male: '1', adult_female: '1', children: '0', parking_required: false, parking_vehicle_no: '', parking_fee: '' })
        setLinkToBookingId('')
        setExtraRooms({})
        setLookupField(null)
        setGuestPicked(false)
        setAdvanceType('none')
        setAdvanceAmount('')
        setAdvanceNote('')
        setAdvanceSplitCash('')
        setAdvanceSplitQr('')
    }

    const [linkToBookingId, setLinkToBookingId] = useState<string>('')

    // Booking form inputs
    const [bookingForm, setBookingForm] = useState({
        guest_name: '',
        guest_phone: '',
        kyc_type: '',
        kyc: '',
        check_in: '',
        check_out: '',
        custom_room_price: '',
        adult_male: '1',
        adult_female: '1',
        children: '0',
        parking_required: false,
        parking_vehicle_no: '',
        parking_fee: '',
    })
    // Which field is driving the returning-guest lookup. The desk may know the
    // number or the name, so both search — but only the one being typed in,
    // otherwise a filled-in name would keep querying while they type the phone.
    const [lookupField, setLookupField] = useState<'guest_phone' | 'guest_name' | null>(null)
    // Suppressed right after a suggestion is applied: the fields now hold that
    // guest's own details, which would otherwise match themselves and leave the
    // list hanging open under the form.
    const [guestPicked, setGuestPicked] = useState(false)

    const { suggestions: guestSuggestions, loading: guestLookupLoading } = useGuestLookup(
        lookupField ? bookingForm[lookupField] : '',
        { enabled: bookingFormOpen && !guestPicked && lookupField !== null },
    )

    /** Fill the form from a past stay, so a returning guest is not retyped. */
    const applyGuestSuggestion = (guest: GuestSuggestion) => {
        setBookingForm(b => ({
            ...b,
            guest_name: guest.name || b.guest_name,
            guest_phone: guest.phone || b.guest_phone,
            // Only overwrite KYC when we actually have one on file — a blank
            // from an old stay must not wipe what the cashier just typed.
            kyc: guest.kyc || b.kyc,
        }))
        setGuestPicked(true)
        setLookupField(null)
    }

    // Extra rooms this same guest is taking, keyed by room id. The room the
    // front desk clicked is always the first room of the reservation and isn't
    // in here; anything added makes this a multi-room booking, which the API
    // turns into one reservation group billing onto a single folio.
    const [extraRooms, setExtraRooms] = useState<Record<string, { adult_male: string; adult_female: string; children: string }>>({})

    const [advanceType, setAdvanceType] = useState<'none' | 'full' | 'partial'>('none')
    const [advanceAmount, setAdvanceAmount] = useState<string>('')
    const [advanceNote, setAdvanceNote] = useState<string>('')
    const [advancePayMethod, setAdvancePayMethod] = useState<'cash' | 'qr_digital' | 'split'>('cash')
    const [advanceSplitCash, setAdvanceSplitCash] = useState<string>('')
    const [advanceSplitQr, setAdvanceSplitQr] = useState<string>('')
    const [advanceQrCodeId, setAdvanceQrCodeId] = useState<string>('')
    const qrCodes = useQrCodes()

    const [addPaymentOpen, setAddPaymentOpen] = useState(false)
    const [addPaymentAmount, setAddPaymentAmount] = useState('')
    const [addPaymentNote, setAddPaymentNote] = useState('')
    const [addPaymentMethod, setAddPaymentMethod] = useState<'cash' | 'qr_digital' | 'split'>('cash')
    const [addPaymentSplitCash, setAddPaymentSplitCash] = useState('')
    const [addPaymentSplitQr, setAddPaymentSplitQr] = useState('')
    const [addPaymentQrId, setAddPaymentQrId] = useState('')
    const [submittingPayment, setSubmittingPayment] = useState(false)

    const [advanceHistoryOpen, setAdvanceHistoryOpen] = useState(false)

    // Edit active booking state
    const [isEditMode, setIsEditMode] = useState(false)
    const [editReason, setEditReason] = useState('')

    // Combine bills state
    const [combineBillsOpen, setCombineBillsOpen] = useState(false)
    const [loadingCandidates, setLoadingCandidates] = useState(false)
    const [combineCandidates, setCombineCandidates] = useState<any[]>([])
    const [alreadyCombined, setAlreadyCombined] = useState(false)
    const [selectedAddBookingIds, setSelectedAddBookingIds] = useState<string[]>([])
    const [combiningBills, setCombiningBills] = useState(false)
    const [unlinkingBookingId, setUnlinkingBookingId] = useState<string | null>(null)

    const handleOpenEditBooking = () => {
        if (!activeBooking || !selectedRoom) return
        const currentCustomPrice = getBookingCustomPrice(activeBooking)
        const effectivePrice = currentCustomPrice > 0
            ? String(currentCustomPrice)
            : (selectedRoom.room_types?.base_price ? String(selectedRoom.room_types.base_price) : '')

        const rawKyc = getBookingKycNote(activeBooking)
        let kycType = ''
        let kycVal = ''
        if (rawKyc) {
            if (rawKyc.includes(':')) {
                const parts = rawKyc.split(':')
                kycType = parts[0].trim()
                kycVal = parts.slice(1).join(':').trim()
            } else {
                kycVal = rawKyc
            }
        }

        setBookingForm({
            guest_name: activeBooking.guest_name || '',
            guest_phone: activeBooking.guest_phone || '',
            kyc_type: kycType,
            kyc: kycVal,
            check_in: activeBooking.check_in ? activeBooking.check_in.slice(0, 16) : '',
            check_out: activeBooking.check_out ? activeBooking.check_out.slice(0, 16) : '',
            custom_room_price: effectivePrice,
            adult_male: String(activeBooking.adult_male ?? 1),
            adult_female: String(activeBooking.adult_female ?? 0),
            children: String(activeBooking.children ?? 0),
            parking_required: !!activeBooking.parking_required,
            parking_vehicle_no: activeBooking.parking_vehicle_no || '',
            parking_fee: activeBooking.parking_fee ? String(activeBooking.parking_fee) : '',
        })
        setEditReason('')
        setIsEditMode(true)
        setBookingFormOpen(true)
    }

    const handleBookExtraRoomForGuest = () => {
        if (!activeBooking) return
        const freeRoom = rooms.find(r => r.status === 'available')
        if (!freeRoom) {
            toast.error('No available rooms right now to book an extra room')
            return
        }

        const rawKyc = getBookingKycNote(activeBooking)
        let kycType = ''
        let kycVal = ''
        if (rawKyc) {
            if (rawKyc.includes(':')) {
                const parts = rawKyc.split(':')
                kycType = parts[0].trim()
                kycVal = parts.slice(1).join(':').trim()
            } else {
                kycVal = rawKyc
            }
        }

        setSelectedRoom(freeRoom)
        setBookingForm({
            guest_name: activeBooking.guest_name || '',
            guest_phone: activeBooking.guest_phone || '',
            kyc_type: kycType,
            kyc: kycVal,
            check_in: activeBooking.check_in ? activeBooking.check_in.slice(0, 16) : '',
            check_out: activeBooking.check_out ? activeBooking.check_out.slice(0, 16) : '',
            custom_room_price: '',
            adult_male: '1',
            adult_female: '0',
            children: '0',
            parking_required: false,
            parking_vehicle_no: '',
            parking_fee: '',
        })
        setLinkToBookingId(activeBooking.id)
        setIsEditMode(false)
        setBookingFormOpen(true)
    }

    const handleSaveEditBooking = async () => {
        if (!activeBooking) return
        if (!bookingForm.guest_name.trim()) {
            toast.error('Guest name is required')
            return
        }
        if (!bookingForm.guest_phone.trim()) {
            toast.error('Phone number is required')
            return
        }
        if (!editReason.trim()) {
            toast.error('Please enter a reason for updating the booking (required for audit log)')
            return
        }

        const formattedKyc = bookingForm.kyc_type
            ? (bookingForm.kyc?.trim() ? `${bookingForm.kyc_type}: ${bookingForm.kyc.trim()}` : bookingForm.kyc_type)
            : bookingForm.kyc?.trim()

        setIsProcessing(true)
        try {
            const res = await fetch('/api/bookings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: activeBooking.id,
                    guest_name: bookingForm.guest_name,
                    guest_phone: bookingForm.guest_phone,
                    kyc: formattedKyc || null,
                    custom_room_price: bookingForm.custom_room_price ? (parseFloat(bookingForm.custom_room_price) || 0) : 0,
                    check_in: bookingForm.check_in,
                    check_out: bookingForm.check_out,
                    adult_male: parseInt(bookingForm.adult_male) || 1,
                    adult_female: parseInt(bookingForm.adult_female) || 0,
                    children: parseInt(bookingForm.children) || 0,
                    parking_required: bookingForm.parking_required,
                    parking_vehicle_no: bookingForm.parking_vehicle_no || undefined,
                    parking_fee: bookingForm.parking_required ? (parseFloat(bookingForm.parking_fee) || 0) : 0,
                    reason: editReason.trim(),
                }),
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to update booking')

            // If extra available rooms were selected during edit, create bookings for them and link to this stay
            if (selectedExtraIds.length > 0) {
                const extraRes = await fetch('/api/bookings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rooms: selectedExtraIds.map(roomId => ({
                            room_id: roomId,
                            adult_male: extraRooms[roomId]?.adult_male || '1',
                            adult_female: extraRooms[roomId]?.adult_female || '0',
                            children: extraRooms[roomId]?.children || '0',
                        })),
                        guest_name: bookingForm.guest_name,
                        guest_phone: bookingForm.guest_phone,
                        kyc: formattedKyc || null,
                        check_in: bookingForm.check_in,
                        check_out: bookingForm.check_out,
                        custom_room_price: bookingForm.custom_room_price ? (parseFloat(bookingForm.custom_room_price) || undefined) : undefined,
                        advance_amount: 0,
                        advance_payment_method: 'none',
                        parking_required: false,
                    }),
                })
                const extraData = await extraRes.json()
                if (!extraRes.ok) {
                    throw new Error(extraData.error || 'Failed to book extra room')
                }

                if (extraData.data?.id) {
                    const newIds = (extraData.bookings || [extraData.data]).map((b: any) => b.id)
                    const combineRes = await fetch('/api/bookings/combine-bill', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: activeBooking.id,
                            addBookingIds: newIds,
                        }),
                    })
                    const combineData = await combineRes.json()
                    if (!combineRes.ok) {
                        throw new Error(combineData.error || 'Failed to link extra room to bill')
                    }
                }

                // Update local rooms state to mark extra rooms as occupied immediately
                const extraSet = new Set(selectedExtraIds)
                setRooms(prev => prev.map(r => extraSet.has(r.id) ? { ...r, status: 'occupied' } : r))
            }

            toast.success(selectedExtraIds.length > 0 ? 'Booking updated and extra room(s) added successfully!' : 'Booking updated successfully!')
            setExtraRooms({})
            setBookingFormOpen(false)
            setIsEditMode(false)
            setRefreshTrigger(prev => prev + 1)
        } catch (err: any) {
            toast.error(err.message || 'Error updating booking')
        } finally {
            setIsProcessing(false)
        }
    }

    const handleOpenCombineBills = async () => {
        if (!activeBooking) return
        setLoadingCandidates(true)
        setCombineBillsOpen(true)
        setSelectedAddBookingIds([])
        try {
            const res = await fetch(`/api/bookings/combine-bill?bookingId=${activeBooking.id}`)
            const data = await res.json()
            if (data.success) {
                setCombineCandidates(data.candidates || [])
                setAlreadyCombined(!!data.alreadyCombined)
            } else {
                toast.error(data.error || 'Failed to fetch candidate rooms')
            }
        } catch (err: any) {
            toast.error(err.message || 'Error fetching combine candidates')
        } finally {
            setLoadingCandidates(false)
        }
    }

    const handleCombineBillsSubmit = async () => {
        if (!activeBooking) return
        if (selectedAddBookingIds.length === 0) {
            toast.error('Select at least one other room to combine onto this bill')
            return
        }

        setCombiningBills(true)
        try {
            const res = await fetch('/api/bookings/combine-bill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: activeBooking.id,
                    addBookingIds: selectedAddBookingIds,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to combine bills')

            toast.success(`Successfully combined ${data.roomCount} rooms onto one bill!`)
            setCombineBillsOpen(false)
            setRefreshTrigger(prev => prev + 1)
        } catch (err: any) {
            toast.error(err.message || 'Failed to combine room bills')
        } finally {
            setCombiningBills(false)
        }
    }

    const handleUnlinkBill = async (bookingIdToDetach: string) => {
        setUnlinkingBookingId(bookingIdToDetach)
        try {
            const res = await fetch(`/api/bookings/combine-bill?bookingId=${bookingIdToDetach}`, {
                method: 'DELETE',
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to detach room from bill')

            toast.success('Room separated from combined bill')
            setRefreshTrigger(prev => prev + 1)
            // Re-fetch combine candidates if combine modal is open
            if (combineBillsOpen && activeBooking) {
                const freshRes = await fetch(`/api/bookings/combine-bill?bookingId=${activeBooking.id}`).then(r => r.json())
                if (freshRes.success) {
                    setCombineCandidates(freshRes.candidates || [])
                    setAlreadyCombined(!!freshRes.alreadyCombined)
                }
            }
        } catch (err: any) {
            toast.error(err.message || 'Failed to detach room')
        } finally {
            setUnlinkingBookingId(null)
        }
    }


    const handleAddMidStayPayment = async () => {
        if (!activeBooking) return
        
        let resolvedAmount = 0
        if (addPaymentMethod === 'split') {
            const splitCash = parseFloat(addPaymentSplitCash) || 0
            const splitQr = parseFloat(addPaymentSplitQr) || 0
            resolvedAmount = splitCash + splitQr
        } else {
            resolvedAmount = parseFloat(addPaymentAmount) || 0
        }

        if (resolvedAmount <= 0) {
            toast.error('Please enter a valid amount greater than 0')
            return
        }

        setSubmittingPayment(true)
        try {
            const res = await fetch('/api/bookings/advance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: activeBooking.id,
                    amount: resolvedAmount,
                    paymentMethod: addPaymentMethod,
                    cashAmount: addPaymentSplitCash,
                    qrAmount: addPaymentSplitQr,
                    qrCodeId: addPaymentQrId || (qrCodes.length === 1 ? qrCodes[0].id : null),
                    note: addPaymentNote
                })
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to add payment')

            toast.success(`Payment of Rs. ${resolvedAmount.toLocaleString()} recorded successfully!`)
            setAddPaymentOpen(false)
            setRefreshTrigger(prev => prev + 1)
        } catch (err: any) {
            toast.error(err.message || 'Failed to record payment')
        } finally {
            setSubmittingPayment(false)
        }
    }

    // Parsed once so the header count, the capacity hint and the submit guard
    // all read the same numbers rather than each re-parsing the inputs.
    const guestTotals = useMemo(() => {
        const n = (v: string) => Math.max(0, Math.trunc(Number(v) || 0))
        const male = n(bookingForm.adult_male)
        const female = n(bookingForm.adult_female)
        return { male, female, adults: male + female, children: n(bookingForm.children) }
    }, [bookingForm.adult_male, bookingForm.adult_female, bookingForm.children])

    /** Rooms the front desk can add to this booking: free, not the one already
     * selected, and not held by a live stay. Same availability rule as a room
     * move, so the two can't disagree about what "free" means. */
    const addableRooms = useMemo(() => {
        const heldRoomIds = new Set(
            (bookings || [])
                .filter(b => b.status === 'checked_in' || b.status === 'pending')
                .map(b => b.room_id),
        )
        return rooms
            .filter(r => r.id !== selectedRoom?.id && !heldRoomIds.has(r.id) && r.status === 'available')
            .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }))
    }, [rooms, bookings, selectedRoom?.id])

    const selectedExtraIds = useMemo(() => Object.keys(extraRooms), [extraRooms])

    /** room id → how many rooms its reservation holds. 0/1 for a normal stay. */
    const groupSizeByRoomId = useMemo(() => {
        const countByGroup = new Map<string, number>()
        const live = (bookings || []).filter(b =>
            b.group_id && (b.status === 'checked_in' || b.status === 'pending')
        )
        for (const b of live) {
            countByGroup.set(b.group_id, (countByGroup.get(b.group_id) ?? 0) + 1)
        }
        return new Map(live.map(b => [b.room_id as string, countByGroup.get(b.group_id) ?? 1]))
    }, [bookings])

    /** Nightly rate across every room on the reservation — what a "full"
     * advance has to cover once more than one room is involved. A rate typed
     * into the form replaces the catalog price on every room, matching the
     * [CUSTOM_RATE:x] tag the API writes onto each booking. */
    const combinedNightlyRate = useMemo(() => {
        const agreedRate = bookingForm.custom_room_price.trim() !== ''
            ? (parseFloat(bookingForm.custom_room_price) || 0)
            : 0
        if (agreedRate > 0) return agreedRate * (selectedExtraIds.length + 1)
        const base = selectedRoom?.room_types?.base_price || 0
        return selectedExtraIds.reduce((sum, id) => {
            const room = rooms.find(r => r.id === id)
            return sum + (room?.room_types?.base_price || 0)
        }, base)
    }, [selectedRoom, selectedExtraIds, rooms, bookingForm.custom_room_price])

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

    // Rooms the guest could move into: in service, not the one they are in, and
    // with nobody else booked into them. Occupancy is judged by whether a stay
    // holds the room, not by the status flag — a room left 'dirty' after a
    // checkout is perfectly movable-into once housekeeping is done, and blocking
    // on the flag alone would hide it.
    const moveCandidates = useMemo(() => {
        const heldRoomIds = new Set(
            (bookings || [])
                .filter(b => b.status === 'checked_in' || b.status === 'pending')
                .map(b => b.room_id),
        )
        return rooms
            .filter(r => r.id !== selectedRoom?.id && !heldRoomIds.has(r.id) && r.status !== 'maintenance')
            .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }))
    }, [rooms, bookings, selectedRoom?.id])

    const handleMoveRoom = async () => {
        if (!activeBooking || !moveTargetId) return
        setMoving(true)
        try {
            const res = await fetch('/api/bookings/move-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    booking_id: activeBooking.id,
                    to_room_id: moveTargetId,
                    reason: moveReason,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Could not move the guest')

            toast.success(`${activeBooking.guest_name} moved to Room ${data.to_room}`)
            // Patch what this component owns; the rooms/bookings realtime
            // subscriptions carry the same change to every other open till.
            setRooms(prev => prev.map(r =>
                r.id === moveTargetId ? { ...r, status: 'occupied' }
                : r.id === selectedRoom?.id ? { ...r, status: 'dirty' }
                : r))
            setBookings(prev => prev.map(b => b.id === activeBooking.id ? { ...b, room_id: moveTargetId } : b))
            setMoveOpen(false)
            setSelectedRoom(null)
            resetRoomModal()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not move the guest')
        } finally {
            setMoving(false)
        }
    }

    // Prepopulate booking form check-in/out default values
    const prepopulateBookingForm = () => {
        // Default to a 1-night stay: in now, out at noon tomorrow (Kathmandu).
        const { checkIn, checkOut } = defaultStayWindowInputs()

        setBookingForm({
            guest_name: '',
            guest_phone: '',
            kyc_type: '',
            kyc: '',
            check_in: checkIn,
            check_out: checkOut,
            // Left blank on purpose: the field shows the catalog price as its
            // placeholder, and only a figure actually typed in gets tagged onto
            // the booking as an agreed rate. Pre-filling it would freeze every
            // booking at today's price and bypass the pricing rules.
            custom_room_price: '',
            adult_male: '1',
            adult_female: '0',
            children: '0',
            parking_required: false,
            parking_vehicle_no: '',
            parking_fee: '',
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
            setLoadingCharges(true)
            // One request for the whole panel. This was the booking lookup
            // followed by a second wave of three calls that needed its id —
            // two sequential trips to the edge before anything could render.
            // /api/rooms/panel keeps that ordering but runs it server-side,
            // next to the database, so the hop between the two steps costs a
            // local round trip instead of a Kathmandu one.
            fetch(`/api/rooms/panel?roomId=${selectedRoom.id}`)
                .then(res => res.json())
                .then(async (data) => {
                    if (data.success && data.booking) {
                        const booking = data.booking
                        try {
                            // Set all states simultaneously
                            setActiveBooking(booking)
                            setManualCharges(data.charges || [])
                            setLinkedDiningOrders(data.linkedOrders || [])
                            setStayGroup(data.group ?? null)
                        } catch (err) {
                            console.error("Error applying stay details:", err)
                            // Set basic stay booking at least
                            setActiveBooking(booking)
                            setManualCharges([])
                            setLinkedDiningOrders([])
                            setStayGroup(null)
                        }
                    } else {
                        setActiveBooking(null)
                        setManualCharges([])
                        setLinkedDiningOrders([])
                        setStayGroup(null)
                    }
                })
                .catch(err => {
                    console.error("Error fetching room booking details:", err)
                    setActiveBooking(null)
                    setManualCharges([])
                    setLinkedDiningOrders([])
                    setStayGroup(null)
                })
                .finally(() => {
                    setLoadingBooking(false)
                    // Both spinners clear here now that one request feeds both.
                    // Leaving this on the success path alone left the charges
                    // spinner turning forever on a vacant room or a failed load.
                    setLoadingCharges(false)
                })
        } else {
            setActiveBooking(null)
            setManualCharges([])
            setLinkedDiningOrders([])
            setStayGroup(null)
            setShowAddChargeForm(false)
            setCreatedSessionId(null)
        }
    }, [selectedRoom, rooms, refreshTrigger])

    // Filter rooms
    const filteredRooms = useMemo(() => {
        return rooms.filter(r => {
            // Category filter
            if (roomTypeFilter && roomTypeFilter !== 'all' && r.type_id !== roomTypeFilter) {
                return false
            }
            // Status filter
            if (roomsFilter === 'all') return true
            if (roomsFilter === 'available') return r.status === 'available'
            if (roomsFilter === 'occupied') return r.status === 'occupied'
            if (roomsFilter === 'dirty') return r.status === 'dirty'
            if (roomsFilter === 'closed') return r.status === 'maintenance'
            if (roomsFilter === 'reserve') return false // dummy reserved status
            return true
        })
    }, [rooms, roomsFilter, roomTypeFilter])

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

        const roomItems = linkedDiningOrders.filter(o => o.is_room_order && o.status !== 'cancelled')
        const items = roomItems.map(it => ({
            name: getItemDisplayName(it),
            quantity: it.quantity || 0,
            unitPrice: Number(it.unit_price ?? 0),
        }))
        const total = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)

        return { items, total }
    }, [selectedRoom, activeBooking, linkedDiningOrders])

    // Stay night and price calculations. A multi-room reservation bills as one
    // folio, so the room charge here is every room's — priced server-side,
    // since the rooms can be of different types.
    const stayPriceDetails = useMemo(() => {
        // A reservation's rooms are already priced per room server-side, so the
        // group figures stand as they are; the nightly rate below is only shown
        // for a single room.
        if (stayGroup) return { nights: stayGroup.nights, cost: stayGroup.stayCost, price: 0, isCustom: false }
        if (!selectedRoom || !activeBooking) return { nights: 0, cost: 0, price: 0, isCustom: false }

        // A rate the desk agreed for this stay stands in for the catalog price.
        const customPrice = getBookingCustomPrice(activeBooking)
        const price = customPrice > 0 ? customPrice : (selectedRoom.room_types?.base_price || 0)
        const nights = calculateNights(activeBooking.check_in, activeBooking.check_out)
        const cost = price * nights

        return { nights, cost, price, isCustom: customPrice > 0 }
    }, [selectedRoom, activeBooking, stayGroup])

    // What the charge works out to before the cashier touches it. Gated on the
    // same two settings the server folio checks, so this preview can't promise
    // a charge the settlement won't make (or hide one it will).
    const autoServiceCharge = useMemo(
        () => autoRoomServiceCharge(linkedDiningOrders, features, selectedRoom?.id),
        [linkedDiningOrders, features, selectedRoom?.id],
    )
    // Whether the room is charged one automatically. A room that isn't can
    // still have one added by hand — the settlement bills any override as a
    // difference from the auto figure, and for these rooms that figure is 0.
    const serviceChargeIsAutomatic = roomServiceChargeApplies(features, selectedRoom?.id)

    // Empty means "leave it on auto"; an explicit '0' waives the charge, which
    // is why the override is held as a string rather than a number.
    const roomServiceChargeInput = serviceChargeEdit?.roomId === selectedRoom?.id ? serviceChargeEdit?.value ?? '' : ''
    const applyRoomServiceCharge = serviceChargeOffRoomId !== selectedRoom?.id
    const serviceCharge = resolveRoomServiceCharge(autoServiceCharge, roomServiceChargeInput)
    const serviceChargeOverridden = serviceCharge.isOverridden
    const roomServiceChargeAmount = applyRoomServiceCharge ? serviceCharge.charged : 0
    // What the settlement should bill, carried to the billing panel below. A
    // waive via the toggle is an override to zero as far as the API cares.
    const serviceChargeOverrideValue = !applyRoomServiceCharge ? 0 : serviceChargeOverridden ? serviceCharge.charged : undefined

    // Grand total. Plain arithmetic rather than a useMemo — the service charge
    // it now depends on is itself derived each render, so a manual memo here
    // could not be preserved anyway.
    const grandTotal = (() => {
        const roomStayCost = stayPriceDetails.cost
        const qrOrdersTotal = qrOrdersDetails?.total || 0
        const manualChargesTotal = manualCharges.reduce((acc, c) => acc + Number(c.amount || 0), 0)
        const linkedDiningTotal = filteredLinkedDiningOrders.reduce((sum, item) => sum + (Number(item.unit_price) * item.quantity), 0)
        return roomStayCost + qrOrdersTotal + manualChargesTotal + linkedDiningTotal + roomServiceChargeAmount
    })()

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
        // Children can stay on their own booking line, but somebody has to be
        // the adult the room is registered to.
        if (guestTotals.adults < 1) { toast.error('Enter at least one adult guest'); return }

        // Every extra room needs an adult on it too — the same rule the API
        // enforces, checked here so the front desk gets a pointed message
        // instead of a generic rejection.
        for (const roomId of selectedExtraIds) {
            const g = extraRooms[roomId]
            const adults = Math.max(0, Math.trunc(Number(g.adult_male) || 0)) + Math.max(0, Math.trunc(Number(g.adult_female) || 0))
            if (adults < 1) {
                const number = rooms.find(r => r.id === roomId)?.room_number ?? ''
                toast.error(`Room ${number} needs at least one adult guest`)
                return
            }
        }

        // Calculate advance amount to send. A "full" advance covers every room
        // on the reservation, not just the one that was clicked — priced at the
        // agreed rate when the desk set one (see combinedNightlyRate).
        const customPrice = bookingForm.custom_room_price.trim() !== '' ? (parseFloat(bookingForm.custom_room_price) || 0) : 0
        const inDate = new Date(bookingForm.check_in)
        const outDate = new Date(bookingForm.check_out)
        const diffMs = outDate.getTime() - inDate.getTime()
        const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
        const fullCost = combinedNightlyRate * nights

        let resolvedAdvance = 0
        if (advanceType === 'full') {
            resolvedAdvance = fullCost
        } else if (advanceType === 'partial') {
            resolvedAdvance = Math.max(0, parseFloat(advanceAmount) || 0)
            if (resolvedAdvance <= 0) { toast.error('Please enter a valid advance amount'); return }
        }

        const isSplit = advanceType !== 'none' && advancePayMethod === 'split'
        const splitCash = Math.max(0, parseFloat(advanceSplitCash) || 0)
        const splitQr = Math.max(0, parseFloat(advanceSplitQr) || 0)
        if (isSplit && Math.round((splitCash + splitQr) * 100) !== Math.round(resolvedAdvance * 100)) {
            toast.error(`Cash + QR must add up to the advance amount (Rs. ${resolvedAdvance.toLocaleString()})`)
            return
        }

        const formattedKyc = bookingForm.kyc_type
            ? (bookingForm.kyc?.trim() ? `${bookingForm.kyc_type}: ${bookingForm.kyc.trim()}` : bookingForm.kyc_type)
            : bookingForm.kyc?.trim()

        setIsProcessing(true)
        try {
            const res = await fetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // The clicked room first, then any extras. The API creates a
                    // reservation group whenever this is longer than one.
                    rooms: [
                        {
                            room_id: selectedRoom.id,
                            adult_male: bookingForm.adult_male,
                            adult_female: bookingForm.adult_female,
                            children: bookingForm.children,
                        },
                        ...selectedExtraIds.map(roomId => ({
                            room_id: roomId,
                            adult_male: extraRooms[roomId].adult_male,
                            adult_female: extraRooms[roomId].adult_female,
                            children: extraRooms[roomId].children,
                        })),
                    ],
                    guest_name: bookingForm.guest_name,
                    guest_phone: bookingForm.guest_phone,
                    kyc: formattedKyc || null,
                    check_in: bookingForm.check_in,
                    check_out: bookingForm.check_out,
                    custom_room_price: customPrice > 0 ? customPrice : undefined,
                    advance_amount: resolvedAdvance,
                    advance_payment_method: resolvedAdvance > 0 ? (irdSyncEnabled ? advancePayMethod : 'cash') : 'none',
                    advance_cash_amount: (irdSyncEnabled && isSplit) ? splitCash : undefined,
                    advance_qr_amount: (irdSyncEnabled && isSplit) ? splitQr : undefined,
                    advance_qr_code_id: (irdSyncEnabled && resolvedAdvance > 0 && (advancePayMethod === 'qr_digital' || isSplit))
                        ? (advanceQrCodeId || (qrCodes.length === 1 ? qrCodes[0].id : undefined))
                        : undefined,
                    advance_note: advanceNote,
                    parking_required: bookingForm.parking_required,
                    // The plate is worth keeping even if no space was reserved,
                    // but a fee only makes sense against a space actually given.
                    parking_vehicle_no: bookingForm.parking_vehicle_no.trim() || undefined,
                    parking_fee: bookingForm.parking_required ? (parseFloat(bookingForm.parking_fee) || 0) : 0,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)

            if (data.data?.id && linkToBookingId) {
                try {
                    await fetch('/api/bookings/combine-bill', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bookingId: linkToBookingId,
                            addBookingIds: [data.data.id],
                        }),
                    })
                } catch (e) {
                    console.error("Error linking to existing stay bill:", e)
                }
            }

            const bookedIds = new Set<string>([selectedRoom.id, ...selectedExtraIds])
            const roomLabel = [selectedRoom.room_number, ...selectedExtraIds.map(id => rooms.find(r => r.id === id)?.room_number).filter(Boolean)].join(', ')
            toast.success(
                `${bookedIds.size > 1 ? `${bookedIds.size} rooms (${roomLabel})` : `Room ${selectedRoom.room_number}`} booked!` +
                (resolvedAdvance > 0 ? ` Advance: Rs. ${resolvedAdvance.toLocaleString()}` : '')
            )
            setRooms(prev => prev.map(r => bookedIds.has(r.id) ? { ...r, status: 'occupied' } : r))
            setBookings(prev => {
                const newB = data.bookings || [data.data]
                return [...prev, ...newB.filter((nb: any) => !prev.some(p => p.id === nb.id))]
            })
            setExtraRooms({})
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
                        // Rooms held by the same reservation are marked so the
                        // front desk can see at a glance that checking one out
                        // will settle and release the others with it.
                        const groupSize = groupSizeByRoomId.get(room.id) ?? 0

                        return (
                            <button
                                key={room.id}
                                onClick={() => {
                                    resetRoomModal()
                                    setSelectedRoom(room)
                                }}
                                className={`relative aspect-square rounded-[20px] border flex flex-col items-center justify-center transition-all duration-300 ${cfg.card} hover:-translate-y-1 hover:shadow-md hover:bg-surface active:scale-95`}
                            >
                                <span className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-ink leading-tight text-center">
                                    {room.room_number}
                                </span>
                                {/* Wraps instead of truncating: the room type is how staff tell
                                    a Deluxe from a Deluxe Twin at a glance, so an ellipsis can
                                    hide the one word that distinguishes them. The card is square
                                    with room to spare under the number, so a second line costs
                                    nothing. */}
                                {room.room_types && (
                                    <span className="text-[10px] font-bold text-ink-subtle mt-0.5 px-1 w-full text-center leading-tight break-words">
                                        {room.room_types.name}
                                    </span>
                                )}
                                <span className={`uppercase tracking-wide mt-1.5 text-[8px] font-extrabold px-1.5 py-0.5 rounded-md border ${cfg.badge} ${cfg.badgeBorder}`}>
                                    {cfg.label}
                                </span>
                                <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
                                {groupSize > 1 && (
                                    <span
                                        className="absolute top-1.5 left-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-md bg-brand-500 text-white"
                                        title={`Part of a ${groupSize}-room booking — these rooms bill and check out together`}
                                    >
                                        {groupSize} ROOMS
                                    </span>
                                )}
                            </button>
                        )
                    })
                )}
            </div>

            {/* Modal Overlay for Available/Housekeeping/Closed rooms or Booking Form / Edit Booking */}
            {mounted && selectedRoom && (selectedRoom.status !== 'occupied' || bookingFormOpen) && createPortal(
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
                                        <h4 className={`text-xs font-bold uppercase tracking-wider ${isEditMode ? 'text-amber-600' : 'text-brand-600'}`}>
                                            {isEditMode ? 'Edit Booking Details' : 'New Booking Details'}
                                        </h4>
                                        <button onClick={() => { setBookingFormOpen(false); setIsEditMode(false); }} className="text-xs text-ink-subtle hover:underline font-semibold">Back</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                        <div className="col-span-2">
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Guest Name *</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. John Doe"
                                                value={bookingForm.guest_name}
                                                onChange={e => {
                                                    setBookingForm(b => ({ ...b, guest_name: e.target.value }))
                                                    setLookupField('guest_name')
                                                    // Typing again means the desk is looking for someone
                                                    // else, so start offering matches once more.
                                                    setGuestPicked(false)
                                                }}
                                                onFocus={() => setLookupField('guest_name')}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div className="col-span-2 -mt-1">
                                            {/* Returning-guest suggestions sit under the pair of fields
                                                they draw from, so whichever the cashier is typing in the
                                                list appears in the same place. */}
                                            <GuestSuggestionList
                                                suggestions={guestSuggestions}
                                                loading={guestLookupLoading}
                                                onPick={applyGuestSuggestion}
                                                formatDate={formatDateTime}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Phone *</label>
                                            <input
                                                type="text"
                                                inputMode="tel"
                                                placeholder="9841234567"
                                                value={bookingForm.guest_phone}
                                                onChange={e => {
                                                    setBookingForm(b => ({ ...b, guest_phone: e.target.value }))
                                                    setLookupField('guest_phone')
                                                    setGuestPicked(false)
                                                }}
                                                onFocus={() => setLookupField('guest_phone')}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Document Type (Optional)</label>
                                            <select
                                                value={bookingForm.kyc_type || ''}
                                                onChange={e => setBookingForm(b => ({ ...b, kyc_type: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            >
                                                <option value="">Select Document Type</option>
                                                <option value="Citizenship / NID">Citizenship / NID</option>
                                                <option value="Passport">Passport</option>
                                                <option value="Driving License">Driving License</option>
                                                <option value="Other KYC">Other KYC</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Document No. (Optional)</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. 123-456-789"
                                                value={bookingForm.kyc}
                                                onChange={e => setBookingForm(b => ({ ...b, kyc: e.target.value }))}
                                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Check-in *</label>
                                            <NepaliDateTimeInput
                                                aria-label="Check-in date and time"
                                                value={bookingForm.check_in}
                                                onChange={check_in => setBookingForm(b => ({ ...b, check_in }))}
                                                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Check-out * <span className="text-ink-subtle/70 normal-case font-semibold">(12:00 PM)</span></label>
                                            {/* Checkout has always been pinned to noon here — so this asks for
                                                the day only, rather than offering a time it would overwrite. */}
                                            <NepaliDateInput
                                                aria-label="Check-out date"
                                                value={bookingForm.check_out.slice(0, 10)}
                                                onChange={iso => setBookingForm(b => ({ ...b, check_out: iso ? `${iso}T12:00` : '' }))}
                                                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <div className="flex items-baseline justify-between mb-1">
                                                <label className="block text-[10px] font-bold text-ink-subtle uppercase">Guests *</label>
                                                {(() => {
                                                    const total = guestTotals.adults + guestTotals.children
                                                    const capacity = selectedRoom.room_types?.capacity ?? null
                                                    // Warn, never block — a front desk routinely puts an
                                                    // extra mattress in a room and needs to record it.
                                                    const over = capacity !== null && total > capacity
                                                    return (
                                                        <span className={`text-[10px] font-bold ${over ? 'text-amber-600' : 'text-ink-subtle'}`}>
                                                            {total} guest{total === 1 ? '' : 's'}
                                                            {capacity !== null && ` · room sleeps ${capacity}`}
                                                        </span>
                                                    )
                                                })()}
                                            </div>
                                            <div className="grid grid-cols-3 gap-2">
                                                {([
                                                    ['adult_male', 'Male'],
                                                    ['adult_female', 'Female'],
                                                    ['children', 'Children'],
                                                ] as const).map(([key, label]) => (
                                                    <div key={key}>
                                                        <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-0.5">{label}</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            inputMode="numeric"
                                                            aria-label={`Number of ${label.toLowerCase()} guests`}
                                                            value={bookingForm[key]}
                                                            onChange={e => setBookingForm(b => ({ ...b, [key]: e.target.value }))}
                                                            className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold tabular-nums"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="col-span-2 border border-hairline rounded-2xl p-3 space-y-1.5 bg-surface">
                                            <label className="block text-[10px] font-black text-ink-subtle uppercase tracking-wider flex items-center justify-between">
                                                <span>Custom Room Price (Rs. / Night)</span>
                                                <span className="text-[9px] text-amber-700 font-semibold normal-case">Session rate override</span>
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    placeholder={selectedRoom.room_types?.base_price?.toString() || '0'}
                                                    value={bookingForm.custom_room_price}
                                                    onChange={e => setBookingForm(b => ({ ...b, custom_room_price: e.target.value }))}
                                                    className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-xl text-xs font-extrabold bg-surface focus:outline-none focus:border-brand-500"
                                                />
                                            </div>
                                            <p className="text-[9px] text-ink-subtle">
                                                Applies to this booking session only ({selectedRoom.room_types?.name || 'Room'} standard price Rs. {selectedRoom.room_types?.base_price || 0}/night remains unchanged).
                                            </p>
                                        </div>

                                        {/* Parking. One question for the whole reservation — the guest
                                            arrives in one vehicle however many rooms they take — and any
                                            fee posts to the folio as a single 'parking' charge. */}
                                        <div className="col-span-2 border border-hairline rounded-2xl p-3 space-y-2.5 bg-surface-muted/30">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider">Parking required?</p>
                                                <div className="flex gap-1.5 shrink-0">
                                                    {([['No', false], ['Yes', true]] as const).map(([label, value]) => (
                                                        <button
                                                            key={label}
                                                            type="button"
                                                            aria-pressed={bookingForm.parking_required === value}
                                                            onClick={() => setBookingForm(b => ({ ...b, parking_required: value }))}
                                                            className={`px-3.5 py-1.5 rounded-xl border text-[11px] font-bold transition-colors ${
                                                                bookingForm.parking_required === value
                                                                    ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                                    : 'border-hairline bg-surface text-ink-subtle hover:border-brand-300'
                                                            }`}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-0.5">Vehicle No.</label>
                                                    <input
                                                        type="text"
                                                        maxLength={32}
                                                        value={bookingForm.parking_vehicle_no}
                                                        onChange={e => setBookingForm(b => ({ ...b, parking_vehicle_no: e.target.value }))}
                                                        placeholder="BA 2 CHA 1234"
                                                        className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-0.5">Fee (Rs.)</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        placeholder="0.00"
                                                        disabled={!bookingForm.parking_required}
                                                        value={bookingForm.parking_fee}
                                                        onChange={e => setBookingForm(b => ({ ...b, parking_fee: e.target.value }))}
                                                        className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold tabular-nums disabled:opacity-60"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Extra rooms for the same guest. Adding any turns this into
                                            one reservation: the rooms share a stay window, bill onto a
                                            single folio, and check out together. */}
                                        {addableRooms.length > 0 && (
                                            <div className="col-span-2 border border-hairline rounded-2xl p-3 space-y-2 bg-surface-muted/30">
                                                <div className="flex items-baseline justify-between">
                                                    <p className="text-[10px] font-black text-ink-subtle uppercase tracking-wider">More rooms for this guest</p>
                                                    <span className="text-[10px] font-bold text-ink-subtle">
                                                        {selectedExtraIds.length + 1} room{selectedExtraIds.length ? 's' : ''} total
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {addableRooms.map(room => {
                                                        const picked = !!extraRooms[room.id]
                                                        return (
                                                            <button
                                                                key={room.id}
                                                                type="button"
                                                                aria-pressed={picked}
                                                                onClick={() => setExtraRooms(prev => {
                                                                    const next = { ...prev }
                                                                    if (picked) delete next[room.id]
                                                                    else next[room.id] = { adult_male: '1', adult_female: '0', children: '0' }
                                                                    return next
                                                                })}
                                                                className={`px-2.5 py-1.5 rounded-xl border-2 text-[10px] font-bold transition-all ${
                                                                    picked
                                                                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                                        : 'border-hairline bg-surface text-ink-subtle hover:border-brand-300'
                                                                }`}
                                                            >
                                                                {room.room_number}
                                                                {room.room_types?.base_price ? (
                                                                    <span className="ml-1 font-semibold opacity-70">{money(room.room_types.base_price)}</span>
                                                                ) : null}
                                                            </button>
                                                        )
                                                    })}
                                                </div>

                                                {/* Per-room guest mix — a family taking three rooms rarely
                                                    splits evenly across them. */}
                                                {selectedExtraIds.map(roomId => {
                                                    const room = rooms.find(r => r.id === roomId)
                                                    const guests = extraRooms[roomId]
                                                    return (
                                                        <div key={roomId} className="border-t border-hairline pt-2">
                                                            <p className="text-[10px] font-bold text-ink mb-1">
                                                                Room {room?.room_number}
                                                                {room?.room_types?.capacity != null && (
                                                                    <span className="ml-1 font-semibold text-ink-subtle">· sleeps {room.room_types.capacity}</span>
                                                                )}
                                                            </p>
                                                            <div className="grid grid-cols-3 gap-2">
                                                                {([
                                                                    ['adult_male', 'Male'],
                                                                    ['adult_female', 'Female'],
                                                                    ['children', 'Children'],
                                                                ] as const).map(([key, label]) => (
                                                                    <div key={key}>
                                                                        <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-0.5">{label}</label>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            inputMode="numeric"
                                                                            aria-label={`Number of ${label.toLowerCase()} guests in room ${room?.room_number ?? ''}`}
                                                                            value={guests[key]}
                                                                            onChange={e => setExtraRooms(prev => ({
                                                                                ...prev,
                                                                                [roomId]: { ...prev[roomId], [key]: e.target.value },
                                                                            }))}
                                                                            className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold tabular-nums"
                                                                        />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {/* Advance Payment Section */}
                                        {isEditMode ? (
                                            <div className="col-span-2 border border-emerald-200 rounded-2xl p-3 bg-emerald-50/50 space-y-1">
                                                <div className="flex items-center gap-1.5 font-black text-emerald-900 text-xs uppercase tracking-wider">
                                                    <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                                    <span>Advance Payment (Locked)</span>
                                                </div>
                                                <p className="text-[11px] text-emerald-700 font-semibold">
                                                    Rs. {(activeBooking?.paid_amount || 0).toLocaleString()} paid. Advance payments are preserved and locked during booking edits.
                                                </p>
                                            </div>
                                        ) : (
                                            (() => {
                                                const inDate = new Date(bookingForm.check_in)
                                                const outDate = new Date(bookingForm.check_out)
                                                const diffMs = outDate.getTime() - inDate.getTime()
                                                const nights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
                                                const fullCost = combinedNightlyRate * nights
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
                                                                        placeholder="e.g. 500"
                                                                        value={advanceAmount}
                                                                        onChange={e => setAdvanceAmount(e.target.value)}
                                                                        className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-xl text-xs font-bold bg-surface focus:outline-none focus:border-brand-500"
                                                                    />
                                                                </div>
                                                                {advanceAmount && fullCost > 0 && (() => {
                                                                    const amt = parseFloat(advanceAmount) || 0
                                                                    const diff = amt - fullCost
                                                                    if (diff > 0) return (
                                                                        <p className="text-[9px] text-emerald-600 font-bold mt-1">
                                                                            Return to guest at checkout: Rs. {diff.toLocaleString()}
                                                                        </p>
                                                                    )
                                                                    return (
                                                                        <p className="text-[9px] text-amber-600 font-bold mt-1">
                                                                            Balance due at checkout: Rs. {Math.max(0, fullCost - amt).toLocaleString()}
                                                                        </p>
                                                                    )
                                                                })()}
                                                            </div>
                                                        )}

                                                        {advanceType !== 'none' && (
                                                            <div>
                                                                <label className="block text-[9px] font-bold text-ink-subtle uppercase mb-1">Payment Note / Remarks</label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="e.g. Advance, Dine in, Deposit..."
                                                                    value={advanceNote}
                                                                    onChange={e => setAdvanceNote(e.target.value)}
                                                                    className="w-full px-2.5 py-1.5 border border-hairline rounded-xl text-xs font-medium bg-surface focus:outline-none focus:border-brand-500"
                                                                />
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
                                            })()
                                        )}
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
                                                    setIsEditMode(false)
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
                                                    setIsEditMode(false)
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
                                    isEditMode ? (
                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-[10px] font-extrabold text-amber-900 uppercase mb-1">
                                                    Reason for Update * <span className="text-ink-subtle font-normal">(Recorded in audit log)</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={editReason}
                                                    onChange={(e) => setEditReason(e.target.value)}
                                                    placeholder="e.g. Corrected nightly room rate, updated stay date..."
                                                    className="w-full px-3 py-2 border border-amber-300 rounded-xl font-semibold bg-amber-50/20 focus:outline-none focus:border-amber-500 text-xs"
                                                />
                                            </div>
                                            <Button
                                                variant="primary"
                                                block
                                                loading={isProcessing}
                                                disabled={isProcessing || !editReason.trim()}
                                                onClick={handleSaveEditBooking}
                                                className="font-bold uppercase tracking-wider !bg-amber-600 hover:!bg-amber-700 border-none"
                                            >
                                                UPDATE BOOKING
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            block
                                            loading={isProcessing}
                                            onClick={handleCreateBooking}
                                            className="font-bold uppercase tracking-wider"
                                        >
                                            Book Room
                                        </Button>
                                    )
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
                                {moveOpen && activeBooking && (() => {
                                    const target = moveCandidates.find(r => r.id === moveTargetId) || null
                                    const currentRate = selectedRoom.room_types?.base_price ?? 0
                                    const newRate = target?.room_types?.base_price ?? 0
                                    const rateChanged = !!target && newRate !== currentRate
                                    const heads = totalGuests(activeBooking)
                                    const capacity = target?.room_types?.capacity ?? null
                                    const tooSmall = capacity !== null && heads > capacity

                                    return (
                                        <div className="space-y-3 border border-hairline rounded-2xl p-4 bg-surface-muted/30">
                                            <div>
                                                <p className="text-xs font-extrabold text-ink">Move {activeBooking.guest_name} out of Room {selectedRoom.room_number}</p>
                                                <p className="text-[11px] text-ink-subtle mt-0.5">
                                                    The folio moves with the guest — orders, charges and the advance already taken all stay on this stay.
                                                </p>
                                            </div>

                                            <div>
                                                <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Move to *</label>
                                                <Select
                                                    value={moveTargetId}
                                                    onChange={e => setMoveTargetId(e.target.value)}
                                                    className="w-full px-3 py-2 border border-hairline rounded-xl text-xs bg-surface font-semibold"
                                                    aria-label="Destination room"
                                                >
                                                    <option value="">Select a room…</option>
                                                    {moveCandidates.map(r => (
                                                        <option key={r.id} value={r.id}>
                                                            Room {r.room_number}
                                                            {r.room_types?.name ? ` · ${r.room_types.name}` : ''}
                                                            {r.room_types ? ` · ${money(r.room_types.base_price)}/night` : ''}
                                                            {r.status === 'dirty' ? ' · needs cleaning' : ''}
                                                        </option>
                                                    ))}
                                                </Select>
                                                {moveCandidates.length === 0 && (
                                                    <p className="text-[11px] text-amber-600 font-semibold mt-1">
                                                        No other room is free right now.
                                                    </p>
                                                )}
                                            </div>

                                            {rateChanged && (
                                                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                    {money(currentRate)} → {money(newRate)} per night. Nights already spent in Room {selectedRoom.room_number} stay at {money(currentRate)}; the new rate applies from tonight.
                                                </p>
                                            )}
                                            {tooSmall && (
                                                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                    {heads} guests but Room {target?.room_number} sleeps {capacity}.
                                                </p>
                                            )}

                                            <div>
                                                <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Reason</label>
                                                <input
                                                    type="text"
                                                    value={moveReason}
                                                    onChange={e => setMoveReason(e.target.value)}
                                                    placeholder="Guest request, maintenance, upgrade…"
                                                    className="w-full px-3 py-2 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                                />
                                            </div>

                                            <div className="flex gap-3">
                                                <Button variant="secondary" block onClick={() => setMoveOpen(false)}>Cancel</Button>
                                                <Button
                                                    variant="primary"
                                                    block
                                                    icon={ArrowLeftRight}
                                                    loading={moving}
                                                    disabled={!moveTargetId || moving}
                                                    onClick={handleMoveRoom}
                                                >
                                                    Move Guest
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                })()}
                                {selectedRoom.status !== 'available' && !bookingFormOpen && !confirmCloseOpen && !confirmDirtyOpen && !moveOpen && (
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
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-bold text-ink-subtle uppercase">Guest Information</p>
                                            <button
                                                type="button"
                                                onClick={handleOpenEditBooking}
                                                className="text-[10px] text-amber-700 hover:text-amber-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                                            >
                                                <Pencil size={11} /> Edit
                                            </button>
                                        </div>
                                        <p className="font-extrabold text-ink text-sm">{activeBooking.guest_name}</p>
                                        <p className="font-semibold text-ink-muted">{activeBooking.guest_phone}</p>
                                        {getBookingKycNote(activeBooking) && (
                                            <p className="text-[10px] bg-white border border-hairline px-2 py-0.5 rounded-md text-ink-muted inline-block">
                                                KYC: {getBookingKycNote(activeBooking)}
                                            </p>
                                        )}
                                        {/* Only worth a line when there is a car — a stay with
                                            neither a space nor a plate has nothing to say here. */}
                                        {(activeBooking.parking_required || activeBooking.parking_vehicle_no) && (
                                            <p className="text-[10px] font-bold text-ink-muted flex items-center gap-1">
                                                <Car size={11} className="text-ink-subtle" />
                                                {activeBooking.parking_required ? 'Parking reserved' : 'No parking space'}
                                                {activeBooking.parking_vehicle_no && ` · ${activeBooking.parking_vehicle_no}`}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2 text-right border-l border-hairline pl-4">
                                        <p className="text-[10px] font-bold text-ink-subtle uppercase text-right">Stay Schedule</p>
                                        <p className="font-semibold text-ink-muted"><span className="text-ink-subtle">In:</span> {formatDateTime(activeBooking.check_in)}</p>
                                        <p className="font-semibold text-ink-muted"><span className="text-ink-subtle">Out:</span> {formatDateTime(activeBooking.check_out)}</p>
                                        <p className="text-[10px] text-brand-500 font-extrabold">{describeGuestMix(activeBooking)}</p>
                                        {/* Paid up but still in the room — what's left to do is
                                            release it, not charge for it. */}
                                        {activeBooking.bill_settled_at && activeBooking.status !== 'checked_out' && (
                                            <p className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md inline-block">
                                                Bill settled {formatDateTime(activeBooking.bill_settled_at)}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Billing Breakdown */}
                                <div className="space-y-4">
                                    <h4 className="text-xs font-bold uppercase text-ink-subtle tracking-wider flex items-center justify-between">
                                        <span>Stay billing breakdown</span>
                                        <span className="text-brand-500 normal-case tabular-nums">{stayPriceDetails.nights} Night(s)</span>
                                    </h4>

                                    {/* Several rooms booked together settle on one bill, so
                                        this drawer is showing the whole reservation, not this
                                        room's share of it. */}
                                    {stayGroup && (
                                        <div className="border border-brand-200 bg-brand-50/60 rounded-2xl p-4 text-xs">
                                            <p className="font-black text-brand-700 uppercase text-[10px] tracking-wider">
                                                Combined bill · {stayGroup.rooms.length} rooms
                                            </p>
                                            <p className="text-[10px] text-ink-muted font-semibold mt-1">
                                                Rooms {stayGroup.rooms.map(r => r.roomNumber).filter(Boolean).join(', ')} are on one
                                                reservation and check out together on a single payment.
                                            </p>
                                        </div>
                                    )}

                                    <div className="border border-hairline rounded-2xl overflow-hidden divide-y divide-gray-100 bg-surface">
                                        {/* Room Stay Row */}
                                        <div className="flex justify-between items-center p-4 text-xs">
                                            <div>
                                                <p className="font-extrabold text-ink flex items-center gap-1.5">
                                                    <span>Room Stay Charge</span>
                                                    {stayPriceDetails.isCustom && (
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">Custom Rate</span>
                                                    )}
                                                </p>
                                                <p className="text-[10px] text-ink-subtle">
                                                    {stayGroup
                                                        ? `${stayGroup.rooms.length} rooms on this reservation`
                                                        : `${money(stayPriceDetails.price || selectedRoom.room_types?.base_price || 0)} / Night`}
                                                </p>
                                            </div>
                                            <span className="font-extrabold text-ink-muted tabular-nums">{money(stayPriceDetails.cost)}</span>
                                        </div>

                                        {stayGroup && (
                                            <div className="p-4 space-y-1.5">
                                                {stayGroup.rooms.map(r => (
                                                    <div key={r.bookingId} className="flex justify-between text-[10px] text-ink-muted">
                                                        <span className="font-semibold">Room {r.roomNumber} · {r.nights}n</span>
                                                        <span className="tabular-nums font-semibold">{money(r.stayCost)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

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
                                                            <span>{getItemDisplayName(item)} <span className="text-[9px] text-brand-500">({item.quantity}×)</span></span>
                                                            <span className="tabular-nums font-semibold">{money(Number(item.unit_price) * item.quantity)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Room Service Charge — the auto figure for rooms
                                            that carry one, and an empty field to add one by
                                            hand for rooms that don't. */}
                                        {activeBooking && (
                                            <div className="p-4 space-y-2">
                                                <div className="flex justify-between items-center gap-3">
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-extrabold text-sky-600 flex items-center gap-1.5">
                                                            Room Service Charge
                                                            {serviceChargeOverridden && applyRoomServiceCharge && (
                                                                <span className="text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                                                                    {serviceChargeIsAutomatic ? 'EDITED' : 'MANUAL'}
                                                                </span>
                                                            )}
                                                        </p>
                                                        <p className="text-[10px] text-ink-subtle font-semibold">
                                                            {serviceChargeIsAutomatic
                                                                ? `${ROOM_SERVICE_CHARGE_RATE * 100}% on room food · auto ${money(autoServiceCharge)}`
                                                                : 'Not charged automatically for this room — type an amount to add one'}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => setServiceChargeOffRoomId(applyRoomServiceCharge ? selectedRoom.id : null)}
                                                            className={`px-2 py-1 rounded-lg text-[9px] font-black border transition ${
                                                                applyRoomServiceCharge
                                                                    ? 'bg-sky-50 text-sky-700 border-sky-200'
                                                                    : 'bg-surface-muted text-ink-subtle border-hairline'
                                                            }`}
                                                        >
                                                            {applyRoomServiceCharge ? 'ON' : 'OFF'}
                                                        </button>
                                                        {serviceChargeOverridden && applyRoomServiceCharge && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setServiceChargeEdit(null)}
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
                                                                value={serviceChargeOverridden ? roomServiceChargeInput : (autoServiceCharge ? String(autoServiceCharge) : '')}
                                                                placeholder={autoServiceCharge ? String(autoServiceCharge) : '0.00'}
                                                                onChange={e => setServiceChargeEdit({ roomId: selectedRoom.id, value: e.target.value })}
                                                                aria-label="Room service charge"
                                                                className="w-full pl-7 pr-2 py-1.5 border border-hairline rounded-lg text-xs font-bold text-right tabular-nums bg-surface focus:outline-none focus:border-brand-500 disabled:opacity-50 disabled:bg-surface-muted"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                                {serviceChargeOverridden && applyRoomServiceCharge && serviceChargeIsAutomatic && (
                                                    <p className="text-[9px] text-amber-700 font-bold text-right">
                                                        Edited — auto was {money(autoServiceCharge)}
                                                    </p>
                                                )}
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

                                {/* Add Food/Restaurant Order Button */}
                                <div className="sticky bottom-0 z-10 border border-dashed border-hairline-strong rounded-2xl p-4 bg-surface shadow-lg">
                                    <button 
                                        onClick={handleOpenFoodOrder}
                                        className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-emerald-600 font-extrabold hover:text-emerald-700 hover:scale-[1.01] transition-all border border-emerald-500/10 hover:border-emerald-500/30 rounded-xl bg-surface"
                                    >
                                        <Utensils size={15} /> Add Food/Restaurant Order
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="py-8 text-center border border-dashed border-hairline-strong rounded-xl">
                                <p className="text-sm text-ink-subtle">No active booking session found.</p>
                            </div>
                        )}
                        </div>

                        {/* Change Room Panel — shown when "Change Room" button is pressed, outside the scrollable area so it's always visible */}
                        {moveOpen && (() => {
                            const target = moveCandidates.find(r => r.id === moveTargetId) || null
                            const currentRate = selectedRoom.room_types?.base_price ?? 0
                            const newRate = target?.room_types?.base_price ?? 0
                            const rateChanged = !!target && newRate !== currentRate
                            const heads = activeBooking ? totalGuests(activeBooking) : 0
                            const capacity = target?.room_types?.capacity ?? null
                            const tooSmall = capacity !== null && heads > capacity

                            return (
                                <div className="border-t border-hairline flex-shrink-0 bg-surface-muted/30 px-6 py-4">
                                    <div className="space-y-3 border border-hairline rounded-2xl p-4 bg-surface">
                                        <div>
                                            <p className="text-xs font-extrabold text-ink">
                                                Move {activeBooking?.guest_name ?? 'Guest'} out of Room {selectedRoom.room_number}
                                            </p>
                                            <p className="text-[11px] text-ink-subtle mt-0.5">
                                                The folio moves with the guest — orders, charges and the advance already taken all stay on this stay.
                                            </p>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Move to *</label>
                                            <Select
                                                value={moveTargetId}
                                                onChange={e => setMoveTargetId(e.target.value)}
                                                className="w-full px-3 py-2 border border-hairline rounded-xl text-xs bg-surface font-semibold"
                                                aria-label="Destination room"
                                            >
                                                <option value="">Select a room…</option>
                                                {moveCandidates.map(r => (
                                                    <option key={r.id} value={r.id}>
                                                        Room {r.room_number}
                                                        {r.room_types?.name ? ` · ${r.room_types.name}` : ''}
                                                        {r.room_types ? ` · ${money(r.room_types.base_price)}/night` : ''}
                                                        {r.status === 'dirty' ? ' · needs cleaning' : ''}
                                                    </option>
                                                ))}
                                            </Select>
                                            {moveCandidates.length === 0 && (
                                                <p className="text-[11px] text-amber-600 font-semibold mt-1">
                                                    No other room is free right now.
                                                </p>
                                            )}
                                        </div>

                                        {rateChanged && (
                                            <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                {money(currentRate)} → {money(newRate)} per night.
                                            </p>
                                        )}
                                        {tooSmall && (
                                            <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                                {heads} guests but Room {target?.room_number} sleeps {capacity}.
                                            </p>
                                        )}

                                        <div>
                                            <label className="block text-[10px] font-bold text-ink-subtle uppercase mb-1">Reason</label>
                                            <input
                                                type="text"
                                                value={moveReason}
                                                onChange={e => setMoveReason(e.target.value)}
                                                placeholder="Guest request, maintenance, upgrade…"
                                                className="w-full px-3 py-2 border border-hairline rounded-xl text-xs bg-surface focus:outline-none focus:border-brand-500 font-semibold"
                                            />
                                        </div>

                                        <div className="flex gap-3">
                                            <Button variant="secondary" block onClick={() => setMoveOpen(false)}>Cancel</Button>
                                            <Button
                                                variant="primary"
                                                block
                                                icon={ArrowLeftRight}
                                                loading={moving}
                                                disabled={!moveTargetId || moving || !activeBooking}
                                                onClick={handleMoveRoom}
                                            >
                                                Move Guest
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })()}

                        {/* Drawer Footer (Checkout and Total Billing) - sticky */}
                        <div className="border-t border-hairline px-6 py-4 flex flex-col gap-2.5 flex-shrink-0 bg-surface">
                            {(() => {
                                // On a reservation the advance was split across its
                                // rooms at booking time, so what the guest has already
                                // paid on this one bill is their sum.
                                const advancePaid = stayGroup ? stayGroup.advancePaid : (Number(activeBooking?.paid_amount) || 0)
                                const netBalance = grandTotal - advancePaid
                                const balanceDue = Math.max(0, netBalance)
                                const returnAmount = netBalance < 0 ? Math.abs(netBalance) : 0
                                return (
                                    <>
                                        {advancePaid > 0 && (
                                            <div className="flex flex-col gap-1 text-xs border-b border-dashed border-hairline pb-2">
                                                <div className="flex justify-between text-ink-subtle font-semibold">
                                                    <span>Total Bill Amount:</span>
                                                    <span className="tabular-nums">{money(grandTotal)}</span>
                                                </div>
                                                <button
                                                     type="button"
                                                     onClick={() => setAdvanceHistoryOpen(true)}
                                                     className="flex justify-between text-emerald-600 font-bold hover:underline cursor-pointer text-left w-full transition-all group"
                                                 >
                                                     <span className="flex items-center gap-1">
                                                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                         Advance Paid ({advanceMethodLabel(activeBooking?.advance_payment_method)}):
                                                         <History className="w-3.5 h-3.5 inline ml-1 opacity-70 group-hover:opacity-100" />
                                                     </span>
                                                     <span className="tabular-nums">- {money(advancePaid)}</span>
                                                 </button>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center border-b border-dashed border-hairline pb-3 mb-1">
                                             <span className={`text-xs font-bold uppercase ${returnAmount > 0 ? 'text-emerald-600' : 'text-ink-subtle'}`}>
                                                 {returnAmount > 0 ? 'Return to guest' : advancePaid > 0 ? 'Balance due at checkout' : 'Total bill amount'}
                                             </span>
                                             <p className={`text-2xl font-black tabular-nums ${returnAmount > 0 ? 'text-emerald-600' : 'text-brand-600'}`}>
                                                 {returnAmount > 0 ? money(returnAmount) : money(balanceDue)}
                                             </p>
                                         </div>
                                         <div className="flex flex-wrap gap-2 justify-end">
                                              <Button
                                                  variant="secondary"
                                                  onClick={() => setSelectedRoom(null)}
                                                  className="px-4 font-bold"
                                              >
                                                  Close
                                              </Button>
                                              <Button
                                                  variant="secondary"
                                                  icon={Pencil}
                                                  onClick={handleOpenEditBooking}
                                                  className="px-4 font-bold !text-amber-700 !border-amber-200 hover:bg-amber-50"
                                              >
                                                  Edit Booking
                                              </Button>
                                              <Button
                                                  variant="secondary"
                                                  icon={Layers}
                                                  onClick={handleOpenCombineBills}
                                                  className="px-4 font-bold !text-indigo-600 !border-indigo-200 hover:bg-indigo-50"
                                              >
                                                  {stayGroup ? 'Manage Group Bill' : 'Combine Bills'}
                                              </Button>
                                              <Button
                                                  variant="secondary"
                                                  icon={Landmark}
                                                  onClick={() => {
                                                      setAddPaymentAmount('')
                                                      setAddPaymentMethod('cash')
                                                      setAddPaymentSplitCash('')
                                                      setAddPaymentSplitQr('')
                                                      setAddPaymentQrId('')
                                                      setAddPaymentOpen(true)
                                                  }}
                                                  className="px-4 font-bold !text-emerald-600 !border-emerald-200 hover:bg-emerald-50"
                                              >
                                                  Add Payment
                                              </Button>
                                              <Button
                                                  variant="secondary"
                                                  icon={ArrowLeftRight}
                                                  onClick={() => { setMoveTargetId(''); setMoveReason(''); setMoveOpen(true) }}
                                                  className="px-4 font-bold"
                                              >
                                                  Change Room
                                              </Button>
                                              <Button
                                                  variant="danger"
                                                  icon={CreditCard}
                                                  onClick={() => {
                                                      if (onGoToBilling) onGoToBilling(selectedRoom, serviceChargeOverrideValue)
                                                      setSelectedRoom(null)
                                                  }}
                                                  className="px-5 font-bold"
                                              >
                                                  Go to Billing
                                              </Button>
                                         </div>
                                    </>
                                )
                            })()}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {addPaymentOpen && activeBooking && createPortal(
                <div 
                    className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setAddPaymentOpen(false)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-md flex flex-col overflow-hidden transform transition-all animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div>
                                <h3 className="text-body font-black text-ink">Record Mid-Stay Payment</h3>
                                <p className="text-[10px] text-ink-subtle mt-0.5">Add payments to Guest {activeBooking.guest_name}&apos;s billing folio</p>
                            </div>
                            <button 
                                onClick={() => setAddPaymentOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Current paid & due summary */}
                            {(() => {
                                const currentAdvance = stayGroup ? stayGroup.advancePaid : (Number(activeBooking.paid_amount) || 0)
                                const currentDue = Math.max(0, grandTotal - currentAdvance)
                                return (
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <div className="bg-emerald-50/80 border border-emerald-100 p-3 rounded-2xl flex flex-col justify-between text-xs">
                                            <span className="font-bold text-emerald-800 text-[10px] uppercase tracking-wide">Advance Paid</span>
                                            <span className="font-black text-emerald-700 text-base tabular-nums mt-0.5">{money(currentAdvance)}</span>
                                        </div>
                                        <div className="bg-amber-50/80 border border-amber-100 p-3 rounded-2xl flex flex-col justify-between text-xs">
                                            <span className="font-bold text-amber-800 text-[10px] uppercase tracking-wide">Current Due Amount</span>
                                            <span className="font-black text-amber-700 text-base tabular-nums mt-0.5">{money(currentDue)}</span>
                                        </div>
                                    </div>
                                )
                            })()}

                            {/* Payment Method Selector */}
                            <div className="space-y-1.5">
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase">Payment Method</label>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setAddPaymentMethod('cash')}
                                        className={`py-2 px-3 text-xs font-bold rounded-xl border flex items-center justify-center gap-1.5 transition ${
                                            addPaymentMethod === 'cash'
                                                ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                : 'border-hairline bg-surface text-ink-muted hover:border-brand-200'
                                        }`}
                                    >
                                        Cash
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAddPaymentMethod('qr_digital')}
                                        className={`py-2 px-3 text-xs font-bold rounded-xl border flex items-center justify-center gap-1.5 transition ${
                                            addPaymentMethod === 'qr_digital'
                                                ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                : 'border-hairline bg-surface text-ink-muted hover:border-brand-200'
                                        }`}
                                    >
                                        QR / Digital
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAddPaymentMethod('split')}
                                        className={`py-2 px-3 text-xs font-bold rounded-xl border flex items-center justify-center gap-1.5 transition ${
                                            addPaymentMethod === 'split'
                                                ? 'border-brand-500 bg-brand-50 text-brand-600'
                                                : 'border-hairline bg-surface text-ink-muted hover:border-brand-200'
                                        }`}
                                    >
                                        Split (Both)
                                    </button>
                                </div>
                            </div>

                            {/* Amount inputs */}
                            {addPaymentMethod !== 'split' ? (
                                <div className="space-y-1">
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase">Amount (Rs.)</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-subtle">Rs.</span>
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="0.00"
                                            value={addPaymentAmount === '0' ? '' : addPaymentAmount}
                                            onChange={e => {
                                                const valStr = e.target.value
                                                if (valStr === '') {
                                                    setAddPaymentAmount('')
                                                    return
                                                }
                                                const val = parseFloat(valStr)
                                                setAddPaymentAmount(isNaN(val) ? '0' : val.toString())
                                            }}
                                            className="w-full pl-9 pr-3 py-2.5 border border-hairline focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl text-xs bg-white font-extrabold text-ink focus:outline-none"
                                            required
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-3 p-3.5 bg-surface-muted/40 border border-hairline rounded-2xl">
                                    <div className="space-y-1">
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase">Cash Amount</label>
                                        <div className="relative">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder="0.00"
                                                value={addPaymentSplitCash === '0' ? '' : addPaymentSplitCash}
                                                onChange={e => {
                                                    const valStr = e.target.value
                                                    if (valStr === '') {
                                                        setAddPaymentSplitCash('')
                                                        return
                                                    }
                                                    const val = parseFloat(valStr)
                                                    setAddPaymentSplitCash(isNaN(val) ? '0' : val.toString())
                                                }}
                                                className="w-full pl-8 pr-2 py-2 border border-hairline rounded-xl text-xs font-bold bg-white focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase">QR Amount</label>
                                        <div className="relative">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-ink-subtle">Rs.</span>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder="0.00"
                                                value={addPaymentSplitQr === '0' ? '' : addPaymentSplitQr}
                                                onChange={e => {
                                                    const valStr = e.target.value
                                                    if (valStr === '') {
                                                        setAddPaymentSplitQr('')
                                                        return
                                                    }
                                                    const val = parseFloat(valStr)
                                                    setAddPaymentSplitQr(isNaN(val) ? '0' : val.toString())
                                                }}
                                                className="w-full pl-8 pr-2 py-2 border border-hairline rounded-xl text-xs font-bold bg-white focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* QR Code Selector if QR is chosen */}
                            {(addPaymentMethod === 'qr_digital' || addPaymentMethod === 'split') && qrCodes.length > 1 && (
                                <div className="space-y-1">
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase">Select QR Account / Gateway</label>
                                    <select
                                        value={addPaymentQrId}
                                        onChange={e => setAddPaymentQrId(e.target.value)}
                                        className="w-full px-3 py-2 border border-hairline focus:border-brand-500 rounded-xl text-xs bg-white text-ink focus:outline-none"
                                    >
                                        <option value="">-- Choose Account --</option>
                                        {qrCodes.map(qr => (
                                            <option key={qr.id} value={qr.id}>{qr.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Payment Note / Remarks */}
                            <div className="space-y-1">
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase">Payment Note / Remarks</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Dine in, Advance, Deposit..."
                                    value={addPaymentNote}
                                    onChange={e => setAddPaymentNote(e.target.value)}
                                    className="w-full px-3 py-2 border border-hairline focus:border-brand-500 rounded-xl text-xs bg-white text-ink font-medium focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="p-4 border-t border-hairline bg-surface-muted/20 flex gap-2">
                            <button
                                type="button"
                                onClick={() => setAddPaymentOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-hairline bg-surface hover:bg-surface-muted text-ink text-label font-bold transition"
                                disabled={submittingPayment}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleAddMidStayPayment}
                                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-label font-bold transition shadow-sm flex items-center justify-center gap-1.5"
                                disabled={submittingPayment}
                            >
                                {submittingPayment ? (
                                    <>
                                        <Loader2 className="animate-spin" size={14} />
                                        Saving...
                                    </>
                                ) : (
                                    'Record Payment'
                                )}
                            </button>
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

            <AdvancePaymentHistoryModal
                isOpen={advanceHistoryOpen}
                onClose={() => setAdvanceHistoryOpen(false)}
                bookingId={activeBooking?.id || null}
                guestName={activeBooking?.guest_name}
                roomNumber={selectedRoom?.room_number}
            />


            {/* Combine Bills Portal Modal */}
            {mounted && combineBillsOpen && activeBooking && createPortal(
                <div 
                    className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all duration-300"
                    onClick={() => setCombineBillsOpen(false)}
                >
                    <div 
                        className="bg-surface rounded-[24px] border border-hairline shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                            <div className="flex items-center gap-2">
                                <Layers size={18} className="text-indigo-600" />
                                <div>
                                    <h3 className="text-body font-black text-ink">Link & Combine Room Bills</h3>
                                    <p className="text-[10px] text-ink-subtle">Combine multiple active room stays into a single folio ticket</p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setCombineBillsOpen(false)}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-surface hover:bg-surface-muted transition text-ink-subtle"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-4 text-xs">
                            {stayGroup && stayGroup.rooms && stayGroup.rooms.length > 1 && (
                                <div className="p-4 border border-indigo-200 rounded-2xl bg-indigo-50/50 space-y-3">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs font-black text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                                            <Link2 size={14} className="text-indigo-600" /> Currently Combined Folio ({stayGroup.rooms.length} rooms)
                                        </span>
                                        <span className="text-[10px] font-bold text-indigo-700">Total Stay: {money(stayGroup.stayCost)}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {stayGroup.rooms.map(r => (
                                            <div key={r.bookingId} className="flex justify-between items-center bg-surface border border-indigo-150 p-2.5 rounded-xl text-xs">
                                                <div>
                                                    <p className="font-extrabold text-ink">Room {r.roomNumber} {r.bookingId === activeBooking.id ? '(This Room)' : ''}</p>
                                                    <p className="text-[10px] text-ink-subtle">{r.nights} night(s) · {money(r.stayCost)}</p>
                                                </div>
                                                {r.bookingId !== activeBooking.id && (
                                                    <button
                                                        type="button"
                                                        disabled={unlinkingBookingId === r.bookingId}
                                                        onClick={() => handleUnlinkBill(r.bookingId)}
                                                        className="px-2.5 py-1 text-[10px] font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition flex items-center gap-1 cursor-pointer"
                                                    >
                                                        {unlinkingBookingId === r.bookingId ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />} Unlink
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <p className="text-[11px] font-bold text-ink-subtle uppercase">
                                    Select open rooms to add to Room {selectedRoom?.room_number}&apos;s bill:
                                </p>

                                {loadingCandidates ? (
                                    <div className="py-8 flex flex-col items-center justify-center gap-2">
                                        <Loader2 size={24} className="animate-spin text-indigo-600" />
                                        <p className="text-xs text-ink-subtle">Finding available open room stays...</p>
                                    </div>
                                ) : combineCandidates.length === 0 ? (
                                    <div className="p-4 border border-dashed border-hairline rounded-xl text-center text-ink-subtle">
                                        <p className="font-semibold text-xs">No other open room stays available to combine.</p>
                                        <p className="text-[10px] text-ink-subtle mt-0.5">All other rooms are either clean/vacant or already checked out.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {combineCandidates.map(c => {
                                            const checked = selectedAddBookingIds.includes(c.bookingId)
                                            return (
                                                <div 
                                                    key={c.bookingId}
                                                    onClick={() => {
                                                        setSelectedAddBookingIds(prev =>
                                                            checked ? prev.filter(id => id !== c.bookingId) : [...prev, c.bookingId]
                                                        )
                                                    }}
                                                    className={`p-3 border rounded-xl cursor-pointer transition flex items-center justify-between ${
                                                        checked ? 'border-indigo-500 bg-indigo-50/70 shadow-sm' : 'border-hairline bg-surface hover:bg-surface-muted/50'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => {}}
                                                            className="w-4 h-4 rounded border-hairline text-indigo-600 focus:ring-indigo-500"
                                                        />
                                                        <div>
                                                            <p className="font-extrabold text-ink text-xs">Room {c.roomNumber} — {c.guestName}</p>
                                                            <p className="text-[10px] text-ink-subtle">{c.guestPhone || 'No phone'} · Advance Paid: {money(c.advancePaid)}</p>
                                                        </div>
                                                    </div>
                                                    {c.bringsRooms > 1 && (
                                                        <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">
                                                            +{c.bringsRooms} rooms
                                                        </span>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-hairline bg-surface-muted/30 flex items-center justify-end gap-2">
                            <Button variant="secondary" onClick={() => setCombineBillsOpen(false)}>
                                Done / Close
                            </Button>
                            {combineCandidates.length > 0 && (
                                <Button
                                    variant="primary"
                                    icon={Link2}
                                    loading={combiningBills}
                                    disabled={combiningBills || selectedAddBookingIds.length === 0}
                                    onClick={handleCombineBillsSubmit}
                                    className="!bg-indigo-600 hover:!bg-indigo-700"
                                >
                                    Combine ({selectedAddBookingIds.length}) Rooms
                                </Button>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
