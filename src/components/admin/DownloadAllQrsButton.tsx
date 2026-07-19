'use client'

import { useState } from 'react'
import { toast } from 'react-hot-toast'
import { Download, Loader2 } from 'lucide-react'
import { buildQrCardsPdf, type QrCardItem } from '@/lib/qrBulkPdf'

interface QrExportResponse {
    restaurant: { name: string; slug: string; logo_url: string | null } | null
    rooms: { id: string; room_number: string }[]
    tables: { label: string; qr_token: string }[]
    error?: string
}

// One button, usable from both the Rooms and Tables admin pages: pulls every
// active room + table for the restaurant and downloads them as a single
// multi-page PDF of branded QR cards.
export default function DownloadAllQrsButton({ className }: { className?: string }) {
    const [busy, setBusy] = useState(false)

    const handleClick = async () => {
        if (busy) return
        setBusy(true)
        const toastId = toast.loading('Preparing QR codes…')
        try {
            const res = await fetch('/api/qr-export', { cache: 'no-store' })
            const data: QrExportResponse = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load QR data')

            const origin = window.location.origin
            const slug = data.restaurant?.slug
            if (!slug) throw new Error('Restaurant not found')

            const items: QrCardItem[] = [
                ...data.rooms.map((r) => ({
                    label: `Room ${r.room_number}`,
                    url: `${origin}/r/${slug}?room=${encodeURIComponent(r.id)}`,
                })),
                ...data.tables.map((t) => ({
                    label: t.label,
                    url: `${origin}/t/${t.qr_token}`,
                })),
            ]

            if (!items.length) {
                toast.error('No active rooms or tables to export', { id: toastId })
                return
            }

            const count = await buildQrCardsPdf(items, {
                restaurantName: data.restaurant?.name || 'KKKhane',
                logoSrc: '/icons/kkkhane.png',
                fileName: `${(data.restaurant?.name || 'restaurant').replace(/\s+/g, '_')}_QR_codes.pdf`,
            })
            toast.success(`Downloaded ${count} QR code${count === 1 ? '' : 's'} as PDF`, { id: toastId })
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to generate PDF', { id: toastId })
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            onClick={handleClick}
            disabled={busy}
            title="Download every room & table QR as a printable PDF"
            className={className ?? 'inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-[var(--color-primary)] text-white hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm'}
        >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {busy ? 'Generating…' : 'Download all QRs (PDF)'}
        </button>
    )
}
