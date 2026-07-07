'use client'

import { useState } from 'react'
import { Plus, Filter, Bed, Brush, Wrench, CheckCircle2, ChevronRight, LayoutGrid, Info } from 'lucide-react'
import type { Room, RoomType, RoomStatus } from '@/types/database'
import EmptyState from '@/components/ui/EmptyState'

interface RoomsClientProps {
    initialRooms: Room[]
    roomTypes: RoomType[]
    restaurantId: string
}

export default function RoomsClient({ initialRooms, roomTypes, restaurantId }: RoomsClientProps) {
    const [rooms, setRooms] = useState<Room[]>(initialRooms)
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [filterType, setFilterType] = useState<string>('all')
    const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

    // Filter logic
    const filteredRooms = rooms.filter(room => {
        const matchesStatus = filterStatus === 'all' || room.status === filterStatus
        const matchesType = filterType === 'all' || room.type_id === filterType
        return matchesStatus && matchesType
    })

    const handleStatusChange = async (roomId: string, newStatus: RoomStatus) => {
        // Optimistic UI update
        setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: newStatus } : r))
        
        try {
            const res = await fetch(`/api/rooms/status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, status: newStatus })
            })
            if (!res.ok) {
                // Revert on error
                setRooms(initialRooms)
            }
        } catch {
            setRooms(initialRooms)
        }
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

    return (
        <div className="space-y-6 pb-12 animate-fade-up">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Rooms & Suites</h1>
                    <p className="text-sm text-gray-500 mt-1">Manage hotel rooms, occupancy status, and housekeeping.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <button className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold rounded-xl border border-gray-200 text-sm transition-colors">
                        <Plus size={16} /> Add Room Type
                    </button>
                    <button className="flex items-center gap-2 px-5 py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-[#ff5a00]/10 hover:scale-[1.01]">
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
                        {roomTypes.map(t => (
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
                        const typeName = (room.room_types as any)?.name || 'Standard'
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
            {selectedRoom && (
                <div className="fixed bottom-6 right-6 z-40 bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in slide-in-from-bottom duration-300">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h4 className="text-lg font-black text-gray-900">Room {selectedRoom.room_number}</h4>
                            <p className="text-xs text-gray-500 font-semibold uppercase">{(selectedRoom.room_types as any)?.name || 'Standard'}</p>
                        </div>
                        <button 
                            onClick={() => setSelectedRoom(null)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="space-y-3">
                        <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-1.5">Change Status</p>
                        
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => handleStatusChange(selectedRoom.id, 'available')}
                                className="flex items-center gap-2 p-2.5 border border-gray-100 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-100 rounded-xl text-xs font-bold transition-all text-gray-600 bg-gray-50/50"
                            >
                                <CheckCircle2 size={14} className="text-emerald-500" /> Make Available
                            </button>
                            <button 
                                onClick={() => handleStatusChange(selectedRoom.id, 'occupied')}
                                className="flex items-center gap-2 p-2.5 border border-gray-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-100 rounded-xl text-xs font-bold transition-all text-gray-600 bg-gray-50/50"
                            >
                                <Bed size={14} className="text-blue-500" /> Check In / Occupy
                            </button>
                            <button 
                                onClick={() => handleStatusChange(selectedRoom.id, 'dirty')}
                                className="flex items-center gap-2 p-2.5 border border-gray-100 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-100 rounded-xl text-xs font-bold transition-all text-gray-600 bg-gray-50/50"
                            >
                                <Brush size={14} className="text-amber-500" /> Set Dirty
                            </button>
                            <button 
                                onClick={() => handleStatusChange(selectedRoom.id, 'maintenance')}
                                className="flex items-center gap-2 p-2.5 border border-gray-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-100 rounded-xl text-xs font-bold transition-all text-gray-600 bg-gray-50/50"
                            >
                                <Wrench size={14} className="text-rose-500" /> Maintenance
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
