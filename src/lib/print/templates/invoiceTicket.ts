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
    qrOrders: InvoiceLineItem[]
    qrOrdersTotal: number
    linkedOrders?: InvoiceLineItem[]
    linkedOrdersTotal?: number
    manualCharges: InvoiceManualCharge[]
    manualChargesTotal: number
    subtotal?: number
    serviceCharge?: number
    taxAmount?: number
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
        b.wrappedColumns([
            { text: `Room Stay (${invoice.nights}n)`, width: COL.desc },
            { text: String(invoice.nights), width: COL.qty, align: 'center' },
            { text: num(invoice.basePrice), width: COL.rate, align: 'right' },
            { text: num(invoice.stayCost), width: COL.amt, align: 'right' },
        ])
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
    const itemsSubtotal = (invoice.type === 'room' ? (invoice.stayCost || 0) : 0) +
        (invoice.manualChargesTotal || 0) +
        (invoice.qrOrdersTotal || 0) +
        (invoice.linkedOrdersTotal || 0)
    const subtotalVal = invoice.subtotal ?? itemsSubtotal

    b.bold(true)
    b.columns([{ text: 'SUB TOTAL', width: LINE_WIDTH - 14 }, { text: money(subtotalVal), width: 14, align: 'right' }])
    b.bold(false)

    if (invoice.extraHourCharge && invoice.extraHourCharge > 0) {
        b.columns([{ text: 'EXTRA HOUR CHARGE', width: LINE_WIDTH - 14 }, { text: `+${money(invoice.extraHourCharge)}`, width: 14, align: 'right' }])
    }
    if (invoice.serviceCharge && invoice.serviceCharge > 0) {
        b.columns([{ text: 'SERVICE CHARGE', width: LINE_WIDTH - 14 }, { text: `+${money(invoice.serviceCharge)}`, width: 14, align: 'right' }])
    }
    if (invoice.taxAmount && invoice.taxAmount > 0) {
        b.columns([{ text: 'TAX / VAT', width: LINE_WIDTH - 14 }, { text: `+${money(invoice.taxAmount)}`, width: 14, align: 'right' }])
    }
    if (invoice.discountAmount && invoice.discountAmount > 0) {
        b.columns([{ text: 'DISCOUNT', width: LINE_WIDTH - 14 }, { text: `-${money(invoice.discountAmount)}`, width: 14, align: 'right' }])
    }
    b.divider()
    b.size({ doubleWidth: true, doubleHeight: true }).bold(true)
    b.line(`GRAND TOTAL: ${money(invoice.total)}`)
    b.size({}).bold(false)

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
        if (invoice.paymentMethod === 'cash') {
            if (invoice.cashGiven && invoice.cashGiven > 0) {
                b.line(`  Cash Given: ${money(invoice.cashGiven)}`)
            }
            if (invoice.changeReturned && invoice.changeReturned > 0.01) {
                b.line(`  Change Return: ${money(invoice.changeReturned)}`)
            }
            if (invoice.creditPaid && invoice.creditPaid > 0.01) {
                b.bold(true)
                b.line(`  Remaining Credit: ${money(invoice.creditPaid)}`)
                b.bold(false)
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
            if (invoice.creditPaid && invoice.creditPaid > 0.01) {
                b.bold(true)
                b.line(`  Remaining Credit: ${money(invoice.creditPaid)}`)
                b.bold(false)
            }
        }
        if (invoice.paymentMethod === 'credit' && invoice.creditPaid) {
            b.bold(true)
            b.line(`  Remaining Credit: ${money(invoice.creditPaid)}`)
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
