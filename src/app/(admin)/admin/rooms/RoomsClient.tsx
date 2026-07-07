'use client'

import { useState } from 'react'
import { Plus, Filter, Bed, Brush, Wrench, CheckCircle2, ChevronRight, Download, Loader2, X } from 'lucide-react'
import type { Room, RoomType, RoomStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'react-hot-toast'

interface RoomsClientProps {
    initialRooms: Room[]
    roomTypes: RoomType[]
    restaurantId: string
    restaurantSlug: string
}

export default function RoomsClient({ initialRooms, roomTypes, restaurantId, restaurantSlug }: RoomsClientProps) {
    const [rooms, setRooms] = useState<Room[]>(initialRooms)
    const [roomTypesList, setRoomTypesList] = useState<RoomType[]>(roomTypes)
    
    // Filters state
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [filterType, setFilterType] = useState<string>('all')
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

    // Modals state
    const [isAddRoomOpen, setIsAddRoomOpen] = useState(false)
    const [isAddTypeOpen, setIsAddTypeOpen] = useState(false)
    
    const [roomForm, setRoomForm] = useState({ room_number: '', floor: '', type_id: '' })
    const [typeForm, setTypeForm] = useState({ name: '', base_price: '', capacity: '2', description: '' })
    const [isSubmittingRoom, setIsSubmittingRoom] = useState(false)
    const [isSubmittingType, setIsSubmittingType] = useState(false)

    // Filter logic
    const filteredRooms = rooms.filter(room => {
        const matchesStatus = filterStatus === 'all' || room.status === filterStatus
        const matchesType = filterType === 'all' || room.type_id === filterType
        return matchesStatus && matchesType
    })

    const handleStatusChange = async (roomId: string, newStatus: RoomStatus) => {
        // Optimistic UI update
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
        if (selectedRoom?.id === roomId) {
            setSelectedRoom(prev => prev ? { ...prev, status: newStatus } : null)
        }
        
        try {
            const res = await fetch(`/api/rooms/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, status: newStatus })
            })
            if (!res.ok) {
                setRooms(initialRooms)
                toast.error('Failed to update room status')
            } else {
                toast.success('Room status updated')
            }
        } catch {
            setRooms(initialRooms)
            toast.error('Failed to update room status')
        }
    }

    // Add Room Type (Category) handler
    const handleAddType = async () => {
        if (!typeForm.name.trim()) { toast.error('Category name is required'); return }
        const price = parseFloat(typeForm.base_price)
        if (isNaN(price) || price < 0) { toast.error('Enter a valid base price'); return }
        setIsSubmittingType(true)
        try {
            const res = await fetch('/api/rooms/types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: typeForm.name,
                    base_price: price,
                    capacity: parseInt(typeForm.capacity) || 2,
                    description: typeForm.description
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setRoomTypesList(prev => [...prev, data.data])
            setRoomForm(prev => ({ ...prev, type_id: data.data.id })) // Pre-select in room form
            setIsAddTypeOpen(false)
            setTypeForm({ name: '', base_price: '', capacity: '2', description: '' })
            toast.success('Room Category added!')
        } catch (e: any) {
            toast.error(e.message || 'Failed to add Room Category')
        } finally {
            setIsSubmittingType(false)
        }
    }

    // Add Room handler
    const handleAddRoom = async () => {
        if (!roomForm.room_number.trim()) { toast.error('Room number is required'); return }
        if (!roomForm.type_id) { toast.error('Select a Room Category'); return }
        setIsSubmittingRoom(true)
        try {
            const res = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roomForm),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setRooms(prev => [...prev, data.data])
            setIsAddRoomOpen(false)
            setRoomForm({ room_number: '', floor: '', type_id: '' })
            toast.success('Room created successfully!')
        } catch (e: any) {
            toast.error(e.message || 'Failed to add room')
        } finally {
            setIsSubmittingRoom(false)
        }
    }

    // Download QR Code card handler
    const handleDownloadQR = (roomNumber: string) => {
        const canvas = document.getElementById(`qr-canvas-${roomNumber}`) as HTMLCanvasElement
        if (!canvas) return
        
        // Setup high-quality print canvas with top banner and logo
        const qrCanvas = document.createElement('canvas')
        qrCanvas.width = 300
        qrCanvas.height = 420
        const ctx = qrCanvas.getContext('2d')
        if (!ctx) return

        // 1. Draw rounded card background
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.roundRect(0, 0, 300, 420, 20)
        ctx.fill()
        
        // Draw card border
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = 2
        ctx.stroke()

        // 2. Draw Orange Top Accent Banner
        ctx.fillStyle = '#ff5a00'
        ctx.beginPath()
        ctx.roundRect(0, 0, 300, 15, [20, 20, 0, 0])
        ctx.fill()

        // 3. Room Title Text
        ctx.fillStyle = '#1e293b'
        ctx.font = 'bold 24px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`Room ${roomNumber}`, 150, 60)

        ctx.fillStyle = '#64748b'
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText('ROOM SERVICE', 150, 85)

        // 4. Draw QR Code from DOM onto our download canvas
        ctx.drawImage(canvas, 50, 110, 200, 200)

        // 5. Bottom Instructions
        ctx.fillStyle = '#1e293b'
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText('SCAN TO ORDER', 150, 345)

        ctx.fillStyle = '#94a3b8'
        ctx.font = '500 10px sans-serif'
        ctx.fillText('Food & Room Services', 150, 365)

        // Trigger Download
        const pngUrl = qrCanvas.toDataURL("image/png")
        const downloadLink = document.createElement("a")
        downloadLink.href = pngUrl
        downloadLink.download = `Room_${roomNumber}_QR_Card.png`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)
        toast.success(`Downloaded QR Card for Room ${roomNumber}!`)
    }

    const getStatusColor = (status: RoomStatus) => {
        switch (status) {
            case 'available': return 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
            case 'occupied': return 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100'
            case 'dirty': return 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100'
            case 'maintenance': return 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100'
            default: return 'bg-gray-50 text-gray-700 border-gray-100'
        }
    }

    const getStatusIcon = (status: RoomStatus) => {
        switch (status) {
            case 'available': return <CheckCircle2 size={16} />
            case 'occupied': return <Bed size={16} />
            case 'dirty': return <Brush size={16} />
            case 'maintenance': return <Wrench size={16} />
        }
    }

    const getRoomUrl = (roomNumber: string) => {
        if (typeof window !== 'undefined') {
            return `${window.location.origin}/r/${restaurantSlug}?room=${encodeURIComponent(roomNumber)}`
        }
        return `https://kkkhane.com/r/${restaurantSlug}?room=${encodeURIComponent(roomNumber)}`
    }

    return (
        <div className="space-y-6 pb-12 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Rooms & Suites</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage hotel rooms, occupancy status, and housekeeping.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button 
                        onClick={() => setIsAddTypeOpen(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl border border-gray-200 text-sm transition-colors"
                    >
                        <Plus size={16} /> Add Room Type
                    </button>
                    <button 
                        onClick={() => setIsAddRoomOpen(true)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/10 hover:scale-[1.01]"
                    >
                        <Plus size={16} /> Add Room
                    </button>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Rooms</p>
                    <p className="text-3xl font-black text-gray-900 mt-1 tabular-nums">{rooms.length}</p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">Available</p>
                    <p className="text-3xl font-black text-emerald-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'available').length}
                    </p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-500">Occupied</p>
                    <p className="text-3xl font-black text-blue-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'occupied').length}
                    </p>
                </div>
                <div className="bg-white border border-gray-100 p-5 rounded-2xl shadow-[0_4px_20px_rgb(0,0,0,0.01)]">
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-500">Dirty / Cleaning</p>
                    <p className="text-3xl font-black text-amber-600 mt-1 tabular-nums">
                        {rooms.filter(r => r.status === 'dirty').length}
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
                        <option value="available">Available</option>
                        <option value="occupied">Occupied</option>
                        <option value="dirty">Dirty</option>
                        <option value="maintenance">Maintenance</option>
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
                        return (
                            <div 
                                key={room.id}
                                onClick={() => setSelectedRoom(room)}
                                className={`bg-white border rounded-2xl p-4 flex flex-col justify-between cursor-pointer transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 select-none ${
                                    selectedRoom?.id === room.id ? 'border-[#ff5a00] ring-1 ring-[#ff5a00]' : 'border-gray-100'
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <span className="text-xs font-bold text-gray-400 capitalize">Floor {room.floor || '1'}</span>
                                    <div className={`p-1.5 rounded-lg border flex items-center justify-center shrink-0 ${getStatusColor(room.status).split(' ')[0]} ${getStatusColor(room.status).split(' ')[1]}`}>
                                        {getStatusIcon(room.status)}
                                    </div>
                                </div>
                                <div className="my-5">
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-none">{room.room_number}</h3>
                                    <p className="text-xs text-gray-400 mt-1.5 font-bold uppercase truncate">{typeName}</p>
                                </div>
                                <div className="border-t border-gray-50 pt-2 flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{room.status}</span>
                                    <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-400" />
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Quick Actions Drawer for Selected Room */}
            {selectedRoom && !isAddRoomOpen && !isAddTypeOpen && (
                <div className="fixed bottom-6 right-6 z-40 bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in slide-in-from-bottom duration-300 max-h-[85vh] overflow-y-auto">
                    <div className="flex items-start justify-between mb-4 border-b border-gray-50 pb-3">
                        <div>
                            <h4 className="text-lg font-black text-gray-900">Room {selectedRoom.room_number}</h4>
                            <p className="text-xs text-gray-500 font-semibold uppercase">{roomTypesList.find(t => t.id === selectedRoom.type_id)?.name || 'Standard'}</p>
                        </div>
                        <button 
                            onClick={() => setSelectedRoom(null)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Status Section */}
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-2">Change Status</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                    className={`flex items-center gap-2 p-2.5 border rounded-xl text-xs font-bold transition-all ${
                                        selectedRoom.status === 'available' 
                                            ? 'bg-emerald-600 border-emerald-600 text-white' 
                                            : 'border-gray-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-100 text-gray-600 bg-gray-50/50'
                                    }`}
                                >
                                    <CheckCircle2 size={14} className={selectedRoom.status === 'available' ? 'text-white' : 'text-emerald-500'} /> Available
                                </button>
                                <button 
                                    onClick={() => handleStatusChange(selectedRoom.id, 'occupied')}
                                    className={`flex items-center gap-2 p-2.5 border rounded-xl text-xs font-bold transition-all ${
                                        selectedRoom.status === 'occupied' 
                                            ? 'bg-blue-600 border-blue-600 text-white' 
                                            : 'border-gray-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-100 text-gray-600 bg-gray-50/50'
                                    }`}
                                >
                                    <Bed size={14} className={selectedRoom.status === 'occupied' ? 'text-white' : 'text-blue-500'} /> Occupied
                                </button>
                                <button 
                                    onClick={() => handleStatusChange(selectedRoom.id, 'dirty')}
                                    className={`flex items-center gap-2 p-2.5 border rounded-xl text-xs font-bold transition-all ${
                                        selectedRoom.status === 'dirty' 
                                            ? 'bg-amber-600 border-amber-600 text-white' 
                                            : 'border-gray-100 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-100 text-gray-600 bg-gray-50/50'
                                    }`}
                                >
                                    <Brush size={14} className={selectedRoom.status === 'dirty' ? 'text-white' : 'text-amber-500'} /> Dirty
                                </button>
                                <button 
                                    onClick={() => handleStatusChange(selectedRoom.id, 'maintenance')}
                                    className={`flex items-center gap-2 p-2.5 border rounded-xl text-xs font-bold transition-all ${
                                        selectedRoom.status === 'maintenance' 
                                            ? 'bg-rose-600 border-rose-600 text-white' 
                                            : 'border-gray-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 text-gray-600 bg-gray-50/50'
                                    }`}
                                >
                                    <Wrench size={14} className={selectedRoom.status === 'maintenance' ? 'text-white' : 'text-rose-500'} /> Maintenance
                                </button>
                            </div>
                        </div>

                        {/* Room Ordering QR Code Card (Dine-in / Table Style) */}
                        <div className="border-t border-gray-100 pt-4">
                            <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-3">Room QR Service Card</p>
                            
                            <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm flex flex-col items-center select-none max-w-[240px] mx-auto relative overflow-hidden">
                                {/* Top Orange Accent Line */}
                                <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#ff5a00]" />
                                
                                <div className="my-3 text-center">
                                    <span className="text-[9px] text-gray-400 font-extrabold uppercase tracking-widest">Room Service</span>
                                    <h4 className="text-lg font-black text-gray-900 leading-tight">Room {selectedRoom.room_number}</h4>
                                </div>

                                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 mb-3 flex items-center justify-center">
                                    {/* Invisible canvas for QR Code translation */}
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
                                    {/* Visible render */}
                                    <QRCodeCanvas
                                        value={getRoomUrl(selectedRoom.room_number)}
                                        size={120}
                                        level="H"
                                        includeMargin={false}
                                        fgColor="#000000"
                                        bgColor="#ffffff"
                                        imageSettings={{
                                            src: '/icons/kkkhane.png',
                                            height: 24,
                                            width: 24,
                                            excavate: true,
                                        }}
                                    />
                                </div>

                                <p className="text-[9px] text-gray-400 font-bold text-center leading-normal mb-3 uppercase tracking-wide">
                                    Scan to Order Food & Services
                                </p>
                                
                                <button
                                    onClick={() => handleDownloadQR(selectedRoom.room_number)}
                                    className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-gray-905 hover:bg-gray-800 text-white font-extrabold rounded-xl text-xs transition-colors bg-gray-900"
                                >
                                    <Download size={13} /> Download QR Card
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add Room Modal ── */}
            {isAddRoomOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="px-6 py-5 bg-[#ff5a00] flex items-center justify-between text-white">
                            <div className="flex items-center gap-3">
                                <Bed size={22} />
                                <h3 className="font-extrabold text-lg">Add New Room</h3>
                            </div>
                            <button onClick={() => setIsAddRoomOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
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
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Room Type (Category) *</label>
                                    <button 
                                        onClick={() => { setIsAddRoomOpen(false); setIsAddTypeOpen(true) }}
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
                                    onClick={() => setIsAddRoomOpen(false)}
                                    className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddRoom}
                                    disabled={isSubmittingRoom}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                                >
                                    {isSubmittingRoom ? <Loader2 size={15} className="animate-spin" /> : null}
                                    Create Room
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Add Room Type (Category) Modal ── */}
            {isAddTypeOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden">
                        <div className="px-6 py-5 bg-gray-900 flex items-center justify-between text-white">
                            <div className="flex items-center gap-3">
                                <Bed size={22} className="text-[#ff5a00]" />
                                <h3 className="font-extrabold text-lg">Add Room Category</h3>
                            </div>
                            <button onClick={() => setIsAddTypeOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 transition-colors">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
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
                                    onClick={() => setIsAddTypeOpen(false)}
                                    className="px-4 py-2.5 text-gray-500 hover:text-gray-700 font-semibold rounded-xl text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleAddType}
                                    disabled={isSubmittingType}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-50"
                                >
                                    {isSubmittingType ? <Loader2 size={15} className="animate-spin" /> : null}
                                    Add Category
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
