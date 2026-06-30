'use client'

import { useState } from 'react'
import { updateTakeoutStatusAction } from './actions'
import { Clock, Phone, User, CheckCircle, XCircle, Search, QrCode, Download, ExternalLink } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder } from '@/types/database'

const STATUS_COLORS: Record<string, string> = {
    placed: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    preparing: 'bg-purple-100 text-purple-800',
    ready_for_pickup: 'bg-green-100 text-green-800',
    picked_up: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
}

const NEXT_STATUS: Record<string, string> = {
    placed: 'confirmed',
    confirmed: 'preparing',
    preparing: 'ready_for_pickup',
    ready_for_pickup: 'picked_up',
}

export default function TakeoutDashboard({ initialOrders, restaurantSlug, restaurantName }: {
    initialOrders: TakeoutOrder[]
    restaurantId: string
    restaurantSlug: string
    restaurantName: string
}) {
    const [orders, setOrders] = useState(initialOrders)
    const money = useCurrency()
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [showQr, setShowQr] = useState(false)

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const takeoutUrl = restaurantSlug ? `${baseUrl}/takeout/${restaurantSlug}` : ''

    const downloadSvg = () => {
        const svgElement = document.getElementById('takeout-qr-code')
        if (!svgElement) return
        const svgString = new XMLSerializer().serializeToString(svgElement)
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        const svgUrl = URL.createObjectURL(svgBlob)
        const downloadLink = document.createElement('a')
        downloadLink.href = svgUrl
        downloadLink.download = `${restaurantSlug || 'restaurant'}-takeout-qr.svg`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)
    }

    const filteredOrders = orders.filter(o => {
        const matchesSearch = o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              o.customer_phone?.includes(searchQuery) ||
                              o.id.includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all' || o.status === statusFilter
        return matchesSearch && matchesStatus
    })

    async function advance(order: TakeoutOrder) {
        const next = NEXT_STATUS[order.status]
        if (!next) return
        const result = await updateTakeoutStatusAction(order.id, next)
        if (result.error) { toast.error(result.error); return }
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: next as TakeoutOrder['status'] } : o)
            .filter(o => o.status !== 'picked_up'))
        toast.success(`Order → ${next.replace('_', ' ')}`)
    }

    async function cancel(order: TakeoutOrder) {
        if (!confirm('Cancel this takeout order?')) return
        const result = await updateTakeoutStatusAction(order.id, 'cancelled')
        if (result.error) { toast.error(result.error); return }
        setOrders(prev => prev.filter(o => o.id !== order.id))
        toast.success('Order cancelled')
    }

    return (
        <div className="space-y-6">
            {/* Takeout & Delivery QR Section */}
            {restaurantSlug && (
                <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-1">
                            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                <QrCode size={18} className="text-gray-900" />
                                Takeout & Delivery Ordering QR Code
                            </h2>
                            <p className="text-sm text-gray-500">
                                Share this link or print the QR code for customers to place pickup and delivery orders.
                            </p>
                            {takeoutUrl && (
                                <div className="pt-1">
                                    <a 
                                        href={takeoutUrl} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-1 bg-blue-50 px-2.5 py-1 rounded-md"
                                    >
                                        {takeoutUrl}
                                        <ExternalLink size={12} />
                                    </a>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => setShowQr(!showQr)}
                            className="sm:self-center bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                            <QrCode size={16} />
                            {showQr ? 'Hide QR Code' : 'Show QR Code'}
                        </button>
                    </div>

                    {showQr && (
                        <div className="mt-5 pt-5 border-t border-gray-100 flex flex-col items-center justify-center">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-center">
                                <QRCodeSVG
                                    id="takeout-qr-code"
                                    value={takeoutUrl}
                                    size={200}
                                    level="H"
                                    includeMargin={true}
                                />
                            </div>
                            <button
                                onClick={downloadSvg}
                                className="mt-4 flex items-center gap-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-3.5 py-2 rounded-lg transition-colors cursor-pointer"
                            >
                                <Download size={14} />
                                Download QR Vector (SVG)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by name, phone or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 w-full sm:w-48 capitalize"
                >
                    <option value="all">All Statuses</option>
                    {Object.keys(STATUS_COLORS).map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                </select>
            </div>

            <div className="space-y-3">
                {filteredOrders.length === 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
                        No active takeout orders.
                    </div>
                )}
            {filteredOrders.map(order => (
                <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <User size={14} className="text-gray-400" />
                                <span className="font-semibold text-gray-900">{order.customer_name}</span>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[order.status] || ''}`}>
                                    {order.status.replace('_', ' ')}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                <span className="flex items-center gap-1"><Phone size={12} />{order.customer_phone}</span>
                                <span className="flex items-center gap-1"><Clock size={12} />Pickup: {new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="font-semibold text-gray-900">{money(order.total_amount)}</p>
                            <p className="text-xs text-gray-400">#{order.id.slice(0, 8)}</p>
                        </div>
                    </div>

                    {/* Items */}
                    <div className="bg-gray-50 rounded-lg p-3 mb-3">
                        <ul className="space-y-1 text-sm text-gray-700">
                            {order.items.map((item, i) => (
                                <li key={i} className="flex justify-between">
                                    <span>{item.quantity}× {item.name}</span>
                                    <span className="text-gray-500">{money(item.price * item.quantity)}</span>
                                </li>
                            ))}
                        </ul>
                        {order.customer_note && (
                            <p className="mt-2 text-xs text-gray-500 italic">Note: {order.customer_note}</p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 justify-end">
                        {order.status !== 'cancelled' && order.status !== 'picked_up' && (
                            <button onClick={() => cancel(order)}
                                className="flex items-center gap-1 text-red-600 hover:text-red-800 text-sm px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50">
                                <XCircle size={14} /> Cancel
                            </button>
                        )}
                        {NEXT_STATUS[order.status] && (
                            <button onClick={() => advance(order)}
                                className="flex items-center gap-1 bg-gray-900 text-white text-sm px-4 py-1.5 rounded-lg font-medium">
                                <CheckCircle size={14} /> Mark {NEXT_STATUS[order.status].replace('_', ' ')}
                            </button>
                        )}
                    </div>
                </div>
            ))}
            </div>
        </div>
    )
}
