'use client'

import { useState } from 'react'
import { toast } from 'react-hot-toast'
import { Printer as PrinterIcon } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { EscPosBuilder } from '@/lib/print/escpos'
import { printRawEscPos } from '@/lib/print/qzClient'
import { createPrinterAction, updatePrinterAction, type PrinterInput } from '@/app/(admin)/admin/printers/actions'
import type { Printer, PrinterConfigRole, PrinterType, PaperWidth } from '@/types/database'

const ROLE_OPTIONS: { value: PrinterConfigRole; label: string }[] = [
    { value: 'kot', label: 'Kitchen Ticket (KOT)' },
    { value: 'bot', label: 'Bar Ticket (BOT)' },
    { value: 'bill', label: 'Customer Bill' },
]

const emptyForm: PrinterInput = {
    name: '',
    printer_type: 'network',
    ip_address: '',
    port: 9100,
    role: 'kot',
    paper_width: '80mm',
    copies: 1,
    is_active: true,
    is_default: false,
}

function toForm(p: Printer): PrinterInput {
    return {
        name: p.name,
        printer_type: p.printer_type,
        ip_address: p.ip_address ?? '',
        port: p.port,
        role: p.role,
        paper_width: p.paper_width,
        copies: p.copies,
        is_active: p.is_active,
        is_default: p.is_default,
    }
}

function buildTestTicket(): Uint8Array {
    return new EscPosBuilder()
        .init().align('center').bold(true)
        .line('TEST PRINT').bold(false)
        .line('Network printer connected.')
        .cut().build()
}

export default function PrinterFormModal({
    open, onClose, editing, onSaved,
}: {
    open: boolean
    onClose: () => void
    editing: Printer | null
    onSaved: () => void
}) {
    // Initialised once per mount; the parent keys this component on the row being
    // edited (or 'new') so switching rows / reopening remounts with fresh state.
    const [form, setForm] = useState<PrinterInput>(() => (editing ? toForm(editing) : emptyForm))
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)

    if (!open) return null
    const isNetwork = form.printer_type === 'network'

    const set = <K extends keyof PrinterInput>(key: K, value: PrinterInput[K]) =>
        setForm((f) => ({ ...f, [key]: value }))

    const handleSave = async () => {
        setSaving(true)
        try {
            const res = editing
                ? await updatePrinterAction(editing.id, form)
                : await createPrinterAction(form)
            if (res?.error) { toast.error(res.error); return }
            toast.success(editing ? 'Printer updated' : 'Printer added')
            onSaved()
            onClose()
        } finally {
            setSaving(false)
        }
    }

    const handleTest = async () => {
        if (!isNetwork || !form.ip_address) { toast.error('Enter an IP address first'); return }
        setTesting(true)
        try {
            const res = await printRawEscPos({ host: form.ip_address.trim(), port: Number(form.port) || 9100 }, buildTestTicket())
            if (res.ok) toast.success('Test ticket sent')
            else if (res.status === 'not-running') toast.error('QZ Tray isn’t running on this device')
            else if (res.status === 'not-trusted') toast.error('Blocked — allow this site in the QZ Tray prompt')
            else toast.error(res.error || 'Test print failed — check the IP is reachable on this LAN')
        } finally {
            setTesting(false)
        }
    }

    const inputCls = 'mt-1.5 w-full px-3 py-2 text-sm rounded-lg border border-hairline-strong bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50'
    const labelCls = 'block text-xs font-semibold text-ink-subtle uppercase tracking-wide'

    return (
        <Modal open={open} onClose={onClose} size="md" ariaLabel={editing ? 'Edit Printer' : 'Add New Printer'}>
            <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                    <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600">
                        <PrinterIcon size={20} />
                    </div>
                    <h3 className="text-lg font-semibold text-ink">{editing ? 'Edit Printer' : 'Add New Printer'}</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Printer Name</label>
                        <input className={inputCls} value={form.name} placeholder="Kitchen Printer 1"
                            onChange={(e) => set('name', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelCls}>Connection Type</label>
                        <select className={inputCls} value={form.printer_type}
                            onChange={(e) => set('printer_type', e.target.value as PrinterType)}>
                            <option value="network">Network Printer (IP)</option>
                            <option value="usb">USB (per-device)</option>
                        </select>
                    </div>

                    {isNetwork && (
                        <>
                            <div>
                                <label className={labelCls}>IP Address</label>
                                <input className={inputCls} value={form.ip_address ?? ''} placeholder="192.168.1.100"
                                    onChange={(e) => set('ip_address', e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>Port (default: 9100)</label>
                                <input className={inputCls} type="number" value={form.port} min={1} max={65535}
                                    onChange={(e) => set('port', Number(e.target.value))} />
                            </div>
                        </>
                    )}

                    <div>
                        <label className={labelCls}>Prints</label>
                        <select className={inputCls} value={form.role}
                            onChange={(e) => set('role', e.target.value as PrinterConfigRole)}>
                            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Paper Width</label>
                        <select className={inputCls} value={form.paper_width}
                            onChange={(e) => set('paper_width', e.target.value as PaperWidth)}>
                            <option value="80mm">80mm</option>
                            <option value="58mm">58mm</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Copies</label>
                        <input className={inputCls} type="number" value={form.copies} min={1} max={9}
                            onChange={(e) => set('copies', Number(e.target.value))} />
                    </div>
                </div>

                {!isNetwork && (
                    <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        USB printers are chosen per-device from the Printer Settings button on each till/kitchen screen. This entry is just a label — auto-print still uses that device’s local selection.
                    </p>
                )}

                <div className="mt-5 space-y-2">
                    <Toggle label="Active" hint="Off = ignored by auto-print" checked={form.is_active} onChange={(v) => set('is_active', v)} />
                    <Toggle label="Default for this role" hint="Used when several printers share a role" checked={form.is_default} onChange={(v) => set('is_default', v)} />
                </div>
            </div>

            <div className="px-6 py-4 bg-surface-muted border-t border-hairline flex justify-between gap-3 sm:rounded-b-[24px]">
                <button onClick={handleTest} disabled={testing || !isNetwork || !form.ip_address}
                    className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface border border-hairline-strong rounded-lg shadow-sm hover:bg-surface-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {testing ? 'Printing…' : 'Test Print'}
                </button>
                <div className="flex gap-3">
                    <button onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface border border-hairline-strong rounded-lg shadow-sm hover:bg-surface-muted transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSave} disabled={saving || !form.name.trim() || (isNetwork && !form.ip_address?.trim())}
                        className="px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Printer'}
                    </button>
                </div>
            </div>
        </Modal>
    )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <span className="text-sm font-medium text-ink">{label}</span>
                <span className="ml-2 text-[11px] text-ink-subtle">{hint}</span>
            </div>
            <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-hairline-strong'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
        </div>
    )
}
