// Builds the ESC/POS byte stream for a settled table/room invoice — the
// thermal-print equivalent of the receipt markup in CashierClient.tsx's
// invoice modal. Kept in sync with that JSX; if the on-screen receipt layout
// changes, mirror the change here too.

import { EscPosBuilder, LINE_WIDTH, wrapTextToByteWidth } from '../escpos'
import { advanceMethodLabel, formatInvoiceAddress } from '@/lib/utils'
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
    b.line(`REF: ${invoice.label.toUpperCase()}`)
    if (invoice.roomType) b.line(`TYPE: ${invoice.roomType}`)
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
    const rawSubtotal = invoice.subtotal != null ? invoice.subtotal : ((invoice.stayCost || 0) + (invoice.qrOrdersTotal || 0) + (invoice.linkedOrdersTotal || 0) + (invoice.manualChargesTotal || 0) + (invoice.extraHourCharge || 0))
    const scAmount = invoice.serviceCharge || invoice.service_charge_amount || 0
    const taxAmount = invoice.taxAmount || invoice.tax_amount || 0
    const discount = invoice.discountAmount || 0

    b.columns([{ text: 'SUBTOTAL', width: LINE_WIDTH - 14 }, { text: money(rawSubtotal), width: 14, align: 'right' }])
    if (scAmount > 0) {
        b.columns([{ text: 'SERVICE CHARGE', width: LINE_WIDTH - 14 }, { text: `+${money(scAmount)}`, width: 14, align: 'right' }])
    }
    if (discount > 0) {
        b.columns([{ text: 'DISCOUNT', width: LINE_WIDTH - 14 }, { text: `-${money(discount)}`, width: 14, align: 'right' }])
    }
    if (taxAmount > 0) {
        b.columns([{ text: 'TAX (VAT)', width: LINE_WIDTH - 14 }, { text: `+${money(taxAmount)}`, width: 14, align: 'right' }])
    }
    b.bold(true)
    b.columns([{ text: 'GRAND TOTAL', width: LINE_WIDTH - 14 }, { text: money(invoice.total), width: 14, align: 'right' }])
    b.bold(false)

    if (invoice.advancePaid && invoice.advancePaid > 0) {
        const label = `Advance (${advanceMethodLabel(invoice.advanceMethod)})`
        b.columns([{ text: label, width: LINE_WIDTH - 14 }, { text: `-${money(invoice.advancePaid)}`, width: 14, align: 'right' }])
    }

    b.divider()
    b.size({ doubleHeight: true }).bold(true)
    const totalReceived = (invoice.cashPaid ?? 0) + (invoice.qrPaid ?? 0) + (invoice.advancePaid ?? 0)
    const effectiveDue = Math.max(0, invoice.total - totalReceived)
    const dueLabel = (invoice.advancePaid && invoice.advancePaid > 0) || totalReceived > 0 || (invoice.creditPaid && invoice.creditPaid > 0) ? 'BALANCE DUE' : 'TOTAL DUE'
    b.line(`${dueLabel}: ${money(effectiveDue)}`)
    b.size({}).bold(false)

    if (invoice.paymentMethod) {
        const label = invoice.paymentMethod === 'cash' ? 'CASH'
            : invoice.paymentMethod === 'qr_digital' ? 'QR / DIGITAL'
            : invoice.paymentMethod === 'credit' ? 'CREDIT'
            : invoice.paymentMethod === 'none' ? 'NOT YET'
            : 'SPLIT'
        b.line(`Payment: ${label}`)
        if (invoice.paymentMethod === 'both') {
            b.line(`  Cash: ${money(invoice.cashPaid ?? 0)}`)
            b.line(`  QR/Digital: ${money(invoice.qrPaid ?? 0)}`)
            if (invoice.creditPaid) {
                b.line(`  On credit: ${money(invoice.creditPaid)}`)
            }
        }
        if (invoice.paymentMethod === 'credit' && invoice.creditPaid) {
            b.line(`  On credit: ${money(invoice.creditPaid)}`)
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
