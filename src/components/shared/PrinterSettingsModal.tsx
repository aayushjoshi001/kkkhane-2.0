'use client'

import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Printer, RefreshCw, X } from 'lucide-react'
import { usePrinter, type PrinterRole } from '@/lib/print/usePrinter'
import { EscPosBuilder } from '@/lib/print/escpos'

const ROLE_COPY: Record<PrinterRole, { title: string; hint: string }> = {
    invoice: { title: 'Invoice Printer', hint: 'Used to print the bill automatically when a table or room is settled.' },
    kot: { title: 'Kitchen Ticket (KOT) Printer', hint: 'Used to print a ticket automatically the moment a new food order arrives.' },
    bot: { title: 'Bar Ticket (BOT) Printer', hint: 'Used to print a ticket automatically the moment a new drink order arrives.' },
}

function buildTestTicket(): Uint8Array {
    return new EscPosBuilder()
        .init()
        .align('center')
        .bold(true)
        .line('TEST PRINT')
        .bold(false)
        .line('If you can read this,')
        .line('this printer is connected.')
        .cut()
        .build()
}

export function PrinterSettingsModal({ role, open, onClose }: { role: PrinterRole; open: boolean; onClose: () => void }) {
    const { status, printers, refreshPrinters, print, selectedPrinter, selectPrinter } = usePrinter(role)
    const [testing, setTesting] = useState(false)
    const copy = ROLE_COPY[role]

    useEffect(() => {
        if (open) refreshPrinters()
    }, [open, refreshPrinters])

    if (!open) return null

    const statusLabel =
        status === 'connecting' ? 'Connecting…'
        : status === 'connected' ? 'Connected'
        : status === 'not-trusted' ? 'Blocked — allow this site in QZ Tray'
        : status === 'not-running' ? 'QZ Tray not running'
        : 'Not connected'

    const statusColor =
        status === 'connected' ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
        : status === 'connecting' ? 'text-ink-subtle bg-surface-muted border-hairline'
        : 'text-amber-700 bg-amber-50 border-amber-200'

    const handleTestPrint = async () => {
        setTesting(true)
        try {
            const res = await print(buildTestTicket())
            if (res.ok) {
                toast.success('Test ticket sent to the printer')
            } else if (res.status === 'no-printer-selected') {
                toast.error('Pick a printer first')
            } else if (res.status === 'not-running') {
                toast.error('QZ Tray isn’t running on this device')
            } else if (res.status === 'not-trusted') {
                toast.error('Blocked — allow this site in the QZ Tray prompt')
            } else {
                toast.error(res.error || 'Test print failed')
            }
        } finally {
            setTesting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-hairline">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600">
                            <Printer size={20} />
                        </div>
                        <div className="flex-1 mt-0.5">
                            <h3 className="text-lg font-semibold text-ink leading-tight">{copy.title}</h3>
                            <p className="mt-1 text-sm text-ink-subtle leading-relaxed">{copy.hint}</p>
                        </div>
                    </div>

                    <div className={`mt-4 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${statusColor}`}>
                        <span>{statusLabel}</span>
                        <button onClick={() => refreshPrinters()} className="p-1 rounded hover:bg-black/5 transition" aria-label="Refresh printers">
                            <RefreshCw size={13} />
                        </button>
                    </div>

                    <label className="block mt-4 text-xs font-semibold text-ink-subtle uppercase tracking-wide">Printer</label>
                    <select
                        value={selectedPrinter ?? ''}
                        onChange={(e) => selectPrinter(e.target.value || null)}
                        className="mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-hairline-strong bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                    >
                        <option value="">Select a printer…</option>
                        {printers.map((p) => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>

                    <p className="mt-2 text-[11px] text-ink-subtle">Remembered on this device only — set it once per till or kitchen screen.</p>
                </div>

                <div className="px-6 py-4 bg-surface-muted border-t border-hairline flex justify-end gap-3 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface border border-hairline-strong rounded-lg shadow-sm hover:bg-surface-muted transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]/50 flex items-center gap-1.5"
                    >
                        <X size={14} /> Close
                    </button>
                    <button
                        onClick={handleTestPrint}
                        disabled={testing || !selectedPrinter}
                        className="px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors bg-[var(--color-primary)] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {testing ? 'Printing…' : 'Test Print'}
                    </button>
                </div>
            </div>
        </div>
    )
}
