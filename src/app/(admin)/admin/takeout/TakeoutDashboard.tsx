'use client'

import { useState, useRef } from 'react'
import useSWR from 'swr'
import { useVirtualizer } from '@tanstack/react-virtual'
import { updateTakeoutStatusAction } from './actions'
import { Clock, Phone, User, CheckCircle, XCircle, Search, QrCode, Download, ExternalLink } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import toast from 'react-hot-toast'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import type { TakeoutOrder } from '@/types/database'
import Image from 'next/image'
import { fetchTakeoutOrders } from '@/lib/swr-fetchers'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'

const STATUS_COLORS: Record<string, string> = {
    placed: 'bg-amber-50 text-amber-700 border-amber-200',
    confirmed: 'bg-brand-50 text-brand-700 border-brand-200',
    preparing: 'bg-purple-50 text-purple-700 border-purple-200',
    ready_for_pickup: 'bg-success-bg/30 text-success-fg border-success-bg',
    picked_up: 'bg-surface-muted text-ink-subtle border-hairline',
    cancelled: 'bg-danger-bg/30 text-danger-fg border-danger-bg',
}

const NEXT_STATUS: Record<string, string> = {
    placed: 'confirmed',
    confirmed: 'preparing',
    preparing: 'ready_for_pickup',
    ready_for_pickup: 'picked_up',
}

export default function TakeoutDashboard({ initialOrders, restaurantId, restaurantSlug, restaurantName }: {
    initialOrders: TakeoutOrder[]
    restaurantId: string
    restaurantSlug: string
    restaurantName: string
}) {
    const { confirm } = useConfirmStore()
    const { data: orders = initialOrders, mutate } = useSWR(['takeout_orders', restaurantId], () => fetchTakeoutOrders(restaurantId), { fallbackData: initialOrders, refreshInterval: 15000 })
    const money = useCurrency()
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [showQr, setShowQr] = useState(false)

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    const takeoutUrl = restaurantSlug ? `${baseUrl}/takeout/${restaurantSlug}` : ''

    const downloadSvg = () => {
        // Find the QR code SVG inside the card
        const svgElement = document.getElementById('takeout-qr-code')
        if (!svgElement) return
        
        // We only download the QR code itself as SVG, since rendering the full HTML card to SVG is complex.
        // We could also do a high-res PNG canvas export like in TableManager if needed.
        const svgString = new XMLSerializer().serializeToString(svgElement)
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        const svgUrl = URL.createObjectURL(svgBlob)
        const downloadLink = document.createElement('a')
        downloadLink.href = svgUrl
        downloadLink.download = `${restaurantSlug || 'restaurant'}-takeout-qr.svg`
        document.body.appendChild(downloadLink)
        downloadLink.click()
        document.body.removeChild(downloadLink)
        setTimeout(() => URL.revokeObjectURL(svgUrl), 100)
    }

    const filteredOrders = orders.filter(o => {
        const matchesSearch = o.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              o.customer_phone?.includes(searchQuery) ||
                              o.id.includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all' || o.status === statusFilter
        return matchesSearch && matchesStatus
    })

    const parentRef = useRef<HTMLDivElement>(null)
    const virtualizer = useVirtualizer({
        count: filteredOrders.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 220,
        overscan: 5,
    })

    async function advance(order: TakeoutOrder) {
        const next = NEXT_STATUS[order.status]
        if (!next) return
        const result = await updateTakeoutStatusAction(order.id, next)
        if (result.error) { toast.error(result.error); return }
        mutate()
        toast.success(`Order → ${next.replace('_', ' ')}`)
    }

    async function cancel(order: TakeoutOrder) {
        const ok = await confirm({ title: 'Cancel this takeout order?', message: 'This action cannot be undone.', confirmText: 'Cancel', isDestructive: true })
        if (!ok) return
        const result = await updateTakeoutStatusAction(order.id, 'cancelled')
        if (result.error) { toast.error(result.error); return }
        mutate()
        toast.success('Order cancelled')
    }

    return (
        <div className="space-y-6">
            {/* Takeout & Delivery QR Section */}
            {restaurantSlug && (
                <div className="bg-surface rounded-card border border-hairline p-6 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-1.5">
                            <h2 className="text-h3 font-bold text-ink flex items-center gap-2">
                                <QrCode size={20} className="text-ink-subtle" />
                                Takeout & Delivery Ordering QR Code
                            </h2>
                            <p className="text-sm font-medium text-ink-subtle/80">
                                Share this link or print the QR code for customers to place pickup and delivery orders.
                            </p>
                            {takeoutUrl && (
                                <div className="pt-2">
                                    <a 
                                        href={takeoutUrl} 
                                        target="_blank" 
                                        rel="noreferrer" 
                                        className="text-[11px] font-bold text-brand-600 hover:text-brand-700 tracking-wide inline-flex items-center gap-1.5 bg-brand-50 border border-brand-100 px-3 py-1.5 rounded-full transition-colors"
                                    >
                                        {takeoutUrl}
                                        <ExternalLink size={12} />
                                    </a>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={() => setShowQr(!showQr)}
                            className="sm:self-center bg-surface border border-hairline hover:bg-surface-muted text-ink text-sm font-bold px-5 py-2.5 rounded-[var(--r-md)] flex items-center justify-center gap-2 transition-all shadow-sm focus-ring"
                        >
                            <QrCode size={16} />
                            {showQr ? 'Hide QR Code' : 'Show QR Code'}
                        </button>
                    </div>

                    {showQr && (
                        <div className="mt-6 pt-6 border-t border-hairline flex flex-col items-center justify-center animate-in fade-in slide-in-from-top-2 duration-300">
                            {/* The Card Preview Container */}
                            <div id="takeout-qr-card-preview" className="w-[280px] h-[340px] bg-surface rounded-xl border border-hairline-strong shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col items-center p-4 pb-12 relative overflow-hidden select-none">
                                
                                {/* Top Banner */}
                                <div className="w-full flex items-center justify-center relative my-2 shrink-0">
                                    <div className="absolute left-0 right-0 h-[3px] bg-[#ff7a00]" />
                                    <div className="bg-[#ff7a00] text-white text-[12px] font-black px-5 py-2 rounded-sm uppercase tracking-wider relative z-10 text-center shadow-sm">
                                        TAKEOUT & DELIVERY
                                    </div>
                                </div>

                                {/* QR Code */}
                                <div className="my-2 shrink-0 bg-surface">
                                    <QRCodeSVG
                                        id="takeout-qr-code"
                                        value={takeoutUrl}
                                        size={140}
                                        level="H"
                                        includeMargin={false}
                                        fgColor="#000000"
                                        bgColor="#ffffff"
                                        imageSettings={{
                                            src: '/icons/kkkhane.png',
                                            height: 32,
                                            width: 32,
                                            excavate: true,
                                        }}
                                    />
                                </div>

                                {/* Hotel / Restaurant Name */}
                                <div className="text-center flex-1 flex flex-col justify-center pb-1 min-h-[50px] px-2 overflow-hidden shrink-0 mt-1">
                                    <p className="font-extrabold text-[15px] text-ink truncate max-w-[240px] leading-tight" title={restaurantName}>
                                        {restaurantName}
                                    </p>
                                </div>

                                {/* Bottom Banner */}
                                <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#ff7a00] flex items-center justify-center gap-2 shrink-0 shadow-[0_-2px_10px_rgba(255,122,0,0.3)]">
                                    <span 
                                        className="text-white text-[11px] font-extrabold tracking-widest uppercase" 
                                        style={{ fontFamily: 'var(--font-outfit), var(--font-inter), system-ui, sans-serif' }}
                                    >
                                        Powered by KKKhane
                                    </span>
                                    <div className="relative w-5 h-5 rounded-full border-[1.5px] border-white shrink-0 shadow-sm overflow-hidden bg-surface">
                                        <Image
                                            src="/icons/kkkhane.png"
                                            alt="Logo"
                                            fill
                                            sizes="20px"
                                            className="object-cover"
                                        />
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={downloadSvg}
                                className="mt-5 flex items-center gap-2 text-xs font-bold text-ink-subtle bg-surface border border-hairline hover:text-ink hover:bg-surface-muted px-4 py-2 rounded-full transition-all focus-ring shadow-sm"
                            >
                                <Download size={14} />
                                Download QR Vector (SVG)
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 bg-surface p-4 rounded-card border border-hairline shadow-sm">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                        type="text"
                        placeholder="Search by name, phone or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-[var(--r-md)] border border-hairline text-sm bg-surface text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                    />
                </div>
                <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 w-full sm:w-48 capitalize shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                >
                    <option value="all">All Statuses</option>
                    {Object.keys(STATUS_COLORS).map(s => (
                        <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                    ))}
                </Select>
            </div>

            <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto pr-2" ref={parentRef} style={{ scrollbarWidth: 'thin' }}>
                {filteredOrders.length === 0 && (
                    <div className="bg-surface rounded-card border border-hairline p-10 text-center text-ink-subtle font-bold shadow-sm">
                        No active takeout orders.
                    </div>
                )}
                
                {filteredOrders.length > 0 && (
                    <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const order = filteredOrders[virtualRow.index]
                            return (
                                <div
                                    key={order.id}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <div className="bg-surface rounded-card border border-hairline p-5 shadow-sm transition-all hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] mb-4">
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div>
                                                <div className="flex items-center gap-3 mb-1.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <User size={16} className="text-ink-subtle" />
                                                        <span className="font-extrabold text-ink text-base">{order.customer_name}</span>
                                                    </div>
                                                    <span className={`text-[10px] font-bold tracking-wide uppercase px-2.5 py-1 rounded-full border ${STATUS_COLORS[order.status] || ''}`}>
                                                        {order.status.replace('_', ' ')}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium text-ink-subtle">
                                                    <span className="flex items-center gap-1.5"><Phone size={14} className="opacity-70" />{order.customer_phone}</span>
                                                    <span className="flex items-center gap-1.5"><Clock size={14} className="opacity-70" />Pickup: <span className="tabular-nums font-bold text-ink">{new Date(order.pickup_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-h3 font-extrabold text-ink tabular-nums leading-tight">{money(order.total_amount)}</p>
                                                <p className="text-[11px] font-medium font-mono text-ink-subtle mt-0.5">#{order.id.slice(0, 8).toUpperCase()}</p>
                                            </div>
                                        </div>
                    
                                        {/* Items */}
                    <div className="bg-surface-muted/30 border border-hairline rounded-[var(--r-md)] p-4 mb-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                        <ul className="space-y-2 text-sm text-ink font-medium">
                            {order.items.map((item: any, i: number) => (
                                <li key={i} className="flex justify-between items-center group">
                                    <span className="flex items-center gap-2">
                                        <span className="font-bold text-ink-subtle tabular-nums bg-surface border border-hairline w-6 h-6 rounded-full flex items-center justify-center text-[10px] shadow-sm">{item.quantity}</span> 
                                        <span>{item.name}</span>
                                    </span>
                                    <span className="text-ink-subtle tabular-nums group-hover:text-ink transition-colors">{money(item.price * item.quantity)}</span>
                                </li>
                            ))}
                        </ul>
                        {order.customer_note && (
                            <p className="mt-4 pt-3 border-t border-hairline text-[13px] text-ink-subtle font-medium italic flex items-start gap-2">
                                <span className="text-brand-500 font-bold not-italic">Note:</span> {order.customer_note}
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 justify-end border-t border-hairline pt-4">
                        {order.status !== 'cancelled' && order.status !== 'picked_up' && (
                            <button onClick={() => cancel(order)}
                                className="flex items-center gap-1.5 text-danger-fg text-sm font-bold px-4 py-2 rounded-[var(--r-md)] border border-danger-bg hover:bg-danger-bg/20 transition-all focus-ring">
                                <XCircle size={16} /> Cancel
                            </button>
                        )}
                        {NEXT_STATUS[order.status] && (
                            <button onClick={() => advance(order)}
                                className="flex items-center gap-1.5 bg-brand-500 text-white text-sm font-bold px-5 py-2 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                                <CheckCircle size={16} /> Mark {NEXT_STATUS[order.status].replace('_', ' ')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
