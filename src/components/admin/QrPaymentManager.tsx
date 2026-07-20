'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { QrCode, Upload, Plus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { createQrCodeAction, updateQrCodeAction, deleteQrCodeAction } from '@/app/(admin)/admin/settings/actions'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'

export interface QrCodeEntry {
    id: string
    label: string
    image_url: string | null
    bank_account_id: string | null
    is_active: boolean
}

/**
 * Manages the restaurant's payment QR codes — a restaurant may run several
 * (e.g. one eSewa QR into Bank A, one Fonepay QR into Bank B), each entry
 * independently persisted (not tied to the main Settings "Save Changes")
 * so adding/removing one never risks unrelated form fields.
 */
export default function QrPaymentManager({
    restaurantId,
    initialQrCodes,
    bankAccounts,
    canEdit,
}: {
    restaurantId: string
    initialQrCodes: QrCodeEntry[]
    bankAccounts: { id: string; name: string }[]
    canEdit: boolean
}) {
    const { confirm } = useConfirmStore()
    const [qrCodes, setQrCodes] = useState<QrCodeEntry[]>(initialQrCodes)
    const [uploadingId, setUploadingId] = useState<string | null>(null)
    const [savingId, setSavingId] = useState<string | null>(null)
    const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

    const handleAdd = async () => {
        const res = await createQrCodeAction(restaurantId, { label: 'New QR Code', image_url: null, bank_account_id: null })
        if (res.error || !res.data) {
            toast.error(res.error || 'Failed to add QR code')
            return
        }
        setQrCodes(prev => [...prev, res.data as QrCodeEntry])
    }

    const handleUpdate = async (id: string, patch: Partial<QrCodeEntry>) => {
        setQrCodes(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q))
        setSavingId(id)
        const res = await updateQrCodeAction(id, restaurantId, patch)
        setSavingId(null)
        if (res.error) toast.error(res.error)
    }

    const handleDelete = async (id: string) => {
        const ok = await confirm({ title: 'Delete this QR code?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const prev = qrCodes
        setQrCodes(qrCodes.filter(q => q.id !== id))
        const res = await deleteQrCodeAction(id, restaurantId)
        if (res.error) {
            toast.error(res.error)
            setQrCodes(prev)
        } else {
            toast.success('QR code removed')
        }
    }

    const handleImageUpload = async (id: string, file: File) => {
        setUploadingId(id)
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', 'image')
        fd.append('folder', 'settings')
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Upload failed')
                return
            }
            await handleUpdate(id, { image_url: data.url })
            toast.success('QR uploaded')
        } catch {
            toast.error('Network error during upload')
        } finally {
            setUploadingId(null)
        }
    }

    return (
        <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden mt-6">
            <div className="p-5 border-b border-hairline bg-surface-muted/30 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                        <QrCode size={20} />
                    </div>
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink">QR Payment</h3>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-0.5">
                            Register each QR you use to receive payment, and which bank account it deposits into
                        </p>
                    </div>
                </div>
                {canEdit && (
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="flex items-center gap-1.5 px-3 py-2 bg-brand-50 hover:bg-brand-100 text-brand-600 font-bold text-xs rounded-[var(--r-md)] border border-brand-100 transition-colors shrink-0"
                    >
                        <Plus size={14} /> Add QR Code
                    </button>
                )}
            </div>

            <div className="p-6 space-y-4">
                {qrCodes.length === 0 && (
                    <p className="text-sm font-bold text-ink-subtle text-center py-6">
                        No QR codes registered yet. Add one so QR payments can be attributed to the right bank account.
                    </p>
                )}

                {qrCodes.map(qr => (
                    <div key={qr.id} className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr_auto] gap-4 items-start p-4 rounded-[var(--r-md)] border border-hairline bg-surface-muted/20">
                        <div className="shrink-0">
                            {qr.image_url ? (
                                <Image src={qr.image_url} alt={qr.label} width={64} height={64} className="h-16 w-16 object-contain bg-surface rounded-[var(--r-md)] p-1.5 border border-hairline" />
                            ) : (
                                <div className="h-16 w-16 flex items-center justify-center bg-surface rounded-[var(--r-md)] border border-dashed border-hairline text-ink-muted">
                                    <QrCode size={20} />
                                </div>
                            )}
                            {canEdit && (
                                <label className="mt-2 flex items-center justify-center gap-1 text-[10px] font-bold text-brand-600 cursor-pointer hover:underline">
                                    {uploadingId === qr.id ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                                    {uploadingId === qr.id ? 'Uploading' : 'Image'}
                                    <input
                                        ref={el => { fileInputRefs.current[qr.id] = el }}
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={(e) => { if (e.target.files?.[0]) handleImageUpload(qr.id, e.target.files[0]) }}
                                    />
                                </label>
                            )}
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Label</label>
                            <input
                                type="text"
                                value={qr.label}
                                disabled={!canEdit}
                                onChange={(e) => setQrCodes(prev => prev.map(q => q.id === qr.id ? { ...q, label: e.target.value } : q))}
                                onBlur={(e) => handleUpdate(qr.id, { label: e.target.value })}
                                placeholder="e.g. eSewa - NIC Asia"
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-2.5 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 disabled:opacity-50"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Deposits Into</label>
                            <Select
                                value={qr.bank_account_id || ''}
                                disabled={!canEdit}
                                onChange={(e) => handleUpdate(qr.id, { bank_account_id: e.target.value || null })}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-2.5 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 disabled:opacity-50"
                            >
                                <option value="">No bank account linked</option>
                                {bankAccounts.map(acc => (
                                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                                ))}
                            </Select>
                        </div>

                        {canEdit && (
                            <div className="flex items-center gap-2 md:pt-6">
                                {savingId === qr.id && <Loader2 size={14} className="animate-spin text-ink-subtle" />}
                                <button
                                    type="button"
                                    onClick={() => handleDelete(qr.id)}
                                    className="p-2 rounded-[var(--r-md)] text-danger-fg hover:bg-danger-fg/10 transition-colors"
                                    title="Remove QR code"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
