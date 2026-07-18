'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Filter, Bed, Wrench, ChevronRight, Download, Loader2, X, Users, Calendar, Phone, Pencil, Trash2, Tags, ArrowLeft } from 'lucide-react'
import { ROOM_STATUS_CONFIG, getRoomStatusConfig } from '@/lib/roomStatus'
import type { Room, RoomType, RoomStatus, Booking } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import Modal from '@/components/ui/Modal'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'react-hot-toast'
import RoomBillingModal, { type BillingTable, type BillingOrder } from '@/components/admin/RoomBillingModal'
import NextImage from 'next/image'
import { renderQrCardPng, downloadDataUrl } from '@/lib/qrCardCanvas'
import { useQrCodes } from '@/lib/hooks/useQrCodes'

const QR_LOGO_SRC = '/icons/kkkhane.png'

interface RoomsClientProps {
    initialRooms: Room[]
    roomTypes: RoomType[]
    restaurantId: string
    restaurantSlug: string
    restaurantName?: string
    tables?: BillingTable[]
    activeOrders?: BillingOrder[]
}

export default function RoomsClient({
    initialRooms,
    roomTypes,
    restaurantSlug,
    restaurantName = 'KKKhane',
    tables = [],
    activeOrders = []
}: RoomsClientProps) {
    const router = useRouter()
    const [rooms, setRooms] = useState<Room[]>(initialRooms)
    const [roomTypesList, setRoomTypesList] = useState<RoomType[]>(roomTypes)
    const qrCodes = useQrCodes()

    // Filters state
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [filterType, setFilterType] = useState<string>('all')
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
    const [qrToDownload, setQrToDownload] = useState<{ url: string; label: string } | null>(null)

    // Stay being settled in the checkout/billing modal
    const [billingStay, setBillingStay] = useState<{ room: Room; booking: Booking } | null>(null)

    // Modals state
    const [isAddRoomOpen, setIsAddRoomOpen] = useState(false)
    const [isAddTypeOpen, setIsAddTypeOpen] = useState(false)
    const [isBookModalOpen, setIsBookModalOpen] = useState(false)
    const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState(false)
    const [isDeletingRoom, setIsDeletingRoom] = useState(false)

    // Active Booking (occupied room check-in details)
    const [activeBooking, setActiveBooking] = useState<Booking | null>(null)
    // Which room's booking has been fetched — loading is derived from it
    const [loadedBookingRoomId, setLoadedBookingRoomId] = useState<string | null>(null)

    const [roomForm, setRoomForm] = useState({ room_number: '', floor: '', type_id: '', beds: '1' })
    const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
    const [typeForm, setTypeForm] = useState({ name: '', base_price: '', capacity: '2', description: '' })
    const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
    // The Categories modal opens on the list; "form" is the add/edit sub-view.
    const [typeModalView, setTypeModalView] = useState<'list' | 'form'>('list')
    const [bookingForm, setBookingForm] = useState({
        guest_name: '',
        guest_phone: '',
        kyc: '',
        check_in: '',
        check_out: '',
        guest_count: '2',
        advance_amount: '0',
        advance_payment_method: 'cash',
        advance_cash_amount: '',
        advance_qr_amount: '',
        advance_qr_code_id: ''
    })
    const [isSubmittingRoom, setIsSubmittingRoom] = useState(false)
    const [isSubmittingType, setIsSubmittingType] = useState(false)
    const [isSubmittingBooking, setIsSubmittingBooking] = useState(false)

    // Reset the fetched booking when the selected room changes (render-phase
    // adjust, see react.dev "You Might Not Need an Effect")
    const [prevSelectedRoomId, setPrevSelectedRoomId] = useState<string | null>(null)
    if (prevSelectedRoomId !== (selectedRoom?.id ?? null)) {
        setPrevSelectedRoomId(selectedRoom?.id ?? null)
        setActiveBooking(null)
    }
    const loadingBooking = !!selectedRoom && selectedRoom.status === 'occupied' && loadedBookingRoomId !== selectedRoom.id

    // Fetch active booking details when an occupied room is selected
    useEffect(() => {
        if (!selectedRoom || selectedRoom.status !== 'occupied') return
        let cancelled = false
        fetch(`/api/rooms/booking?roomId=${selectedRoom.id}`)
            .then(res => res.json())
            .then(data => {
                if (!cancelled) setActiveBooking(data.success ? data.data : null)
            })
            .catch(err => {
                console.error("Error fetching room booking:", err)
                if (!cancelled) setActiveBooking(null)
            })
            .finally(() => {
                if (!cancelled) setLoadedBookingRoomId(selectedRoom.id)
            })
        return () => { cancelled = true }
    }, [selectedRoom, rooms])

    // Filter logic
    const filteredRooms = rooms.filter(room => {
        const matchesStatus = filterStatus === 'all' || room.status === filterStatus
        const matchesType = filterType === 'all' || room.type_id === filterType
        return matchesStatus && matchesType
    })

    const handleStatusChange = async (roomId: string, newStatus: RoomStatus, force = false) => {
        // Optimistic UI update
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
        if (selectedRoom?.id === roomId) {
            setSelectedRoom(prev => prev ? { ...prev, status: newStatus } : null)
        }

        try {
            const res = await fetch(`/api/rooms/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, status: newStatus, force })
            })
            if (!res.ok) {
                setRooms(initialRooms)
                const body = await res.json().catch(() => null)
                toast.error(body?.error || 'Failed to update room status')
            } else {
                toast.success('Room status updated')
            }
        } catch {
            setRooms(initialRooms)
            toast.error('Failed to update room status')
        }
    }

    // Reset the Add/Edit Category form back to blank and return to the list view
    const resetTypeForm = () => {
        setEditingTypeId(null)
        setTypeForm({ name: '', base_price: '', capacity: '2', description: '' })
        setTypeModalView('list')
    }

    // Load an existing category into the form for editing
    const openEditType = (type: RoomType) => {
        setEditingTypeId(type.id)
        setTypeForm({
            name: type.name,
            base_price: type.base_price.toString(),
            capacity: type.capacity.toString(),
            description: type.description || ''
        })
        setTypeModalView('form')
    }

    // Add or Update Room Type (Category) handler
    const handleSubmitType = async () => {
        if (!typeForm.name.trim()) { toast.error('Category name is required'); return }
        const price = parseFloat(typeForm.base_price)
        if (isNaN(price) || price < 0) { toast.error('Enter a valid base price'); return }
        setIsSubmittingType(true)
        try {
            const isEdit = !!editingTypeId
            const res = await fetch('/api/rooms/types', {
                method: isEdit ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(isEdit ? { id: editingTypeId } : {}),
                    name: typeForm.name,
                    base_price: price,
                    capacity: parseInt(typeForm.capacity) || 2,
                    description: typeForm.description
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            if (isEdit) {
                setRoomTypesList(prev => prev.map(t => t.id === data.data.id ? data.data : t))
                // Every room already fetched carries its own embedded room_types
                // snapshot (joined at initial load) — without this, already-loaded
                // rooms of this category keep quoting the old price/capacity until
                // a full page reload, even though the category itself was updated.
                setRooms(prev => prev.map(r => r.type_id === data.data.id ? { ...r, room_types: data.data } : r))
                setSelectedRoom(prev => prev && prev.type_id === data.data.id ? { ...prev, room_types: data.data } : prev)
                toast.success('Category updated!')
            } else {
                setRoomTypesList(prev => [...prev, data.data])
                setRoomForm(prev => ({ ...prev, type_id: data.data.id })) // Pre-select in room form
                toast.success('Category added!')
            }
            resetTypeForm()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to save category')
        } finally {
            setIsSubmittingType(false)
        }
    }

    // Delete (deactivate) Category handler — refused server-side if any active
    // room still uses it (see api/rooms/types DELETE).
    const handleDeleteType = async (type: RoomType) => {
        if (!confirm(`Delete category "${type.name}"? Rooms using it must be reassigned first.`)) return
        try {
            const res = await fetch('/api/rooms/types', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: type.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error)
            setRoomTypesList(prev => prev.filter(t => t.id !== type.id))
            toast.success('Category deleted')
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete category')
        }
    }

    // Reset the Add/Edit Room form back to its blank "add" state
    const resetRoomForm = () => {
        setEditingRoomId(null)
        setRoomForm({ room_number: '', floor: '', type_id: '', beds: '1' })
    }

    // Load an existing room into the form for editing
    const openEditRoom = (room: Room) => {
        setEditingRoomId(room.id)
        setRoomForm({ room_number: room.room_number, floor: room.floor || '', type_id: room.type_id || '', beds: String(room.beds || 1) })
        setIsAddRoomOpen(true)
    }

    // Add or Update Room handler
    const handleSubmitRoom = async () => {
        if (!roomForm.room_number.trim()) { toast.error('Room number is required'); return }
        if (!roomForm.type_id) { toast.error('Select a Room Category'); return }
        setIsSubmittingRoom(true)
        try {
            const isEdit = !!editingRoomId
            const res = await fetch('/api/rooms', {
                method: isEdit ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(isEdit ? { ...roomForm, id: editingRoomId } : roomForm),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            if (isEdit) {
                setRooms(prev => prev.map(r => r.id === data.data.id ? data.data : r))
                setSelectedRoom(prev => prev && prev.id === data.data.id ? data.data : prev)
                toast.success('Room updated successfully!')
            } else {
                setRooms(prev => [...prev, data.data])
                toast.success('Room created successfully!')
            }
            setIsAddRoomOpen(false)
            resetRoomForm()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to save room')
        } finally {
            setIsSubmittingRoom(false)
        }
    }

    // Delete (soft) a room — rooms with stay history can't be hard-deleted (see
    // api/rooms DELETE), so this just hides the room from the list. Occupied
    // rooms are blocked by the API.
    const handleDeleteRoom = async (room: Room) => {
        if (!confirm(`Delete Room ${room.room_number}? This cannot be undone.`)) return
        setIsDeletingRoom(true)
        try {
            const res = await fetch('/api/rooms', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: room.id }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error)
            setRooms(prev => prev.filter(r => r.id !== room.id))
            setSelectedRoom(null)
            toast.success(`Room ${room.room_number} deleted`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete room')
        } finally {
            setIsDeletingRoom(false)
        }
    }

    // Open booking modal with default dates
    const handleOpenBooking = () => {
        if (selectedRoom?.status !== 'available') {
            toast.error('Only available rooms can be booked. Please mark the room as available first.')
            return
        }
        const todayDate = new Date()
        const tomorrowDate = new Date()
        tomorrowDate.setDate(todayDate.getDate() + 1)

        const roomType = roomTypesList.find(t => t.id === selectedRoom?.type_id)

        setBookingForm({
            guest_name: '',
            guest_phone: '',
            kyc: '',
            check_in: todayDate.toISOString().slice(0, 16), // YYYY-MM-DDTHH:MM
            check_out: tomorrowDate.toISOString().slice(0, 16),
            guest_count: roomType ? roomType.capacity.toString() : '2',
            advance_amount: '0',
            advance_payment_method: 'cash',
            advance_cash_amount: '',
            advance_qr_amount: '',
            advance_qr_code_id: ''
        })
        setIsBookModalOpen(true)
    }

    // Create Room Booking handler
    const handleCreateBooking = async () => {
        if (!bookingForm.guest_name.trim()) { toast.error('Guest name is required'); return }
        if (!bookingForm.guest_phone.trim()) { toast.error('Phone number is required'); return }
        if (!bookingForm.check_in) { toast.error('Check-in time is required'); return }
        if (!bookingForm.check_out) { toast.error('Check-out time is required'); return }

        if (new Date(bookingForm.check_out) <= new Date(bookingForm.check_in)) {
            toast.error('Check-out must be after check-in')
            return
        }

        const count = parseInt(bookingForm.guest_count)
        if (isNaN(count) || count <= 0) { toast.error('Enter a valid guest count'); return }

        const isSplit = bookingForm.advance_payment_method === 'split'
        const splitCash = parseFloat(bookingForm.advance_cash_amount) || 0
        const splitQr = parseFloat(bookingForm.advance_qr_amount) || 0
        if (isSplit && splitCash <= 0 && splitQr <= 0) {
            toast.error('Enter a cash and/or QR amount for the split advance')
            return
        }

        setIsSubmittingBooking(true)
        try {
            const res = await fetch('/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    room_id: selectedRoom!.id,
                    guest_name: bookingForm.guest_name,
                    guest_phone: bookingForm.guest_phone,
                    kyc: bookingForm.kyc,
                    check_in: bookingForm.check_in,
                    check_out: bookingForm.check_out,
                    guest_count: count,
                    advance_amount: isSplit ? splitCash + splitQr : (parseFloat(bookingForm.advance_amount) || 0),
                    advance_payment_method: bookingForm.advance_payment_method,
                    advance_cash_amount: isSplit ? splitCash : undefined,
                    advance_qr_amount: isSplit ? splitQr : undefined,
                    advance_qr_code_id: (bookingForm.advance_payment_method === 'qr_digital' || isSplit)
                        ? (bookingForm.advance_qr_code_id || (qrCodes.length === 1 ? qrCodes[0].id : undefined))
                        : undefined
                })
            })
            const data = await res.json()
            if (res.status === 401 || data.error === 'Unauthorized') {
                toast.error('Session expired. Redirecting to login...')
                setTimeout(() => {
                    window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`
                }, 1000)
                return
            }
            if (!res.ok) throw new Error(data.error)

            setRooms(prev => prev.map(r => r.id === selectedRoom!.id ? { ...r, status: 'occupied' } : r))
            setSelectedRoom(prev => prev ? { ...prev, status: 'occupied' } : null)
            setIsBookModalOpen(false)
            toast.success('Room booked successfully!')
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to book room')
        } finally {
            setIsSubmittingBooking(false)
        }
    }

    // Download QR Code card handler
    const handleDownloadQR = (roomNumber: string) => {
        const roomUrl = getRoomUrl(roomNumber)
        setQrToDownload({ url: roomUrl, label: `Room ${roomNumber}` })
    }

    // High-resolution Room QR Card Downloader Effect
    useEffect(() => {
        if (!qrToDownload) return

        let active = true

        const runDownload = async () => {
            // Wait for canvas to mount and render
            await new Promise(resolve => setTimeout(resolve, 150))
            if (!active) return

            const container = document.getElementById('shared-high-res-qr-container')
            const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null
            if (!canvas) {
                setQrToDownload(null)
                return
            }

            const pngFile = await renderQrCardPng({
                label: qrToDownload.label,
                restaurantName,
                sourceCanvas: canvas,
                logoSrc: QR_LOGO_SRC,
            })
            if (!active) return

            downloadDataUrl(pngFile, `${qrToDownload.label.replace(/\s+/g, '_')}_QR.png`)

            // Reset state
            setQrToDownload(null)
            toast.success(`Downloaded QR Card for ${qrToDownload.label}!`)
        }

        runDownload()

        return () => {
            active = false
        }
    }, [qrToDownload, restaurantName])

    const getRoomUrl = (roomNumber: string) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/r/${restaurantSlug}?room=${encodeURIComponent(roomNumber)}`
        }
        return `https://kkkhane.com/r/${restaurantSlug}?room=${encodeURIComponent(roomNumber)}`
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

    return (
        <div className="space-y-6 pb-12">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Rooms & Suites</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage hotel rooms, occupancy status, and housekeeping.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button
                        onClick={() => { setTypeModalView('list'); setIsAddTypeOpen(true) }}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl border border-gray-200 text-sm transition-colors"
                    >
                        <Tags size={16} /> Categories
                    </button>
                    <button
                        onClick={() => { resetRoomForm(); setIsAddRoomOpen(true) }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/10 hover:scale-[1.01]"
                    >
                        <Plus size={16} /> Add Room
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">{ROOM_STATUS_CONFIG.available.label}</p>
                    <p className="text-3xl font-black text-emerald-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'available').length}
                    </p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500">{ROOM_STATUS_CONFIG.occupied.label}</p>
                    <p className="text-3xl font-black text-blue-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'occupied').length}
                    </p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-500">{ROOM_STATUS_CONFIG.dirty.label}</p>
                    <p className="text-3xl font-black text-amber-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'dirty').length}
                    </p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-rose-500">{ROOM_STATUS_CONFIG.maintenance.label}</p>
                    <p className="text-3xl font-black text-rose-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'maintenance').length}
                    </p>
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
                        <option value="all">All Statuses</option>
                        {(Object.keys(ROOM_STATUS_CONFIG) as Array<keyof typeof ROOM_STATUS_CONFIG>).map(status => (
                            <option key={status} value={status}>{ROOM_STATUS_CONFIG[status].label}</option>
                        ))}
                    </select>

                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 focus:outline-none focus:border-[#ff5a00] cursor-pointer"
                    >
                        <option value="all">All Room Types</option>
                        {roomTypesList.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Showing {filteredRooms.length} of {rooms.length} Rooms
                </div>
            </div>

            {/* Room Grid */}
            {filteredRooms.length === 0 ? (
                <div className="bg-white rounded-3xl p-16 border border-gray-100 text-center shadow-sm">
                    <EmptyState
                        icon={Bed}
                        title="No rooms match filters"
                        description="Try modifying your status or category filters, or add a new room."
                    />
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {filteredRooms.map(room => {
                        const typeName = roomTypesList.find(t => t.id === room.type_id)?.name || 'Standard'
                        const statusCfg = getRoomStatusConfig(room.status)
                        return (
                            <div
                                key={room.id}
                                onClick={() => setSelectedRoom(room)}
                                className={`bg-white border border-l-4 rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 select-none ${
                                    selectedRoom?.id === room.id ? 'border-[#ff5a00] ring-1 ring-[#ff5a00]' : `border-gray-100 ${statusCfg.accent}`
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <span className="text-xs font-bold text-gray-400 capitalize">Floor {room.floor || '1'} • {room.beds || 1} Bed{room.beds !== 1 ? 's' : ''}</span>
                                    <div className={`p-1.5 rounded-lg border flex items-center justify-center shrink-0 ${statusCfg.badge}`}>
                                        <statusCfg.icon size={16} />
                                    </div>
                                </div>
                                <div className="my-5">
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-none">{room.room_number}</h3>
                                    <p className="text-xs text-gray-400 mt-1.5 font-bold uppercase truncate">{typeName}</p>
                                </div>
                                <div className="border-t border-gray-50 pt-2 flex items-center justify-between">
                                    <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${statusCfg.text}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                                        {statusCfg.label}
                                    </span>
                                    <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-400" />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Quick Actions Drawer for Selected Room */}
            {selectedRoom && !isAddRoomOpen && !isAddTypeOpen && !isBookModalOpen && (
                <div className="fixed bottom-6 right-6 z-40 bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in slide-in-from-bottom duration-300 max-h-[85vh] overflow-y-auto">

                    {/* Drawer Header Block */}
                    <div className="flex items-start justify-between mb-4 border-b border-gray-50 pb-3">
                        <div>
                            <h4 className="text-lg font-black text-gray-900">Room {selectedRoom.room_number}</h4>
                            <p className="text-xs text-gray-500 font-semibold uppercase">{roomTypesList.find(t => t.id === selectedRoom.type_id)?.name || 'Standard'}</p>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => openEditRoom(selectedRoom)}
                                title="Edit room"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                            >
                                <Pencil size={15} />
                            </button>
                            <button
                                onClick={() => handleDeleteRoom(selectedRoom)}
                                disabled={isDeletingRoom || selectedRoom.status === 'occupied'}
                                title={selectedRoom.status === 'occupied' ? 'Check out the guest before deleting' : 'Delete room'}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {isDeletingRoom ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                            </button>
                            <button
                                onClick={() => setSelectedRoom(null)}
                                title="Close"
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                            >
                                ✕
                            </button>
                        </div>
                    </div>

                    {/* Room Details — the static facts a manager needs at a glance. */}
                    {(() => {
                        const t = roomTypesList.find(rt => rt.id === selectedRoom.type_id)
                        return (
                            <div className="mb-4 bg-gray-50/70 border border-gray-100 rounded-2xl p-4 grid grid-cols-3 gap-x-3 gap-y-3 text-xs">
                                <div>
                                    <p className="text-gray-400 font-bold uppercase tracking-wide">Floor</p>
                                    <p className="font-extrabold text-gray-900 mt-0.5">{selectedRoom.floor || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 font-bold uppercase tracking-wide">Beds</p>
                                    <p className="font-extrabold text-gray-900 mt-0.5">{selectedRoom.beds || 1}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 font-bold uppercase tracking-wide">Category</p>
                                    <p className="font-extrabold text-gray-900 mt-0.5 truncate">{t?.name || 'Standard'}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 font-bold uppercase tracking-wide">Base Price</p>
                                    <p className="font-extrabold text-gray-900 mt-0.5">{t ? `Rs. ${t.base_price}` : '—'}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 font-bold uppercase tracking-wide">Capacity</p>
                                    <p className="font-extrabold text-gray-900 mt-0.5">{t ? `${t.capacity} guest${t.capacity === 1 ? '' : 's'}` : '—'}</p>
                                </div>
                                {t?.description && (
                                    <div className="col-span-3">
                                        <p className="text-gray-400 font-bold uppercase tracking-wide">Description</p>
                                        <p className="font-semibold text-gray-700 mt-0.5 leading-snug">{t.description}</p>
                                    </div>
                                )}
                                {selectedRoom.notes && (
                                    <div className="col-span-2">
                                        <p className="text-gray-400 font-bold uppercase tracking-wide">Notes</p>
                                        <p className="font-semibold text-gray-700 mt-0.5 leading-snug">{selectedRoom.notes}</p>
                                    </div>
                                )}
                            </div>
                        )
                    })()}

                    {/* Action Buttons (Book, Closed) — a room automatically goes to
                        Cleaning on checkout (see /api/bookings/checkout), so there's no
                        separate manual "Not Available" step needed here anymore. */}
                    <div className="grid grid-cols-2 gap-2 mb-4 mt-2">
                        <button
                            onClick={handleOpenBooking}
                            disabled={selectedRoom.status !== 'available'}
                            className={`py-2.5 font-extrabold rounded-xl text-xs border transition-all text-center ${
                                selectedRoom.status !== 'available'
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                    : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200/40'
                            }`}
                        >
                            Book
                        </button>
                        <button
                            onClick={() => {
                                if (selectedRoom.status === 'occupied') {
                                    toast.error('Room is currently booked. You must checkout the guest first before closing the room.')
                                    return
                                }
                                setIsConfirmCloseOpen(true)
                            }}
                            disabled={selectedRoom.status === 'occupied'}
                            className={`py-2.5 font-extrabold rounded-xl text-xs border transition-all text-center ${
                                selectedRoom.status === 'occupied'
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                    : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200/40'
                            }`}
                        >
                            Closed
                        </button>
                    </div>

                    {/* Quick Clean / Re-open Action if Room is Cleaning or Closed (Maintenance) */}
                    {selectedRoom.status !== 'available' && selectedRoom.status !== 'occupied' && (
                        <div className="mb-4">
                            {selectedRoom.status === 'dirty' ? (
                                <button
                                    onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all text-center shadow-sm shadow-emerald-600/10"
                                >
                                    ✓ Cleaned (Set Available)
                                </button>
                            ) : (
                                <button
                                    onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all text-center shadow-sm shadow-emerald-600/10"
                                >
                                    ✓ Open Room (Make Available)
                                </button>
                            )}
                        </div>
                    )}

                    <div className="space-y-6 pt-2">
                        {/* Guest / Booking Details (Visible only when room is Booked/Occupied) */}
                        {selectedRoom.status === 'occupied' && (
                            <div className="bg-blue-50/40 border border-blue-100/50 rounded-2xl p-4 space-y-3.5">
                                <h5 className="text-xs font-black text-blue-800 uppercase tracking-wider flex items-center gap-1.5 border-b border-blue-100 pb-2">
                                    <Users size={13} /> Guest Booking Details
                                </h5>

                                {loadingBooking ? (
                                    <div className="flex items-center gap-2 text-xs text-blue-600 py-2">
                                        <Loader2 size={13} className="animate-spin" /> Loading customer profile...
                                    </div>
                                ) : activeBooking ? (
                                    <div className="space-y-2.5 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400 font-bold uppercase tracking-wide">Guest Name:</span>
                                            <span className="font-extrabold text-gray-900">{activeBooking.guest_name}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400 font-bold uppercase tracking-wide">Phone Number:</span>
                                            <a href={`tel:${activeBooking.guest_phone}`} className="font-extrabold text-blue-600 hover:underline flex items-center gap-1">
                                                <Phone size={10} /> {activeBooking.guest_phone}
                                            </a>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400 font-bold uppercase tracking-wide">Total Guests:</span>
                                            <span className="font-extrabold text-gray-900">{activeBooking.adults} Guests</span>
                                        </div>
                                        {activeBooking.notes && activeBooking.notes.startsWith('KYC:') && (
                                            <div className="flex items-center justify-between">
                                                <span className="text-gray-400 font-bold uppercase tracking-wide">KYC details:</span>
                                                <span className="font-extrabold text-gray-900">{activeBooking.notes.replace('KYC:', '').trim()}</span>
                                            </div>
                                        )}
                                        <div className="border-t border-blue-100/60 pt-2 space-y-1.5">
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span className="text-gray-400 font-bold">CHECK IN:</span>
                                                <span className="font-extrabold text-gray-800">{formatDateTime(activeBooking.check_in)}</span>
                                            </div>
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span className="text-gray-400 font-bold">CHECK OUT:</span>
                                                <span className="font-extrabold text-gray-800">{formatDateTime(activeBooking.check_out)}</span>
                                            </div>
                                        </div>

                                        {/* Checkout Button */}
                                        <div className="pt-2">
                                            <button
                                                onClick={() => {
                                                    if (selectedRoom) setBillingStay({ room: selectedRoom, booking: activeBooking })
                                                }}
                                                className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl text-xs transition-colors shadow-sm shadow-rose-600/10"
                                            >
                                                <X size={13} />
                                                Checkout Guest
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2.5">
                                        <p className="text-xs text-rose-500 font-semibold">No booking details found for this session.</p>
                                        <p className="text-[11px] text-gray-400">
                                            This room is marked occupied but has no matching active stay — likely a stuck status from a data glitch. If you've confirmed no guest is actually here, you can force it back to available.
                                        </p>
                                        <button
                                            onClick={() => {
                                                if (!confirm('Force this room back to Available? Only do this if you have confirmed no guest is actually staying here.')) return
                                                handleStatusChange(selectedRoom.id, 'available', true)
                                            }}
                                            className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-extrabold rounded-xl text-xs transition-colors shadow-sm shadow-amber-500/10"
                                        >
                                            <Wrench size={13} />
                                            Force Unstick (Set Available)
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Room Ordering QR Code Card (Dine-in / Table Style) */}
                        <div className="border-t border-gray-100 pt-4">
                            <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">Room QR Service Card</p>

                            <div className="w-[220px] h-[260px] bg-white rounded-xl border border-gray-300 shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col items-center p-3 pb-9 relative overflow-hidden mb-5 select-none mx-auto">

                                {/* Top Banner */}
                                <div className="w-full flex items-center justify-center relative my-1.5 shrink-0">
                                    <div className="absolute left-0 right-0 h-[3px] bg-[#ff7a00]" />
                                    <div className="bg-[#ff7a00] text-white text-[10px] font-black px-4 py-1.5 rounded-sm uppercase tracking-wider relative z-10 min-w-[100px] text-center shadow-sm">
                                        ROOM {selectedRoom.room_number}
                                    </div>
                                </div>

                                {/* QR Code */}
                                <div className="my-1 shrink-0 bg-white">
                                    <div className="hidden">
                                        <QRCodeCanvas
                                            id={`qr-canvas-${selectedRoom.room_number}`}
                                            value={getRoomUrl(selectedRoom.room_number)}
                                            size={200}
                                            level="H"
                                            includeMargin={false}
                                            fgColor="#000000"
                                            bgColor="#ffffff"
                                        />
                                    </div>
                                    <QRCodeCanvas
                                        value={getRoomUrl(selectedRoom.room_number)}
                                        size={105}
                                        level="H"
                                        includeMargin={false}
                                        fgColor="#000000"
                                        bgColor="#ffffff"
                                        imageSettings={{
                                            src: '/icons/kkkhane.png',
                                            height: 28,
                                            width: 28,
                                            excavate: true,
                                        }}
                                    />
                                </div>

                                {/* Hotel / Restaurant Name */}
                                <div className="text-center flex-1 flex flex-col justify-center pb-1 min-h-[40px] px-1 overflow-hidden shrink-0 mt-0.5">
                                    <p className="font-extrabold text-[12px] text-gray-900 truncate max-w-[190px] leading-tight" title={restaurantName}>
                                        {restaurantName || 'KKKhane'}
                                    </p>
                                </div>

                                {/* Bottom Banner */}
                                <div className="absolute bottom-0 left-0 right-0 h-8 bg-[#ff7a00] flex items-center justify-center gap-1.5 shrink-0 shadow-[0_-2px_10px_rgba(255,122,0,0.3)]">
                                    <span
                                        className="text-white text-[9px] font-extrabold tracking-wider uppercase"
                                        style={{ fontFamily: 'var(--font-outfit), var(--font-inter), system-ui, sans-serif' }}
                                    >
                                        Powered by KKKhane
                                    </span>
                                    <div className="relative w-4 h-4 rounded-full border-[1.5px] border-white shrink-0 shadow-sm overflow-hidden bg-white">
                                        <NextImage
                                            src="/icons/kkkhane.png"
                                            alt="Logo"
                                            fill
                                            sizes="16px"
                                            className="object-cover"
                                        />
                                    </div>
                                </div>

                            </div>

                            <button
                                onClick={() => handleDownloadQR(selectedRoom.room_number)}
                                className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-extrabold rounded-xl text-xs transition-colors"
                            >
                                <Download size={13} /> Download QR Card
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Book Room Modal ── */}
            {isBookModalOpen && selectedRoom && (
                <Modal open onClose={() => setIsBookModalOpen(false)} size="md" ariaLabel={`Book Room ${selectedRoom.room_number}`} className="bg-white flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-5 bg-[#ff5a00] flex items-center justify-between text-white shrink-0">
                            <div className="flex items-center gap-3">
                                <Calendar size={22} />
                                <h3 className="font-extrabold text-lg">Book Room {selectedRoom.room_number}</h3>
                            </div>
                            <button onClick={() => setIsBookModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Customer Name *</label>
                                <input
                                    type="text"
                                    value={bookingForm.guest_name}
                                    onChange={e => setBookingForm(b => ({ ...b, guest_name: e.target.value }))}
                                    placeholder="e.g. John Doe"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Phone Number *</label>
                                    <input
                                        type="tel"
                                        value={bookingForm.guest_phone}
                                        onChange={e => setBookingForm(b => ({ ...b, guest_phone: e.target.value }))}
                                        placeholder="e.g. 9812345678"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">KYC Document No. (Optional)</label>
                                    <input
                                        type="text"
                                        value={bookingForm.kyc}
                                        onChange={e => setBookingForm(b => ({ ...b, kyc: e.target.value }))}
                                        placeholder="Citizenship / Passport"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Check-In Time *</label>
                                    <input
                                        type="datetime-local"
                                        value={bookingForm.check_in}
                                        onChange={e => setBookingForm(b => ({ ...b, check_in: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Check-Out Time *</label>
                                    <input
                                        type="datetime-local"
                                        value={bookingForm.check_out}
                                        onChange={e => setBookingForm(b => ({ ...b, check_out: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>
                            </div>

                             <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                    Number of Guests *
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    value={bookingForm.guest_count}
                                    onChange={e => setBookingForm(b => ({ ...b, guest_count: e.target.value }))}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                        Advance Payment (Rs.)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="0.00"
                                        disabled={bookingForm.advance_payment_method === 'split'}
                                        value={bookingForm.advance_payment_method === 'split'
                                            ? ((parseFloat(bookingForm.advance_cash_amount) || 0) + (parseFloat(bookingForm.advance_qr_amount) || 0)).toString()
                                            : bookingForm.advance_amount}
                                        onChange={e => setBookingForm(b => ({ ...b, advance_amount: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                        Payment Method
                                    </label>
                                    <select
                                        value={bookingForm.advance_payment_method}
                                        onChange={e => setBookingForm(b => ({ ...b, advance_payment_method: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    >
                                        <option value="cash">Cash</option>
                                        <option value="qr_digital">QR / Digital</option>
                                        <option value="split">Split (Cash + QR)</option>
                                    </select>
                                </div>
                            </div>

                            {bookingForm.advance_payment_method === 'split' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                            Cash Amount (Rs.)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="0.00"
                                            value={bookingForm.advance_cash_amount}
                                            onChange={e => setBookingForm(b => ({ ...b, advance_cash_amount: e.target.value }))}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                            QR / Digital Amount (Rs.)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            placeholder="0.00"
                                            value={bookingForm.advance_qr_amount}
                                            onChange={e => setBookingForm(b => ({ ...b, advance_qr_amount: e.target.value }))}
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                        />
                                    </div>
                                </div>
                            )}

                            {(bookingForm.advance_payment_method === 'qr_digital' || bookingForm.advance_payment_method === 'split') && qrCodes.length > 1 && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                        Which QR did the guest scan?
                                    </label>
                                    <select
                                        value={bookingForm.advance_qr_code_id}
                                        onChange={e => setBookingForm(b => ({ ...b, advance_qr_code_id: e.target.value }))}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    >
                                        <option value="">Select QR code…</option>
                                        {qrCodes.map(qr => (
                                            <option key={qr.id} value={qr.id}>{qr.label}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="pt-4 flex items-center justify-end gap-2.5">
                                <button
                                    onClick={() => setIsBookModalOpen(false)}
                                    className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreateBooking}
                                    disabled={isSubmittingBooking}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                                >
                                    {isSubmittingBooking ? <Loader2 size={15} className="animate-spin" /> : null}
                                    Book Room
                                </button>
                            </div>
                        </div>
                </Modal>
            )}

            {/* ── Add / Edit Room Modal ── */}
            {isAddRoomOpen && (
                <Modal open onClose={() => { setIsAddRoomOpen(false); resetRoomForm() }} size="md" ariaLabel={editingRoomId ? 'Edit Room' : 'Add New Room'} className="bg-white flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-5 bg-[#ff5a00] flex items-center justify-between text-white shrink-0">
                            <div className="flex items-center gap-3">
                                <Bed size={22} />
                                <h3 className="font-extrabold text-lg">{editingRoomId ? `Edit Room ${roomForm.room_number}` : 'Add New Room'}</h3>
                            </div>
                            <button onClick={() => { setIsAddRoomOpen(false); resetRoomForm() }} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Room Number *</label>
                                <input
                                    type="text"
                                    value={roomForm.room_number}
                                    onChange={e => setRoomForm(r => ({ ...r, room_number: e.target.value }))}
                                    placeholder="e.g. 101, 204B"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Floor</label>
                                <input
                                    type="text"
                                    value={roomForm.floor}
                                    onChange={e => setRoomForm(r => ({ ...r, floor: e.target.value }))}
                                    placeholder="e.g. Ground, 1st, 2nd"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Number of Beds</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={roomForm.beds}
                                    onChange={e => setRoomForm(r => ({ ...r, beds: e.target.value }))}
                                    placeholder="e.g. 1, 2"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Room Type (Category) *</label>
                                    <button
                                        onClick={() => { setIsAddRoomOpen(false); resetTypeForm(); setTypeModalView('form'); setIsAddTypeOpen(true) }}
                                        className="text-xs font-bold text-[#ff5a00] hover:underline"
                                    >
                                        + Create Category
                                    </button>
                                </div>
                                <select
                                    value={roomForm.type_id}
                                    onChange={e => setRoomForm(r => ({ ...r, type_id: e.target.value }))}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] cursor-pointer"
                                >
                                    <option value="">Select Room Category...</option>
                                    {roomTypesList.map(t => (
                                        <option key={t.id} value={t.id}>{t.name} (Rs. {t.base_price})</option>
                                    ))}
                                </select>
                            </div>

                            <div className="pt-4 flex items-center justify-end gap-2.5">
                                <button
                                    onClick={() => { setIsAddRoomOpen(false); resetRoomForm() }}
                                    className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSubmitRoom}
                                    disabled={isSubmittingRoom}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                                >
                                    {isSubmittingRoom ? <Loader2 size={15} className="animate-spin" /> : null}
                                    {editingRoomId ? 'Save Changes' : 'Create Room'}
                                </button>
                            </div>
                        </div>
                </Modal>
            )}

            {/* ── Room Categories Modal (list ↔ add/edit form) ── */}
            {isAddTypeOpen && (
                <Modal open onClose={() => setIsAddTypeOpen(false)} size="md" ariaLabel="Room Categories" className="bg-white flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-5 bg-gray-900 flex items-center justify-between text-white shrink-0">
                            <div className="flex items-center gap-3">
                                {typeModalView === 'form' ? (
                                    <button onClick={resetTypeForm} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                                        <ArrowLeft size={16} />
                                    </button>
                                ) : (
                                    <Tags size={22} className="text-[#ff5a00]" />
                                )}
                                <h3 className="font-extrabold text-lg">
                                    {typeModalView === 'list' ? 'Room Categories' : editingTypeId ? 'Edit Category' : 'Add Category'}
                                </h3>
                            </div>
                            <button onClick={() => setIsAddTypeOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        {typeModalView === 'list' ? (
                            <div className="p-6 space-y-4 overflow-y-auto">
                                <button
                                    onClick={() => { resetTypeForm(); setTypeModalView('form') }}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all"
                                >
                                    <Plus size={16} /> Add New Category
                                </button>

                                {roomTypesList.length === 0 ? (
                                    <p className="text-sm text-gray-400 text-center py-6">No categories yet.</p>
                                ) : (
                                    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                        {roomTypesList.map(type => (
                                            <div
                                                key={type.id}
                                                className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-bold text-sm text-gray-900 truncate">{type.name}</p>
                                                    <p className="text-xs text-gray-500">Rs. {type.base_price} · {type.capacity} Guests</p>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => openEditType(type)}
                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-900 transition-colors"
                                                        title="Edit Category"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteType(type)}
                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                                        title="Delete Category"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="p-6 space-y-4 overflow-y-auto">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Category Name *</label>
                                    <input
                                        type="text"
                                        value={typeForm.name}
                                        onChange={e => setTypeForm(t => ({ ...t, name: e.target.value }))}
                                        placeholder="e.g. Deluxe Room, Presidential Suite"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Base Price (Rs.) *</label>
                                        <input
                                            type="number"
                                            value={typeForm.base_price}
                                            onChange={e => setTypeForm(t => ({ ...t, base_price: e.target.value }))}
                                            placeholder="0.00"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Capacity (Guests) *</label>
                                        <input
                                            type="number"
                                            value={typeForm.capacity}
                                            onChange={e => setTypeForm(t => ({ ...t, capacity: e.target.value }))}
                                            placeholder="2"
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00]"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Description</label>
                                    <textarea
                                        value={typeForm.description}
                                        onChange={e => setTypeForm(t => ({ ...t, description: e.target.value }))}
                                        placeholder="e.g. A spacious room with one King size bed and a balcony views."
                                        rows={3}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#ff5a00]/20 focus:border-[#ff5a00] resize-none"
                                    />
                                </div>

                                <div className="pt-4 flex items-center justify-end gap-2.5">
                                    <button
                                        onClick={resetTypeForm}
                                        className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSubmitType}
                                        disabled={isSubmittingType}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                                    >
                                        {isSubmittingType ? <Loader2 size={15} className="animate-spin" /> : null}
                                        {editingTypeId ? 'Save Changes' : 'Add Category'}
                                    </button>
                                </div>
                            </div>
                        )}
                </Modal>
            )}
            {/* ── Confirm Close Modal ── */}
            {isConfirmCloseOpen && selectedRoom && (
                <Modal open onClose={() => setIsConfirmCloseOpen(false)} size="md" ariaLabel="Confirm checkout" className="bg-white flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-5 bg-rose-600 flex items-center justify-between text-white shrink-0">
                            <div className="flex items-center gap-3">
                                <Wrench size={22} />
                                <h3 className="font-extrabold text-lg">Close Room {selectedRoom.room_number}?</h3>
                            </div>
                            <button onClick={() => setIsConfirmCloseOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <p className="text-sm text-gray-600 font-medium leading-relaxed">
                                Are you sure you want to mark this room as <strong className="text-rose-600 font-extrabold">Closed</strong>?
                                <br /><br />
                                This status should only be used if there is a problem with the room, if it is undergoing maintenance, or for other out-of-order works.
                            </p>
                            <div className="pt-4 flex items-center justify-end gap-2.5 border-t border-gray-50">
                                <button
                                    onClick={() => setIsConfirmCloseOpen(false)}
                                    className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        handleStatusChange(selectedRoom.id, 'maintenance')
                                        setIsConfirmCloseOpen(false)
                                    }}
                                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-rose-600/10"
                                >
                                    Confirm Close
                                </button>
                            </div>
                        </div>
                </Modal>
            )}

            {/* Billing Stay Details modal */}
            {billingStay && (
                <RoomBillingModal
                    room={billingStay.room}
                    booking={billingStay.booking}
                    tables={tables}
                    activeOrders={activeOrders}
                    onClose={() => setBillingStay(null)}
                    onSettled={result => {
                        setRooms(prev => prev.map(r => r.id === result.roomId ? { ...r, status: 'dirty' } : r))
                        setBillingStay(null)
                        setSelectedRoom(null)
                        // tables/activeOrders are server-fetched props, not local state — the
                        // checkout just closed a session and marked its orders paid in the DB,
                        // so refresh to pick that up. Otherwise the next guest booked into this
                        // room would still see the previous guest's (now-settled) orders, since
                        // the stale session/order data never left the client.
                        router.refresh()
                    }}
                />
            )}
            {/* Shared dynamic high-resolution QR canvas for crisp on-demand downloads */}
            {qrToDownload && (
                <div id="shared-high-res-qr-container" className="hidden" style={{ display: 'none' }}>
                    <QRCodeCanvas
                        value={qrToDownload.url}
                        size={1020}
                        level="H"
                        includeMargin={false}
                        fgColor="#000000"
                        bgColor="#ffffff"
                        imageSettings={{
                            src: '/icons/kkkhane.png',
                            height: 272,
                            width: 272,
                            excavate: true,
                        }}
                    />
                </div>
            )}
        </div>
    )
}
