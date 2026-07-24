// Builds the ESC/POS byte stream for a settled table/room invoice — the
// thermal-print equivalent of the receipt markup in CashierClient.tsx's
// invoice modal. Kept in sync with that JSX; if the on-screen receipt layout
// changes, mirror the change here too.

import { EscPosBuilder, LINE_WIDTH } from '../escpos'
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
    total: number
    advancePaid?: number
    advanceMethod?: AdvancePaymentMethod | null
    balanceDue?: number
    paymentMethod?: 'cash' | 'qr_digital' | 'both' | 'credit'
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
    restaurantName = 'KKHANE HOTEL & RESTAURANT',
    restaurantAddress = '',
    restaurantPhone = '',
    // Printed invoices carry Bikram Sambat first, like the rest of the app. Not
    // a hook — this builds raw ESC/POS bytes outside React — so the cashier's
    // current choice is passed in from the component that triggers the print.
    calendar: Calendar = DEFAULT_CALENDAR,
): Uint8Array {
    const b = new EscPosBuilder().init()

    b.align('center').bold(true).line(restaurantName).bold(false)
    const formattedAddress = formatInvoiceAddress(restaurantAddress)
    if (formattedAddress) {
        b.line(formattedAddress)
    }
    b.line('*** INVOICE ***')
    b.line(`No: INV-${invoice.id.slice(0, 8).toUpperCase()}`)
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
        b.columns([
            { text: `Room Stay (${invoice.nights}n)`, width: COL.desc },
            { text: String(invoice.nights), width: COL.qty, align: 'center' },
            { text: money(invoice.basePrice), width: COL.rate, align: 'right' },
            { text: money(invoice.stayCost), width: COL.amt, align: 'right' },
        ])
    }

    for (const charge of invoice.manualCharges) {
        b.columns([
            { text: charge.description, width: COL.desc },
            { text: '1', width: COL.qty, align: 'center' },
            { text: money(charge.amount), width: COL.rate, align: 'right' },
            { text: money(charge.amount), width: COL.amt, align: 'right' },
        ])
    }

    for (const item of invoice.qrOrders) {
        const name = invoice.type === 'room' ? `Food: ${item.name}` : item.name
        b.columns([
            { text: name, width: COL.desc },
            { text: String(item.quantity), width: COL.qty, align: 'center' },
            { text: money(item.unitPrice), width: COL.rate, align: 'right' },
            { text: money(item.unitPrice * item.quantity), width: COL.amt, align: 'right' },
        ])
    }

    if (invoice.linkedOrders) {
        for (const item of invoice.linkedOrders) {
            b.columns([
                { text: `Dine: ${item.name}`, width: COL.desc },
                { text: String(item.quantity), width: COL.qty, align: 'center' },
                { text: money(item.unitPrice), width: COL.rate, align: 'right' },
                { text: money(item.unitPrice * item.quantity), width: COL.amt, align: 'right' },
            ])
        }
    }

    b.divider()
    if (invoice.extraHourCharge && invoice.extraHourCharge > 0) {
        b.columns([{ text: 'EXTRA HOUR CHARGE', width: LINE_WIDTH - 14 }, { text: money(invoice.extraHourCharge), width: 14, align: 'right' }])
    }
    if (invoice.discountAmount && invoice.discountAmount > 0) {
        b.columns([{ text: 'TOTAL DISCOUNT', width: LINE_WIDTH - 14 }, { text: `-${money(invoice.discountAmount)}`, width: 14, align: 'right' }])
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
    const dueLabel = invoice.advancePaid && invoice.advancePaid > 0 ? 'BALANCE DUE' : 'TOTAL DUE'
    b.line(`${dueLabel}: ${money(invoice.balanceDue ?? invoice.total)}`)
    b.size({}).bold(false)

    if (invoice.paymentMethod) {
        const label = invoice.paymentMethod === 'cash' ? 'CASH'
            : invoice.paymentMethod === 'qr_digital' ? 'QR / DIGITAL'
            : invoice.paymentMethod === 'credit' ? 'CREDIT'
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

    appendBrandFooter(b)

    return b.cut().build()
}
