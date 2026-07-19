// Shared on-screen/print receipt markup for a settled table or room bill.
// Used by both the Cashier POS invoice preview and the admin Room Billing
// modal so the two never drift apart — the ESC/POS thermal template in
// lib/print/templates/invoiceTicket.ts mirrors this layout; keep both in sync.

import type { ActiveInvoice } from '@/lib/print/templates/invoiceTicket'
import { advanceMethodLabel } from '@/lib/utils'

export default function InvoiceReceipt({
    invoice,
    money,
    restaurantName = 'KKHANE HOTEL & RESTAURANT',
    className = '',
    formatDate,
}: {
    invoice: ActiveInvoice
    money: (amount: number) => string
    formatDate?: (date: Date | string) => string
    restaurantName?: string
    className?: string
}) {
    const now = new Date()
    return (
        <div className={`bg-white text-black print-container font-mono text-[11px] ${className}`}>
            {/* CSS media print override for POS thermal printer */}
            <style>{`
                @page {
                    size: 80mm auto;
                    margin: 0;
                }
                @media print {
                    html, body {
                        background: #fff !important;
                        color: #000 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    body * {
                        visibility: hidden !important;
                    }
                    .print-container, .print-container * {
                        visibility: visible !important;
                    }
                    .print-container {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 72mm !important; /* standard safe area for 80mm roll */
                        max-width: 72mm !important;
                        border: none !important;
                        border-top: none !important;
                        box-shadow: none !important;
                        padding: 2mm 0 4mm 0 !important;
                        margin: 0 !important;
                        background: #fff !important;
                        color: #000 !important;
                        font-family: monospace !important;
                        font-size: 11px !important;
                        line-height: 1.3 !important;
                    }
                    .print-actions {
                        display: none !important;
                    }
                }
            `}</style>

            {/* Invoice Header */}
            <div className="text-center space-y-0.5">
                <h2 className="text-sm font-black tracking-tight text-black uppercase">{restaurantName}</h2>
                <p className="text-[10px] text-gray-600">Lalitpur, Nepal · Tel: 01-5500000</p>
                <div className="border-t border-dashed border-black my-1.5" />
                <p className="font-bold text-[11px] uppercase tracking-wider">*** INVOICE ***</p>
                <p className="text-[9px] text-gray-500 font-mono">No: INV-{invoice.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-[9px] text-gray-500 font-mono">Date: {formatDate ? formatDate(now) : now.toLocaleString()}</p>
            </div>

            <div className="border-t border-dashed border-black my-1.5" />

            {/* Guest / Table Info */}
            <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                    <span className="font-bold">GUEST:</span>
                    <span>{invoice.guestName || 'Walk-in Customer'}</span>
                </div>
                {invoice.guestPhone && (
                    <div className="flex justify-between">
                        <span className="font-bold">PHONE:</span>
                        <span>{invoice.guestPhone}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span className="font-bold">REF:</span>
                    <span className="font-bold uppercase text-brand-600">{invoice.label}</span>
                </div>
                {invoice.roomType && (
                    <div className="flex justify-between">
                        <span className="font-bold">TYPE:</span>
                        <span>{invoice.roomType}</span>
                    </div>
                )}
            </div>

            <div className="border-t border-dashed border-black my-1.5" />

            {/* Line Items */}
            <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold pb-1 border-b border-dashed border-black">
                    <span className="w-1/2 text-left">DESC</span>
                    <span className="w-12 text-center">QTY</span>
                    <span className="w-16 text-right">RATE</span>
                    <span className="w-16 text-right text-black">AMT</span>
                </div>

                <div className="divide-y divide-dashed divide-gray-200 text-[10px] space-y-1 pt-1.5">
                    {/* Stay Charge (if room) */}
                    {invoice.type === 'room' && invoice.stayCost > 0 && (
                        <div className="flex justify-between py-0.5">
                            <span className="w-1/2 text-left truncate">Room Stay ({invoice.nights}n)</span>
                            <span className="w-12 text-center">{invoice.nights}</span>
                            <span className="w-16 text-right">{money(invoice.basePrice)}</span>
                            <span className="w-16 text-right font-bold text-black">{money(invoice.stayCost)}</span>
                        </div>
                    )}

                    {/* Additional charges */}
                    {invoice.manualCharges && invoice.manualCharges.map((c) => (
                        <div key={c.id} className="flex justify-between py-0.5">
                            <span className="w-1/2 text-left truncate capitalize">{c.description}</span>
                            <span className="w-12 text-center">1</span>
                            <span className="w-16 text-right">{money(c.amount)}</span>
                            <span className="w-16 text-right font-bold text-black">{money(c.amount)}</span>
                        </div>
                    ))}

                    {/* QR / Session order items */}
                    {invoice.qrOrders && invoice.qrOrders.map((item, idx) => (
                        <div key={idx} className="flex justify-between py-0.5">
                            <span className="w-1/2 text-left truncate">{invoice.type === 'room' ? `Food: ${item.name}` : item.name}</span>
                            <span className="w-12 text-center">{item.quantity}</span>
                            <span className="w-16 text-right">{money(item.unitPrice)}</span>
                            <span className="w-16 text-right font-bold text-black">{money(item.unitPrice * item.quantity)}</span>
                        </div>
                    ))}

                    {/* Waiter-linked Dining table orders */}
                    {invoice.linkedOrders && invoice.linkedOrders.map((item, idx) => (
                        <div key={idx} className="flex justify-between py-0.5">
                            <span className="w-1/2 text-left truncate font-medium">Dine: {item.name}</span>
                            <span className="w-12 text-center">{item.quantity}</span>
                            <span className="w-16 text-right">{money(item.unitPrice)}</span>
                            <span className="w-16 text-right font-bold text-black">{money(item.unitPrice * item.quantity)}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="border-t border-dashed border-black my-1.5" />

            {/* Invoice Total + Advance + Balance */}
            <div className="space-y-0.5 text-[10px]">
                {!!invoice.extraHourCharge && invoice.extraHourCharge > 0 && (
                    <div className="flex justify-between text-gray-600">
                        <span>Extra Hour Charge</span>
                        <span className="tabular-nums">{money(invoice.extraHourCharge)}</span>
                    </div>
                )}
                {!!invoice.discountAmount && invoice.discountAmount > 0 && (
                    <div className="flex justify-between text-gray-600">
                        <span>Total Discount</span>
                        <span className="tabular-nums">- {money(invoice.discountAmount)}</span>
                    </div>
                )}
                <div className="flex justify-between font-bold">
                    <span className="uppercase">Grand Total</span>
                    <span className="tabular-nums">{money(invoice.total)}</span>
                </div>
                {!!invoice.advancePaid && invoice.advancePaid > 0 && (
                    <div className="flex justify-between text-gray-600">
                        <span>Advance Paid ({advanceMethodLabel(invoice.advanceMethod)})</span>
                        <span className="tabular-nums">- {money(invoice.advancePaid)}</span>
                    </div>
                )}
            </div>

            <div className="flex justify-between items-center text-xs font-black border-t border-dashed border-black pt-1 mt-1">
                <span className="uppercase">{invoice.advancePaid && invoice.advancePaid > 0 ? 'BALANCE DUE' : 'TOTAL DUE'}</span>
                <span className="text-sm font-black text-black tabular-nums">{money(invoice.balanceDue ?? invoice.total)}</span>
            </div>

            {/* Payment Method on receipt */}
            {invoice.paymentMethod && (
                <div className="space-y-0.5 pt-1 text-[10px]">
                    <div className="flex justify-between">
                        <span className="font-bold uppercase">Payment</span>
                        <span className="font-bold uppercase">
                            {invoice.paymentMethod === 'cash' ? 'CASH'
                                : invoice.paymentMethod === 'qr_digital' ? 'QR / DIGITAL'
                                : invoice.paymentMethod === 'credit' ? 'CREDIT'
                                : 'SPLIT'}
                        </span>
                    </div>
                    {invoice.paymentMethod === 'both' && (
                        <>
                            <div className="flex justify-between text-gray-600">
                                <span>· Cash</span>
                                <span className="tabular-nums">{money(invoice.cashPaid ?? 0)}</span>
                            </div>
                            <div className="flex justify-between text-gray-600">
                                <span>· QR / Digital</span>
                                <span className="tabular-nums">{money(invoice.qrPaid ?? 0)}</span>
                            </div>
                            {!!invoice.creditPaid && (
                                <div className="flex justify-between text-gray-600">
                                    <span>· On credit</span>
                                    <span className="tabular-nums">{money(invoice.creditPaid)}</span>
                                </div>
                            )}
                        </>
                    )}
                    {invoice.paymentMethod === 'credit' && !!invoice.creditPaid && (
                        <div className="flex justify-between text-gray-600">
                            <span>· On credit</span>
                            <span className="tabular-nums">{money(invoice.creditPaid)}</span>
                        </div>
                    )}
                </div>
            )}

            <div className="border-t border-dashed border-black my-1.5" />

            {/* Thermal Printer Welcome Greeting */}
            <div className="text-center text-[9px] text-gray-500 uppercase tracking-widest leading-normal pt-1 pb-2">
                <p>*** THANK YOU! ***</p>
                <p>WE HOPE TO SEE YOU AGAIN</p>
            </div>
        </div>
    )
}
