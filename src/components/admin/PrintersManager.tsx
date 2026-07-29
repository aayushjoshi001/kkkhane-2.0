'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Plus, Printer as PrinterIcon, Pencil, Trash2, Wifi, Usb } from 'lucide-react'
import PrinterFormModal from './PrinterFormModal'
import { deletePrinterAction } from '@/app/(admin)/admin/printers/actions'
import type { Printer } from '@/types/database'
import { useConfirmStore } from '@/lib/stores/confirm'

const ROLE_LABEL: Record<Printer['role'], string> = { kot: 'KOT', bot: 'BOT', bill: 'Bill' }

export default function PrintersManager({ initialPrinters }: { initialPrinters: Printer[] }) {
    const { confirm } = useConfirmStore()
    const router = useRouter()
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<Printer | null>(null)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const openAdd = () => { setEditing(null); setModalOpen(true) }
    const openEdit = (p: Printer) => { setEditing(p); setModalOpen(true) }

    const handleDelete = async (p: Printer) => {
        const ok = await confirm({ title: `Delete printer “${p.name}”?`, message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        setDeletingId(p.id)
        try {
            const res = await deletePrinterAction(p.id)
            if (res?.error) toast.error(res.error)
            else { toast.success('Printer removed'); router.refresh() }
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <div className="bg-surface border border-hairline rounded-3xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-hairline">
                <div>
                    <h2 className="text-base font-bold text-ink">KOT & Bill Printers</h2>
                    <p className="text-sm text-ink-subtle mt-0.5">Add a LAN printer by IP so orders auto-print without picking one on each screen.</p>
                </div>
                <button onClick={openAdd}
                    className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-xl bg-[var(--color-primary)] hover:opacity-90 transition-colors shadow-sm">
                    <Plus size={16} /> Add Printer
                </button>
            </div>

            {initialPrinters.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center px-6 py-16">
                    <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-muted text-ink-subtle mb-4">
                        <PrinterIcon size={26} />
                    </div>
                    <h3 className="text-sm font-bold text-ink">No printers configured</h3>
                    <p className="text-sm text-ink-subtle mt-1 max-w-sm">Add your kitchen’s network printer to auto-print KOTs over the LAN. QZ Tray must be running on a device on the same network.</p>
                    <button onClick={openAdd} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-xl bg-[var(--color-primary)] hover:opacity-90">
                        <Plus size={16} /> Add your first printer
                    </button>
                </div>
            ) : (
                <ul className="divide-y divide-hairline">
                    {initialPrinters.map((p) => (
                        <li key={p.id} className="flex items-center gap-4 px-6 py-4">
                            <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${p.is_active ? 'bg-blue-50 text-blue-600' : 'bg-surface-muted text-ink-subtle'}`}>
                                {p.printer_type === 'network' ? <Wifi size={18} /> : <Usb size={18} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-ink truncate max-w-full">{p.name}</span>
                                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-muted text-ink-subtle">{ROLE_LABEL[p.role]}</span>
                                    {p.is_default && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">Default</span>}
                                    {!p.is_active && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Inactive</span>}
                                </div>
                                <p className="text-xs text-ink-subtle mt-0.5 truncate">
                                    {p.printer_type === 'network'
                                        ? `${p.ip_address}:${p.port} · ${p.paper_width}${p.copies > 1 ? ` · ${p.copies} copies` : ''}`
                                        : `USB (per-device) · ${p.paper_width}`}
                                </p>
                            </div>
                            <button onClick={() => openEdit(p)} className="p-2 rounded-lg text-ink-subtle hover:bg-surface-muted transition-colors" aria-label="Edit printer">
                                <Pencil size={16} />
                            </button>
                            <button onClick={() => handleDelete(p)} disabled={deletingId === p.id}
                                className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50" aria-label="Delete printer">
                                <Trash2 size={16} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="px-6 py-4 bg-surface-muted border-t border-hairline">
                <p className="text-[11px] text-ink-subtle leading-relaxed">
                    <strong className="text-ink-muted">How it works:</strong> the app runs in the cloud and can’t reach a printer on your private network directly, so printing goes through <strong className="text-ink-muted">QZ Tray</strong> running on a device on the same LAN (your kitchen screen). Set the printer’s IP to a fixed address on your router, and make sure it accepts raw printing on port 9100.
                </p>
            </div>

            {modalOpen && (
                <PrinterFormModal
                    key={editing?.id ?? 'new'}
                    open
                    editing={editing}
                    onClose={() => setModalOpen(false)}
                    onSaved={() => router.refresh()}
                />
            )}
        </div>
    )
}
