'use client'

import { Printer, X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useDates } from '@/lib/contexts/CalendarContext'

export interface VoucherSlipData {
    date: string
    voucher_type: 'receipt' | 'payment'
    voucher_number: string
    party_name: string
    particulars: string
    payment_mode: 'cash' | 'qr' | 'cheque' | 'bank'
    bank_name: string
    reference_no: string
    receiver_name: string
    status: 'approved' | 'pending_approval' | 'rejected'
    category?: string
    amount: number
    cheque_details?: {
        written_name: string
        bank_cheque: string // Issuer Bank
        cheque_number: string
        cheque_date: string
        cheque_type: 'ac_payee' | 'normal'
    }
}

function amountInWords(amount: number): string {
    // Round to paisa BEFORE splitting off the rupees. Flooring the raw double
    // spelled a cheque for Rs. 1,000.00 as "Nine Hundred Ninety Nine": a total
    // summed out of floats lands on 999.999…, and 999.995 is printed as
    // 1,000.00 by formatCurrency while flooring reads it as 999. The words on a
    // cheque have to agree with the figures beside them.
    const paisaTotal = Math.round((Number(amount) || 0) * 100)
    const rupees = Math.floor(paisaTotal / 100)
    const paisa = paisaTotal % 100

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
                  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

    function helper(n: number): string {
        if (n < 20) return ones[n]
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '')
        // `n % 100` — the remainder below a hundred. It read `n % 150`, which
        // spelled 250 as "Two Hundred One Hundred" and swallowed the 50 in 150.
        if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + helper(n % 100) : '')
        if (n < 100000) return helper(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + helper(n % 1000) : '')
        if (n < 10000000) return helper(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + helper(n % 100000) : '')
        return helper(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + helper(n % 10000000) : '')
    }

    // Quick and safe Nepalese conversion helper
    if (rupees === 0 && paisa === 0) return 'Zero Rupees Only'

    const rupeeWords = rupees > 0 ? `${helper(rupees)} Rupees` : ''
    // Paisa spelled out too rather than dropped — "Rupees Only" under a figure
    // reading 1,250.50 is a cheque for the wrong amount.
    const paisaWords = paisa > 0 ? `${helper(paisa)} Paisa` : ''

    return [rupeeWords, paisaWords].filter(Boolean).join(' and ') + ' Only'
}

// Printable Voucher Slip — thermal receipt width (80mm), same
// visibility-isolation print technique as the cashier invoice
// (CashierClient.tsx) and KOT tickets (KotPrintFallback), not the A4 report
// layout used by PrintableReport. Shared by VouchersManager's on-demand
// per-row print icon and PayPartyModal's post-payment print prompt.
export default function VoucherPrintSlip({
    voucher,
    onClose,
}: {
    voucher: VoucherSlipData
    onClose: () => void
}) {
    // Follows the printing user's own calendar choice, like every other date.
    const { formatDate } = useDates()

    const handlePrint = () => {
        window.print()
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:p-0 print:absolute print:inset-0">
            <style>{`
                @page { size: 80mm auto; margin: 0; }
                @media print {
                    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                    body * { visibility: hidden !important; }
                    .voucher-slip-print, .voucher-slip-print * { visibility: visible !important; }
                    .voucher-slip-print {
                        position: absolute !important; left: 0 !important; top: 0 !important;
                        width: 72mm !important; max-width: 72mm !important;
                        font-family: monospace !important;
                    }
                }
            `}</style>
            <div
                className="fixed inset-0 bg-[#0a0a0a]/60 backdrop-blur-md transition-opacity duration-300 print:hidden"
                onClick={onClose}
            />

            <div className="bg-surface rounded-2xl border border-hairline shadow-2xl w-full max-w-sm relative z-10 overflow-hidden flex flex-col max-h-[90vh] print:max-h-none print:w-full print:border-none print:shadow-none print:static">

                <div className="p-4 border-b border-hairline flex items-center justify-between bg-surface-muted/50 print:hidden shrink-0">
                    <span className="text-xs font-black text-ink uppercase tracking-wider">Voucher Print Preview</span>
                    <div className="flex gap-2">
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition shadow-md shadow-brand-500/10 focus-ring"
                        >
                            <Printer size={13} /> Print Slip
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-surface-muted rounded-xl text-ink-subtle hover:text-ink-subtle transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 print:p-0 print:overflow-visible">
                    <div className="voucher-slip-print border border-hairline p-4 rounded-xl font-mono text-[11px] text-ink space-y-3 print:border-none print:p-1 print:rounded-none">

                        <div className="text-center border-b border-dashed border-hairline pb-2">
                            <h2 className="text-sm font-black tracking-tight text-ink">KKKHANE RESTAURANT</h2>
                            <p className="text-[9px] text-ink-subtle uppercase font-bold tracking-widest mt-0.5">Workspace Account Voucher</p>
                        </div>

                        <div className="text-center py-1 bg-surface-muted border border-hairline rounded">
                            <h3 className="text-xs font-black tracking-widest text-ink uppercase">
                                {voucher.voucher_type === 'receipt' ? 'RECEIPT VOUCHER' : 'PAYMENT VOUCHER'}
                            </h3>
                        </div>

                        {/* Metadata — stacked single-column, not a grid, so it stays
                            readable at 72mm print width */}
                        <div className="space-y-1 border-b border-dashed border-hairline pb-2 text-[10px]">
                            <div>
                                <span className="font-bold text-ink-subtle uppercase">Voucher No: </span>
                                <span className="font-black text-ink">{voucher.voucher_number}</span>
                            </div>
                            <div>
                                <span className="font-bold text-ink-subtle uppercase">Date: </span>
                                <span className="font-black text-ink">
                                    {formatDate(voucher.date)}
                                </span>
                            </div>
                            <div>
                                <span className="font-bold text-ink-subtle uppercase">
                                    {voucher.voucher_type === 'receipt' ? 'Received From: ' : 'Paid To: '}
                                </span>
                                <span className="font-black text-ink uppercase">{voucher.party_name}</span>
                            </div>
                            <div>
                                <span className="font-bold text-ink-subtle uppercase">Payment Mode: </span>
                                <span className="font-black text-ink uppercase">
                                    {voucher.payment_mode === 'cash' ? 'CASH' : voucher.payment_mode === 'qr' ? `QR (${voucher.bank_name})` : voucher.payment_mode === 'cheque' ? `CHEQUE (${voucher.bank_name})` : `BANK (${voucher.bank_name})`}
                                </span>
                            </div>
                            {voucher.reference_no && (
                                <div>
                                    <span className="font-bold text-ink-subtle uppercase">Ref Phone: </span>
                                    <span className="font-black text-ink">{voucher.reference_no}</span>
                                </div>
                            )}
                            {voucher.receiver_name && (
                                <div>
                                    <span className="font-bold text-ink-subtle uppercase">Receiver Staff: </span>
                                    <span className="font-black text-ink uppercase">{voucher.receiver_name}</span>
                                </div>
                            )}
                            {voucher.voucher_type === 'payment' && voucher.category && (
                                <div>
                                    <span className="font-bold text-ink-subtle uppercase">Ledger Category: </span>
                                    <span className="font-black text-ink uppercase">{voucher.category}</span>
                                </div>
                            )}
                            {voucher.payment_mode === 'cheque' && voucher.cheque_details && (
                                <div className="border-t border-hairline pt-1.5 mt-1 space-y-1">
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Issuer Bank: </span>
                                        <span className="font-black text-ink uppercase">{voucher.cheque_details.bank_cheque}</span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Cheque Number: </span>
                                        <span className="font-black text-ink">{voucher.cheque_details.cheque_number}</span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Written Name: </span>
                                        <span className="font-black text-ink uppercase">{voucher.cheque_details.written_name}</span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Cheque Date: </span>
                                        <span className="font-black text-ink">{voucher.cheque_details.cheque_date}</span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Cheque Type: </span>
                                        <span className="font-black text-ink uppercase">
                                            {voucher.cheque_details.cheque_type === 'ac_payee' ? 'A/C Payee' : 'Normal Cheque'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-bold text-ink-subtle uppercase">Status: </span>
                                        <span className={`font-black uppercase ${voucher.status === 'approved' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {voucher.status}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Particulars — single line item, stacked description then amount */}
                        <div className="space-y-1 border-b border-dashed border-hairline pb-2">
                            <div className="text-[9px] font-bold text-ink-subtle uppercase">Particulars / Description</div>
                            <div className="font-semibold leading-relaxed text-[10px]">
                                {voucher.payment_mode === 'cheque' && voucher.cheque_details ? (
                                    <span>
                                        Cheque settlement payout: No. {voucher.cheque_details.cheque_number} issued on {voucher.cheque_details.bank_cheque}. (Payee: {voucher.cheque_details.written_name})
                                    </span>
                                ) : (
                                    voucher.particulars
                                )}
                            </div>
                            <div className="flex items-center justify-between font-black text-ink pt-1">
                                <span className="uppercase text-[9px] text-ink-subtle">Total Amount</span>
                                <span className="text-sm">{formatCurrency(voucher.amount)}</span>
                            </div>
                        </div>

                        <div className="p-2 bg-surface-muted border border-hairline rounded text-[10px] space-y-0.5">
                            <span className="block font-bold text-ink-subtle uppercase">Sum In Words:</span>
                            <span className="font-black text-ink italic capitalize">{amountInWords(voucher.amount)}</span>
                        </div>

                        {/* Signatures — stacked vertically, not side-by-side columns,
                            so each signature line has room on narrow paper */}
                        <div className="space-y-4 pt-6 text-[9px] font-bold text-ink-subtle uppercase">
                            <div className="border-t border-hairline pt-1.5">
                                <span className="text-ink font-black">Prepared By</span> — Cashier / Accountant
                            </div>
                            <div className="border-t border-hairline pt-1.5">
                                <span className="text-ink font-black">Approved By</span> — Manager / Owner
                            </div>
                            <div className="border-t border-hairline pt-1.5">
                                <span className="text-ink font-black">
                                    {voucher.voucher_type === 'receipt' ? 'Paid By' : 'Received By'}
                                </span> — Receiver Signature
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    )
}
