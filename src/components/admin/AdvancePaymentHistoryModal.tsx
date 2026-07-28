'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Clock, Banknote, History, Loader2, FileText, Printer } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { advanceMethodLabel } from '@/lib/utils'
import { useDates } from '@/lib/contexts/CalendarContext'
import { useNetworkPrintersStore } from '@/lib/print/useNetworkPrinters'

export interface AdvancePaymentRecord {
    id: string
    amount: number
    payment_method: string
    cash_amount?: number
    qr_amount?: number
    note?: string | null
    created_at: string
}

export default function AdvancePaymentHistoryModal({
    isOpen,
    onClose,
    bookingId,
    guestName,
    roomNumber
}: {
    isOpen: boolean
    onClose: () => void
    bookingId: string | null
    guestName?: string
    roomNumber?: string
}) {
    const money = useCurrency()
    const { formatDateTime } = useDates()
    const [loading, setLoading] = useState(false)
    const [payments, setPayments] = useState<AdvancePaymentRecord[]>([])
    const [totalAdvance, setTotalAdvance] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [mounted, setMounted] = useState(false)
    const [selectedPrinterId, setSelectedPrinterId] = useState<string>('browser')

    const networkPrinters = useNetworkPrintersStore(s => s.printers)
    const loadPrinters = useNetworkPrintersStore(s => s.load)

    useEffect(() => {
        setMounted(true)
        loadPrinters()
    }, [loadPrinters])

    useEffect(() => {
        if (isOpen && bookingId) {
            fetchPaymentHistory(bookingId)
        }
    }, [isOpen, bookingId])

    const fetchPaymentHistory = async (id: string) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/bookings/payments?bookingId=${id}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Failed to load advance payments')
            setPayments(data.payments || [])
            setTotalAdvance(data.totalAdvance || 0)
        } catch (err: any) {
            setError(err.message || 'Could not fetch advance history')
        } finally {
            setLoading(false)
        }
    }

    const handlePrint = () => {
        if (typeof window !== 'undefined') {
            window.print()
        }
    }

    if (!isOpen || !mounted) return null

    return createPortal(
        <>
            <div 
                className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-all duration-300 print:hidden"
                onClick={onClose}
            >
                <div 
                    className="bg-surface border border-hairline rounded-[24px] shadow-2xl max-w-md w-full flex flex-col overflow-hidden transform transition-all animate-in zoom-in-95 duration-200"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center font-bold shrink-0">
                                <History className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="text-body font-black text-ink">
                                    Advance Payment History
                                </h3>
                                <p className="text-[11px] text-ink-subtle mt-0.5">
                                    {roomNumber ? `Room ${roomNumber}` : 'Room Stay'} {guestName ? `• Guest: ${guestName}` : ''}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink-muted"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto space-y-4 flex-1">
                        {/* Printer Selector */}
                        <div className="p-3 bg-surface-muted/60 border border-hairline rounded-2xl space-y-1">
                            <label className="block text-[10px] font-extrabold text-ink-subtle uppercase flex items-center gap-1.5">
                                <Printer size={13} className="text-brand-600" />
                                Select Destination Printer
                            </label>
                            <select
                                value={selectedPrinterId}
                                onChange={e => setSelectedPrinterId(e.target.value)}
                                className="w-full px-3 py-1.5 border border-hairline rounded-xl text-xs bg-surface text-ink font-bold focus:outline-none focus:border-brand-500"
                            >
                                <option value="browser">System / Browser Default Printer</option>
                                {networkPrinters.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.name} ({p.ip_address}:{p.port || 9100})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {loading ? (
                            <div className="py-12 flex flex-col items-center justify-center gap-3 text-ink-subtle">
                                <Loader2 className="w-7 h-7 animate-spin text-brand-500" />
                                <p className="text-xs font-semibold">Loading payment history...</p>
                            </div>
                        ) : error ? (
                            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-700 text-xs font-semibold">
                                {error}
                            </div>
                        ) : payments.length === 0 ? (
                            <div className="py-12 text-center text-ink-subtle">
                                <Banknote className="w-9 h-9 mx-auto mb-2 opacity-30" />
                                <p className="text-xs font-bold">No advance payments recorded</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between px-1 text-[10px] font-bold text-ink-subtle uppercase tracking-wider">
                                    <span>Installments & Written Notes</span>
                                    <span>Amount Paid</span>
                                </div>

                                <div className="space-y-2.5">
                                    {payments.map((p, idx) => {
                                        const methodText = advanceMethodLabel(p.payment_method as any)
                                        const noteText = p.note && p.note.trim() ? p.note.trim() : 'Advance'
                                        return (
                                            <div 
                                                key={p.id || idx} 
                                                className="p-3.5 bg-surface border border-hairline rounded-2xl flex items-start justify-between gap-3 hover:border-brand-200 transition"
                                            >
                                                <div className="space-y-1.5 min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-surface-muted text-ink-subtle border border-hairline">
                                                            #{idx + 1}
                                                        </span>
                                                        <span className="text-xs font-black text-ink">
                                                            {noteText}
                                                        </span>
                                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-600 border border-brand-100">
                                                            {methodText}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-1 text-[11px] font-semibold text-ink-subtle pt-0.5">
                                                        <Clock className="w-3 h-3 text-ink-subtle shrink-0" />
                                                        <span>{formatDateTime(p.created_at)}</span>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <span className="font-black text-sm text-emerald-600 tabular-nums">
                                                        + {money(p.amount)}
                                                    </span>
                                                    {p.payment_method === 'split' && (p.cash_amount || p.qr_amount) ? (
                                                        <div className="text-[10px] font-bold text-ink-subtle mt-0.5">
                                                            Cash: {money(p.cash_amount || 0)} | QR: {money(p.qr_amount || 0)}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-hairline bg-surface flex items-center justify-between gap-3">
                        <div>
                            <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Total Advance Paid</span>
                            <p className="text-xl font-black text-ink tabular-nums">
                                {money(totalAdvance)}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={handlePrint} variant="primary" className="px-4 py-2 font-bold text-xs flex items-center gap-1.5">
                                <Printer size={14} />
                                Print
                            </Button>
                            <Button onClick={onClose} variant="secondary" className="px-4 py-2 font-bold text-xs">
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 80mm Thermal Receipt Print Styles & Slip */}
            <style>{`
                @page { size: 80mm auto; margin: 0; }
                @media print {
                    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; width: 80mm !important; }
                    body * { visibility: hidden !important; }
                    .advance-slip-print, .advance-slip-print * { visibility: visible !important; }
                    .advance-slip-print {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 72mm !important;
                        max-width: 72mm !important;
                        margin: 0 auto !important;
                        padding: 3mm !important;
                        font-family: monospace, monospace !important;
                        font-size: 11px !important;
                        line-height: 1.3 !important;
                        color: #000 !important;
                    }
                }
            `}</style>

            <div className="hidden print:block advance-slip-print">
                <div className="text-center border-b border-black pb-2 mb-2">
                    <h2 className="font-black text-xs uppercase tracking-tight">ADVANCE PAYMENT STATEMENT</h2>
                    <p className="text-[10px] font-bold mt-0.5">{roomNumber ? `Room ${roomNumber}` : 'Room Stay'} {guestName ? `• ${guestName}` : ''}</p>
                    <p className="text-[9px] text-gray-700 mt-0.5">Printed: {new Date().toLocaleString()}</p>
                </div>

                <table className="w-full text-left border-collapse text-[10px]">
                    <thead>
                        <tr className="border-b border-black text-[9px] uppercase font-bold">
                            <th className="py-1">#</th>
                            <th className="py-1">Remarks</th>
                            <th className="py-1">Method</th>
                            <th className="py-1 text-right">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {payments.map((p, idx) => (
                            <tr key={p.id || idx} className="border-b border-gray-300">
                                <td className="py-1 font-bold">#{idx + 1}</td>
                                <td className="py-1">{p.note || 'Advance'}</td>
                                <td className="py-1">{advanceMethodLabel(p.payment_method as any)}</td>
                                <td className="py-1 text-right font-bold">{money(p.amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="border-t-2 border-black mt-2 pt-2 flex justify-between font-black text-xs">
                    <span>TOTAL ADVANCE:</span>
                    <span>{money(totalAdvance)}</span>
                </div>

                <div className="border-t border-dashed border-black my-2" />

                {/* Brand Footer — Powered by KKKhane with logo */}
                <div className="text-center pt-1 pb-1 flex flex-col items-center gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/kkkhane-k-logo.jpg" alt="KKKhane" className="w-4 h-4 mx-auto" />
                    <p className="text-[8px] uppercase tracking-widest font-bold" style={{ color: '#000' }}>Powered by KKKhane</p>
                </div>
            </div>
        </>,
        document.body
    )
}
