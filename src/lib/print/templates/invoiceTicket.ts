// Builds the ESC/POS byte stream for a settled table/room invoice — the
// thermal-print equivalent of the receipt markup in InvoiceReceipt.tsx.
//
// The money block at the foot is no longer duplicated between the two: both
// render whatever summariseInvoice() returns, so paper and screen cannot
// disagree about what the guest owes. Only the item table above it is written
// twice, and that carries no arithmetic.

import { EscPosBuilder, LINE_WIDTH, wrapTextToByteWidth } from '../escpos'
import { advanceMethodLabel, formatInvoiceAddress } from '@/lib/utils'
import { summariseInvoice } from '@/lib/invoiceSummary'
import type { AdvancePaymentMethod } from '@/types/database'
import { appendBrandFooter } from './brandFooter'
import { DEFAULT_CALENDAR, formatDateTime, type Calendar } from '@/lib/calendar'

export interface InvoiceLineItem {
    name: string
    quantity: number
    unitPrice: number
    status?: string
}

export interface InvoiceManualCharge {
    id: string
    description: string
    amount: number
}

/** One room on a bill covering several of them. */
export interface InvoiceRoomLine {
    roomNumber: string
    nights: number
    stayCost: number
}

export interface ActiveInvoice {
    type: 'room' | 'table' | 'takeout' | 'delivery'
    id: string
    /** Set for 'takeout'/'delivery' — the order being settled (no session for these). */
    orderId?: string
    label: string
    roomType?: string
    guestName: string
    guestPhone?: string | null
    /** Address taken at check-in, printed under the phone when one was given. */
    guestAddress?: string | null
    /**
     * Staff member settling this bill, printed so two cashiers working the same
     * counter produce distinguishable receipts — the paper counterpart of the
     * cashier_id now stamped on the order/booking row. Omitted rather than
     * printed blank when the name isn't known.
     */
    cashierName?: string | null
    nights: number
    basePrice: number
    stayCost: number
    subtotal?: number
    serviceCharge?: number
    service_charge_amount?: number
    taxAmount?: number
    tax_amount?: number
    /**
     * Set only for a multi-room reservation, which settles on one bill: the
     * per-room split of `stayCost`, printed as a line each so the guest sees
     * what every room cost. Absent for a normal stay, which prints the single
     * "Room Stay" line it always did.
     */
    roomLines?: InvoiceRoomLine[]
    qrOrders: InvoiceLineItem[]
    qrOrdersTotal: number
    linkedOrders?: InvoiceLineItem[]
    linkedOrdersTotal?: number
    manualCharges: InvoiceManualCharge[]
    manualChargesTotal: number
    total: number
    advancePaid?: number
    advanceMethod?: AdvancePaymentMethod | null
    balanceDue?: number
    paymentMethod?: 'cash' | 'qr_digital' | 'both' | 'credit' | 'none'
    cashPaid?: number
    cashGiven?: number
    changeReturned?: number
    qrPaid?: number
    creditPaid?: number
    discountAmount?: number
    discountReason?: string
    extraHourCharge?: number
}

const COL = { desc: 18, qty: 4, rate: 9, amt: 11 }

export function buildInvoiceTicket(
    invoice: ActiveInvoice,
    money: (amount: number) => string,
    restaurantName = 'ROYAL REST HOUSE',
    restaurantAddress = 'Pulchowk, Chitwan',
    restaurantPhone = '',
    // Printed invoices carry Bikram Sambat first, like the rest of the app. Not
    // a hook — this builds raw ESC/POS bytes outside React — so the cashier's
    // current choice is passed in from the component that triggers the print.
    calendar: Calendar = DEFAULT_CALENDAR,
): Uint8Array {
    const b = new EscPosBuilder().init()

    const num = (amount: number) =>
        Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    b.align('center').bold(true).line(restaurantName || 'ROYAL REST HOUSE').bold(false)
    const formattedAddress = formatInvoiceAddress(restaurantAddress || 'Pulchowk, Chitwan')
    if (formattedAddress) {
        const addressLines = wrapTextToByteWidth(formattedAddress, LINE_WIDTH)
        for (const addrLine of addressLines) {
            b.line(addrLine)
        }
    }
    if (restaurantPhone.trim()) {
        b.line(`Tel: ${restaurantPhone.trim()}`)
    }
    b.line('*** ESTIMATE BILL ***')
    b.line(`ESTIMATE BILL No: EST-${invoice.id.slice(0, 8).toUpperCase()}`)
    b.line(`Date: ${formatDateTime(new Date(), calendar)}`)
    b.divider()

    b.align('left')
    b.line(`GUEST: ${invoice.guestName || 'Walk-in Customer'}`)
    if (invoice.guestPhone) b.line(`PHONE: ${invoice.guestPhone}`)
    if (invoice.guestAddress) b.line(`ADDRESS: ${invoice.guestAddress}`)
    b.line(`REF: ${invoice.label.toUpperCase()}`)
    if (invoice.roomType) b.line(`TYPE: ${invoice.roomType}`)
    if (invoice.cashierName?.trim()) b.line(`CASHIER: ${invoice.cashierName.trim()}`)
    b.divider()

    b.bold(true)
    b.columns([
        { text: 'DESC', width: COL.desc },
        { text: 'QTY', width: COL.qty, align: 'center' },
        { text: 'RATE', width: COL.rate, align: 'right' },
        { text: 'AMT', width: COL.amt, align: 'right' },
    ])
    b.bold(false)

    if (invoice.type === 'room' && invoice.stayCost > 0) {
        // Several rooms on one reservation itemize per room; a normal stay
        // prints the single line it always has.
        const stayLines = invoice.roomLines?.length
            ? invoice.roomLines.map(r => ({
                desc: `Room ${r.roomNumber} (${r.nights}n)`,
                nights: r.nights,
                rate: r.nights > 0 ? r.stayCost / r.nights : r.stayCost,
                amount: r.stayCost,
            }))
            : [{
                desc: `Room Stay (${invoice.nights}n)`,
                nights: invoice.nights,
                rate: invoice.basePrice,
                amount: invoice.stayCost,
            }]

        for (const line of stayLines) {
            b.wrappedColumns([
                { text: line.desc, width: COL.desc },
                { text: String(line.nights), width: COL.qty, align: 'center' },
                { text: num(line.rate), width: COL.rate, align: 'right' },
                { text: num(line.amount), width: COL.amt, align: 'right' },
            ])
        }
    }

    for (const charge of invoice.manualCharges) {
        b.wrappedColumns([
            { text: charge.description, width: COL.desc },
            { text: '1', width: COL.qty, align: 'center' },
            { text: num(charge.amount), width: COL.rate, align: 'right' },
            { text: num(charge.amount), width: COL.amt, align: 'right' },
        ])
    }

    for (const item of invoice.qrOrders) {
        const name = invoice.type === 'room' ? `Food: ${item.name}` : item.name
        b.wrappedColumns([
            { text: name, width: COL.desc },
            { text: String(item.quantity), width: COL.qty, align: 'center' },
            { text: num(item.unitPrice), width: COL.rate, align: 'right' },
            { text: num(item.unitPrice * item.quantity), width: COL.amt, align: 'right' },
        ])
    }

    if (invoice.linkedOrders) {
        for (const item of invoice.linkedOrders) {
            b.wrappedColumns([
                { text: `Dine: ${item.name}`, width: COL.desc },
                { text: String(item.quantity), width: COL.qty, align: 'center' },
                { text: num(item.unitPrice), width: COL.rate, align: 'right' },
                { text: num(item.unitPrice * item.quantity), width: COL.amt, align: 'right' },
            ])
        }
    }

    b.divider()

    // Subtotal → extra hour → service charge → discount → tax → TOTAL, then the
    // advance comes off, and the figure the guest actually hands over closes the
    // bill. See summariseInvoice for why the tendered cash is not subtracted
    // here: it is reported below as the method of payment instead.
    const summary = summariseInvoice(invoice)

    for (const line of summary.lines) {
        b.columns([
            { text: line.label, width: LINE_WIDTH - 14 },
            { text: `${line.sign}${money(line.amount)}`, width: 14, align: 'right' },
        ])
    }

    b.bold(true)
    b.columns([{ text: 'TOTAL', width: LINE_WIDTH - 14 }, { text: money(summary.total), width: 14, align: 'right' }])
    b.bold(false)

    if (summary.advancePaid > 0) {
        const label = `LESS ADVANCE (${advanceMethodLabel(invoice.advanceMethod)})`
        b.columns([
            { text: label, width: LINE_WIDTH - 14 },
            { text: `-${money(summary.advancePaid)}`, width: 14, align: 'right' },
        ])
    }

    // The closing figure, and the last money on the bill — nothing but how it
    // was paid follows it.
    b.divider()
    b.size({ doubleHeight: true }).bold(true)
    b.line(`${summary.finalLabel}: ${money(summary.finalAmount)}`)
    b.size({}).bold(false)

    if (invoice.paymentMethod) {
        const label = invoice.paymentMethod === 'cash' ? 'CASH'
            : invoice.paymentMethod === 'qr_digital' ? 'QR / DIGITAL'
            : invoice.paymentMethod === 'credit' ? 'CREDIT'
            : invoice.paymentMethod === 'none' ? 'NOT YET'
            : 'SPLIT'
        b.line(`Payment: ${label}`)
        if (invoice.paymentMethod === 'cash') {
            if (invoice.cashGiven && invoice.cashGiven > 0) {
                b.line(`  Cash Given: ${money(invoice.cashGiven)}`)
            }
            if (invoice.changeReturned && invoice.changeReturned > 0.01) {
                b.line(`  Change Return: ${money(invoice.changeReturned)}`)
            }
        }
        if (invoice.paymentMethod === 'both') {
            b.line(`  Cash: ${money(invoice.cashPaid ?? 0)}`)
            if (invoice.cashGiven && invoice.cashGiven > 0) {
                b.line(`  Cash Given: ${money(invoice.cashGiven)}`)
            }
            if (invoice.changeReturned && invoice.changeReturned > 0.01) {
                b.line(`  Change Return: ${money(invoice.changeReturned)}`)
            }
            b.line(`  QR/Digital: ${money(invoice.qrPaid ?? 0)}`)
        }
        // Credit is the guest leaving owing money, so it is spelled out on
        // every method that can carry it, not just a split.
        if (invoice.creditPaid && invoice.creditPaid > 0.01) {
            b.bold(true)
            b.line(`  ON CREDIT: ${money(invoice.creditPaid)}`)
            b.bold(false)
        }
    }

    b.divider()
    b.align('center')
    b.line('*** THANK YOU! ***')
    b.line('WE HOPE TO SEE YOU AGAIN')

    b.divider()
    b.align('center')
    b.bold(true)
    b.line('IT IS NOT OFFICIAL BILL,')
    b.line('FOR OFFICIAL BILL ASK TO THE COUNTER')
    b.bold(false)
    b.divider()

    appendBrandFooter(b)

    return b.cut().build()
}
