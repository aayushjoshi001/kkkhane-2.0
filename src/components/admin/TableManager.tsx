'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { QrCode, Plus, Edit2, Trash2, Check, X, Loader2, Download, Smartphone } from 'lucide-react'
import NextImage from 'next/image'
import type { Table } from '@/types/database'
import { QRCodeCanvas } from 'qrcode.react'
import Modal from '@/components/ui/Modal'
import { updateTableAction, deleteTableAction, addTableAction } from '@/app/(admin)/admin/tables/actions'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import { fetchTablesData } from '@/lib/swr-fetchers'
import { renderQrCardPng, downloadDataUrl } from '@/lib/qrCardCanvas'
import DownloadAllQrsButton from '@/components/admin/DownloadAllQrsButton'

// Brand colors for QR code customization
const QR_FG_COLOR = '#000000'   // black for QR code body to maximize scan readability
const QR_BG_COLOR = '#ffffff'
const QR_LOGO_SRC = '/icons/kkkhane.png'
const QR_LOGO_SIZE = 28  // px — centered inside the QR

export default function TableManager({
    initialTables,
    restaurantId,
    restaurantName,
    appUrl
}: {
    initialTables: Table[]
    restaurantId: string
    restaurantName: string
    appUrl: string
}) {
    const { data: tables = [], mutate } = useSWR(['tables', restaurantId], () => fetchTablesData(restaurantId), { fallbackData: initialTables })
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingTable, setEditingTable] = useState<Table | null>(null)
    const [formData, setFormData] = useState({ label: '', capacity: '' })
    const [isSubmitting, setIsSubmitting] = useState(false)

    // QR Preview State
    const [previewTable, setPreviewTable] = useState<Table | null>(null)
    const [iframeLoaded, setIframeLoaded] = useState(false)
    const { confirm } = useConfirmStore()

    // Use the actual browser origin so QR codes encode the live URL, not localhost
    const [baseUrl, setBaseUrl] = useState(appUrl)
    // eslint-disable-next-line
    useEffect(() => { setBaseUrl(window.location.origin) }, [])

    const openPreview = useCallback((table: Table) => {
        setIframeLoaded(false)
        setPreviewTable(table)
    }, [])

    const closePreview = useCallback(() => {
        setPreviewTable(null)
        setIframeLoaded(false)
    }, [])

    const openModal = (table?: Table) => {
        if (table) {
            setEditingTable(table)
            setFormData({ label: table.label, capacity: table.capacity?.toString() || '' })
        } else {
            setEditingTable(null)
            // Auto-suggest next table number
            const nextNum = tables.length > 0
                ? Math.max(...tables.map(t => parseInt(t.label.replace(/\D/g, '') || '0'))) + 1
                : 1
            setFormData({ label: `Table ${nextNum}`, capacity: '4' })
        }
        setIsModalOpen(true)
    }

    const saveTable = async () => {
        if (!formData.label) return
        setIsSubmitting(true)

        const capacityNum = formData.capacity ? parseInt(formData.capacity) : undefined

        // Wrap the server-action calls: a transient network failure rejects the
        // promise with "Failed to fetch" (or "Failed to fetch..."). Without this
        // it surfaced as an unhandled rejection with the modal stuck open and the
        // spinner never resetting. Catch it, show a retriable toast, and always
        // clear the submitting state in finally.
        try {
            if (editingTable) {
                const res = await updateTableAction(editingTable.id, {
                    label: formData.label,
                    capacity: capacityNum
                })
                if (res.success) {
                    mutate()
                    toast.success('Table updated')
                    setIsModalOpen(false)
                } else {
                    toast.error(res.error || 'Failed to update table')
                }
            } else {
                const res = await addTableAction(restaurantId, formData.label, capacityNum)
                if (res.data) {
                    mutate()
                    toast.success('Table added')
                    setIsModalOpen(false)
                } else {
                    toast.error(res.error || 'Failed to add table')
                }
            }
        } catch {
            toast.error('Network error — please check your connection and try again.')
        } finally {
            setIsSubmitting(false)
        }
    }

    const deleteTable = async (id: string, label: string) => {
        const isOk = await confirm({
            title: `Delete ${label}?`,
            message: 'Are you sure you want to delete this table? The QR code will no longer work.',
            confirmText: 'Delete',
            isDestructive: true
        })
        if (!isOk) return

        const res = await deleteTableAction(id)
        if (res.success) {
            mutate()
            toast.success('Table deleted')
        } else {
            toast.error(res.error || 'Failed to delete table')
        }
    }

    const qrCanvasRefs = useRef<Map<string, HTMLDivElement>>(new Map())
    const [qrToDownload, setQrToDownload] = useState<{ url: string; label: string } | null>(null)

    const downloadQR = (table: Table) => {
        const menuUrl = `${baseUrl}/t/${table.qr_token}`
        setQrToDownload({ url: menuUrl, label: table.label })
    }

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
        }

        runDownload()

        return () => {
            active = false
        }
    }, [qrToDownload, baseUrl, restaurantName])

    return (
        <div className="bg-surface rounded-card shadow-sm border border-hairline overflow-hidden">
            <div className="p-6 border-b border-hairline flex justify-between items-center gap-3 bg-surface-muted/30">
                <h3 className="text-h3 font-extrabold text-ink">Restaurant Layout ({tables.length})</h3>
                <div className="flex items-center gap-3 shrink-0">
                    <DownloadAllQrsButton className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--r-md)] text-sm font-bold bg-surface border border-hairline-strong text-ink-muted hover:bg-surface-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed" />
                    <button
                        onClick={() => openModal()}
                        className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] focus-ring"
                    >
                        <Plus size={16} /> Add Table
                    </button>
                </div>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {tables.map(table => {
                        const menuUrl = `${baseUrl}/t/${table.qr_token}`

                        return (
                            <div 
                                key={table.id} 
                                className="border border-hairline rounded-card overflow-hidden hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all group flex flex-col bg-surface shadow-sm"
                            >
                                <div className="p-5 border-b border-hairline flex justify-between items-center bg-surface-muted/30">
                                    <div>
                                        <h4 className="font-extrabold text-ink text-base">{table.label}</h4>
                                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1">Seats: {table.capacity || 'N/A'}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => openModal(table)} className="p-2 text-ink-subtle hover:text-brand-600 rounded-full hover:bg-brand-50 transition-colors focus-ring">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => deleteTable(table.id, table.label)} className="p-2 text-ink-subtle hover:text-danger-fg rounded-full hover:bg-danger-bg/20 transition-colors focus-ring">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div className="p-6 flex flex-col items-center justify-center flex-1 bg-surface-muted/30">
                                    {/* The Card Preview Container */}
                                    <div className="w-[220px] h-[260px] bg-surface rounded-xl border border-hairline-strong shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col items-center p-3 pb-9 relative overflow-hidden mb-5 select-none">
                                        
                                        {/* Top Banner */}
                                        <div className="w-full flex items-center justify-center relative my-1.5 shrink-0">
                                            <div className="absolute left-0 right-0 h-[3px] bg-[#ff7a00]" />
                                            <div className="bg-[#ff7a00] text-white text-[10px] font-black px-4 py-1.5 rounded-sm uppercase tracking-wider relative z-10 min-w-[100px] text-center shadow-sm">
                                                {table.label}
                                            </div>
                                        </div>

                                        {/* QR Code */}
                                        <div
                                            ref={el => { if (el) qrCanvasRefs.current.set(table.id, el) }}
                                            className="my-1 shrink-0 bg-surface"
                                        >
                                            <QRCodeCanvas
                                                value={menuUrl}
                                                size={105}
                                                level="H"
                                                includeMargin={false}
                                                fgColor="#000000"
                                                bgColor="#ffffff"
                                                imageSettings={{
                                                    src: QR_LOGO_SRC,
                                                    height: 28,
                                                    width: 28,
                                                    excavate: true,
                                                }}
                                            />
                                        </div>

                                        {/* Hotel / Restaurant Name */}
                                        <div className="text-center flex-1 flex flex-col justify-center pb-1 min-h-[40px] px-1 overflow-hidden shrink-0 mt-0.5">
                                            <p className="font-extrabold text-[12px] text-ink truncate max-w-[190px] leading-tight" title={restaurantName}>
                                                {restaurantName}
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
                                            <div className="relative w-4 h-4 rounded-full border-[1.5px] border-white shrink-0 shadow-sm overflow-hidden bg-surface">
                                                <NextImage
                                                    src={QR_LOGO_SRC}
                                                    alt="Logo"
                                                    fill
                                                    sizes="16px"
                                                    className="object-cover"
                                                />
                                            </div>
                                        </div>

                                    </div>

                                    <div className="flex gap-3 w-full">
                                        <button
                                            onClick={() => openPreview(table)}
                                            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-ink bg-surface rounded-[var(--r-md)] border border-hairline hover:bg-surface-muted active:scale-95 transition-all shadow-sm focus-ring"
                                        >
                                            <Smartphone size={16} className="text-ink-subtle" /> Preview
                                        </button>
                                        <button
                                            onClick={() => downloadQR(table)}
                                            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-brand-500 rounded-[var(--r-md)] hover:opacity-90 active:scale-95 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] focus-ring"
                                        >
                                            <Download size={16} /> Download
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {tables.length === 0 && (
                    <div className="text-center py-16">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-surface-muted border border-hairline text-ink-subtle mb-6 shadow-sm">
                            <QrCode size={40} />
                        </div>
                        <h3 className="text-h2 font-extrabold text-ink mb-2">No tables yet</h3>
                        <p className="text-ink-subtle font-medium mb-8">Add tables to generate QR codes for ordering.</p>
                        <button
                            onClick={() => openModal()}
                            className="inline-flex items-center gap-2 bg-brand-500 text-white px-6 py-3 rounded-[var(--r-md)] font-bold hover:-translate-y-0.5 active:translate-y-0 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] focus-ring"
                        >
                            <Plus size={20} /> Create First Table
                        </button>
                    </div>
                )}
            </div>

            {/* Table Modal */}
            {isModalOpen && (
                <Modal open onClose={() => setIsModalOpen(false)} size="sm" ariaLabel={editingTable ? 'Edit Table' : 'Add Table'}>
                        <div className="px-6 py-5 border-b border-hairline flex justify-between items-center bg-surface-muted/30">
                            <h3 className="text-h3 font-extrabold text-ink">{editingTable ? 'Edit Table' : 'Add Table'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-ink-subtle hover:text-ink transition-colors p-1 rounded-full hover:bg-surface-muted focus-ring">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Table Label / Number *</label>
                                <input
                                    type="text"
                                    value={formData.label}
                                    onChange={e => setFormData({ ...formData, label: e.target.value })}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-ink px-4 py-2.5 text-sm font-bold shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 outline-none transition-all"
                                    placeholder="e.g. Table 1, Patio A"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Seat Capacity (Optional)</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={formData.capacity}
                                    onChange={e => { const v = e.target.value; if (/^\d*$/.test(v)) setFormData({ ...formData, capacity: v }) }}
                                    className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-ink px-4 py-2.5 text-sm font-bold shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 outline-none transition-all tabular-nums"
                                    placeholder="e.g. 4"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button onClick={() => setIsModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring">
                                Cancel
                            </button>
                            <button disabled={!formData.label || isSubmitting} onClick={saveTable} className="px-6 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 flex items-center gap-2 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] focus-ring">
                                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save
                            </button>
                        </div>
                </Modal>
            )}

            {/* URL/Phone Preview Modal - ALWAYS RENDERED but conditionally visible for instant iframe swapping */}
            <div 
                className={`fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${previewTable ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
                onClick={closePreview}
            >
                {/* Close button — always visible, top-right of viewport */}
                <button
                    onClick={closePreview}
                    className="absolute top-3 right-3 sm:top-5 sm:right-5 z-[70] w-10 h-10 bg-surface/15 hover:bg-surface/25 rounded-full flex items-center justify-center text-white transition-colors"
                    aria-label="Close preview"
                >
                    <X size={20} />
                </button>

                {/* Table label */}
                <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-[70] text-white text-sm font-semibold bg-surface/10 px-4 py-1.5 rounded-full backdrop-blur-sm transition-transform duration-300 ${previewTable ? 'translate-y-0' : '-translate-y-10'}`}>
                    {previewTable?.label || 'Preview'} — Customer View
                </div>

                {/* Phone frame — responsive sizing */}
                <div
                    className={`relative w-[280px] h-[560px] sm:w-[320px] sm:h-[640px] mt-10 transition-transform duration-300 ${previewTable ? 'scale-100 translate-y-0' : 'scale-95 translate-y-8'}`}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Phone bezel */}
                    <div className="absolute inset-0 bg-ink rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl border border-gray-700">
                        {/* Notch */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 sm:w-32 h-5 sm:h-6 bg-ink rounded-b-xl z-20" />
                    </div>

                    {/* Screen */}
                    <div className="absolute inset-2 sm:inset-3 top-3 sm:top-4 rounded-[1.25rem] sm:rounded-[1.5rem] overflow-hidden bg-surface-muted flex flex-col">
                        {/* Browser chrome */}
                        <div className="bg-surface-muted px-3 sm:px-4 pb-1.5 sm:pb-2 pt-6 sm:pt-7 border-b border-hairline-strong shrink-0 flex items-center gap-2">
                            <div className="w-4 h-4 text-ink-subtle"><Smartphone size={14} /></div>
                            <div className="flex-1 min-w-0 bg-surface-muted/80 rounded-lg text-[9px] sm:text-[10px] text-center text-ink-subtle py-1 sm:py-1.5 px-2 truncate font-mono">
                                {baseUrl.replace(/https?:\/\//, '')}/t/{previewTable?.qr_token?.substring(0, 8) || '...'}…
                            </div>
                        </div>

                        {/* Loading state / Skeleton UI */}
                        {!iframeLoaded && previewTable && (
                            <div className="absolute inset-0 top-[60px] bg-surface-muted z-0 overflow-hidden flex flex-col pointer-events-none">
                                {/* Skeleton Header (matches customer UI) */}
                                <div className="relative bg-brand-500 text-white rounded-b-[36px] pb-6 pt-2 h-[120px] shadow-md flex flex-col shrink-0 overflow-hidden">
                                    <div className="absolute inset-x-0 bottom-0 top-[48px] rounded-b-[36px] bg-black/20" />
                                    <div className="w-full px-4 flex items-center justify-between gap-3 h-10 mt-2 relative z-10">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-surface/25 animate-pulse" />
                                            <div className="flex flex-col gap-1.5">
                                                <div className="w-10 h-2 bg-surface/20 rounded animate-pulse" />
                                                <div className="w-24 h-3 bg-surface/30 rounded animate-pulse" />
                                            </div>
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-surface/20 animate-pulse" />
                                    </div>
                                    <div className="mt-8 px-4 flex justify-between items-center relative z-10">
                                        <div className="flex gap-2">
                                            <div className="w-16 h-6 bg-surface/20 rounded-full animate-pulse" />
                                            <div className="w-16 h-6 bg-surface/20 rounded-full animate-pulse" />
                                        </div>
                                    </div>
                                </div>
                                {/* Skeleton Content */}
                                <div className="flex-1 p-4 space-y-4">
                                    {/* Search Bar Skeleton */}
                                    <div className="w-full h-11 bg-surface rounded-xl shadow-sm border border-hairline flex items-center px-4 animate-pulse">
                                        <div className="w-4 h-4 bg-surface-muted rounded-full" />
                                        <div className="ml-3 w-32 h-3 bg-surface-muted rounded" />
                                    </div>
                                    {/* Categories Skeleton */}
                                    <div className="flex gap-3 mt-4 overflow-hidden">
                                        <div className="w-16 h-20 bg-surface rounded-xl shadow-sm animate-pulse shrink-0" />
                                        <div className="w-16 h-20 bg-surface rounded-xl shadow-sm animate-pulse shrink-0" />
                                        <div className="w-16 h-20 bg-surface rounded-xl shadow-sm animate-pulse shrink-0" />
                                        <div className="w-16 h-20 bg-surface rounded-xl shadow-sm animate-pulse shrink-0" />
                                    </div>
                                    {/* Menu Items Skeleton */}
                                    <div className="mt-6 space-y-3">
                                        <div className="w-24 h-4 bg-surface-muted rounded animate-pulse mb-4" />
                                        <div className="w-full h-[104px] bg-surface rounded-xl shadow-sm flex items-center p-3 animate-pulse">
                                            <div className="flex-1 space-y-2.5">
                                                <div className="w-3/4 h-3.5 bg-surface-muted rounded" />
                                                <div className="w-1/2 h-2.5 bg-surface-muted rounded" />
                                                <div className="w-16 h-4 bg-surface-muted rounded mt-3" />
                                            </div>
                                            <div className="w-[80px] h-[80px] bg-surface-muted rounded-lg ml-3" />
                                        </div>
                                        <div className="w-full h-[104px] bg-surface rounded-xl shadow-sm flex items-center p-3 animate-pulse">
                                            <div className="flex-1 space-y-2.5">
                                                <div className="w-2/3 h-3.5 bg-surface-muted rounded" />
                                                <div className="w-1/3 h-2.5 bg-surface-muted rounded" />
                                                <div className="w-16 h-4 bg-surface-muted rounded mt-3" />
                                            </div>
                                            <div className="w-[80px] h-[80px] bg-surface-muted rounded-lg ml-3" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Iframe for active preview only */}
                        <div className="flex-1 relative bg-surface z-10">
                            {previewTable?.qr_token && (
                                <iframe
                                    key={previewTable.qr_token}
                                    src={`/t/${previewTable.qr_token}`}
                                    className="absolute inset-0 w-full h-full border-none bg-surface z-10 pointer-events-auto"
                                    title="Customer menu preview"
                                    onLoad={() => setIframeLoaded(true)}
                                    loading="eager"
                                />
                            )}
                        </div>
                    </div>

                    {/* Home indicator bar */}
                    <div className="absolute bottom-1.5 sm:bottom-2 left-1/2 -translate-x-1/2 w-24 sm:w-28 h-1 bg-gray-600 rounded-full" />
                </div>
            </div>

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
                            src: QR_LOGO_SRC,
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
