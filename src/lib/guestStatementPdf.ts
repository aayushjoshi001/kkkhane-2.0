// The manager's downloadable guest statement: a stay's whole bill as a
// multi-page A4 document — the summary of charges, every payment taken against
// it, a day-by-day roll-up of room service, and every order itemized.
//
// It computes no money. Every figure here is read off the BookingBill that
// /api/bookings/bill already built server-side (lib/bookingBill.ts, over
// lib/folio.ts), because a statement that recomputed the bill would be a fourth
// copy of the folio arithmetic and would drift from the three that exist — the
// exact failure this repo has hit with the service charge, the VAT line and the
// checkout total. The only sums below are of already-billed per-order figures,
// and where such a sum cannot equal the bill's own total (a cashier who typed
// over the service charge) the difference is printed as its own line rather
// than left as a breakdown that does not add up.

import { jsPDF } from 'jspdf'
import { drawTable, type PdfColumn } from './exportPdf'
import type { BookingBill, BookingBillOrder } from './bookingBill'
import { formatDate, formatDateTime, formatTime, DEFAULT_CALENDAR, type Calendar } from './calendar'
import { getNstDateString } from './timezone'

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const amount = (n: number) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Who the statement is issued by — the letterhead, straight off the tenant. */
export interface GuestStatementBusiness {
    name: string
    address?: string | null
    contactPhone?: string | null
    telephone?: string | null
    panNumber?: string | null
    vatNumber?: string | null
    vatRegistered?: boolean | null
}

// A4 in mm, matching lib/exportPdf.ts so both documents sit on the same grid.
const MARGIN = 12
const PAGE_W = 210
const PAGE_H = 297
const CONTENT_W = PAGE_W - MARGIN * 2
const MAX_Y = PAGE_H - 16

const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [100, 116, 139]
const RULE: [number, number, number] = [209, 213, 219]
const BRAND: [number, number, number] = [251, 99, 3]
const DUE: [number, number, number] = [179, 38, 30]

/** Starts a fresh page when `needed` mm would not fit, and returns the y to
 *  carry on at. Every block below asks before it draws, so nothing straddles a
 *  page break mid-row. */
function room(doc: jsPDF, y: number, needed: number): number {
    if (y + needed <= MAX_Y) return y
    doc.addPage()
    return MARGIN + 5
}

function heading(doc: jsPDF, y: number, text: string): number {
    const top = room(doc, y, 12)
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(text.toUpperCase(), MARGIN, top)
    doc.setLineWidth(0.3)
    doc.setDrawColor(...INK)
    doc.line(MARGIN, top + 1.6, MARGIN + CONTENT_W, top + 1.6)
    return top + 6
}

/** The letterhead and the document's own title, drawn once on page one. */
function drawLetterhead(doc: jsPDF, business: GuestStatementBusiness, bill: BookingBill, calendar: Calendar): number {
    let y = MARGIN + 5

    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...INK)
    doc.text(business.name, MARGIN, y)

    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...BRAND)
    doc.text('GUEST STATEMENT', MARGIN + CONTENT_W, y, { align: 'right' })

    y += 5
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)

    const contact = [business.address, [business.telephone && `Tel ${business.telephone}`, business.contactPhone && `Mob ${business.contactPhone}`].filter(Boolean).join(' · '), [business.panNumber && `PAN ${business.panNumber}`, business.vatNumber && `VAT ${business.vatNumber}`].filter(Boolean).join(' · ')]
        .filter(Boolean)
        .join('\n')
    const leftLines = doc.splitTextToSize(contact, CONTENT_W * 0.55)
    doc.text(leftLines, MARGIN, y)

    const rightLines = [
        `Ref ${bill.settlement?.invoiceNumber || bill.bookingId.slice(0, 8)}`,
        `Issued ${formatDateTime(new Date(), calendar)}`,
        bill.mode === 'issued' ? 'The bill as issued at checkout' : 'Running bill — not yet settled',
    ]
    doc.text(rightLines, MARGIN + CONTENT_W, y, { align: 'right' })

    y += Math.max(leftLines.length, rightLines.length) * 3.4 + 2
    doc.setLineWidth(0.8)
    doc.setDrawColor(...BRAND)
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y)
    return y + 6
}

/** Three key/value boxes across the page: who, which stay, how it was billed. */
function drawMetaCards(doc: jsPDF, y: number, bill: BookingBill, calendar: Calendar): number {
    const roomNumbers = bill.rooms.map(r => r.roomNumber).filter(Boolean)
    const roomLabel = roomNumbers.length > 1 ? `Rooms ${roomNumbers.join(', ')}` : `Room ${roomNumbers[0] || '—'}`
    const roomType = bill.rooms[0]?.roomType

    const cards: Array<{ title: string; rows: Array<[string, string]> }> = [
        {
            title: 'Guest',
            rows: [
                ['Name', bill.guestName || '—'],
                ['Phone', bill.guestPhone || '—'],
                ['Address', bill.guestAddress || '—'],
                ...(bill.parkingVehicleNo ? ([['Vehicle', bill.parkingVehicleNo]] as Array<[string, string]>) : []),
            ],
        },
        {
            title: 'Stay',
            rows: [
                ['Room', roomType ? `${roomLabel} · ${roomType}` : roomLabel],
                ['Arrived', formatDate(bill.checkIn, calendar, { withYear: false })],
                ['Departed', bill.checkedOutAt ? formatDate(bill.checkedOutAt, calendar, { withYear: false }) : 'Still in house'],
                ['Nights billed', nightsLabel(bill)],
            ],
        },
        {
            title: 'Billing',
            rows: [
                ['Status', bill.status.replace(/_/g, ' ')],
                ['Checked in by', bill.checkedInBy || '—'],
                ['Checked out by', bill.checkedOutBy || '—'],
                ['Room rate', bill.customRatePerNight > 0 ? `${amount(bill.customRatePerNight)} (agreed)` : bill.rooms[0]?.nightlyRate ? amount(bill.rooms[0].nightlyRate) : '—'],
            ],
        },
    ]

    const gap = 4
    const cardW = (CONTENT_W - gap * 2) / 3
    // Every card is drawn to the height of the tallest, so the row of boxes
    // has one baseline however many lines a wrapped address takes.
    const cardH = Math.max(...cards.map(c => c.rows.length)) * 3.9 + 8.5
    const top = room(doc, y, cardH + 2)

    cards.forEach((card, i) => {
        const x = MARGIN + i * (cardW + gap)
        doc.setDrawColor(...RULE)
        doc.setLineWidth(0.25)
        doc.roundedRect(x, top, cardW, cardH, 1.5, 1.5, 'S')

        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(6.4)
        doc.setTextColor(...MUTED)
        doc.text(card.title.toUpperCase(), x + 3, top + 4.2)

        let ry = top + 8.6
        card.rows.forEach(([label, value]) => {
            doc.setFont('Helvetica', 'normal')
            doc.setFontSize(6.8)
            doc.setTextColor(...MUTED)
            doc.text(label, x + 3, ry)
            doc.setFont('Helvetica', 'bold')
            doc.setFontSize(7.2)
            doc.setTextColor(...INK)
            // Truncated to the box rather than wrapped: these are one-line
            // facts, and a wrap would push every other card out of alignment.
            // Ellipsised when it does not fit, so a cut value reads as cut
            // rather than as a shorter value than the one on file.
            const avail = Math.max(cardW - 6 - doc.getTextWidth(label) - 2, 12)
            doc.text(truncate(doc, value, avail), x + cardW - 3, ry, { align: 'right' })
            ry += 3.9
        })
    })

    return top + cardH + 5
}

/** `value` shortened to fit `width` mm at the current font, with an ellipsis. */
function truncate(doc: jsPDF, value: string, width: number): string {
    if (doc.getTextWidth(value) <= width) return value
    let cut = value
    while (cut.length > 1 && doc.getTextWidth(`${cut}...`) > width) cut = cut.slice(0, -1)
    return `${cut}...`
}

function nightsLabel(bill: BookingBill): string {
    const late = bill.rooms.reduce((s, r) => s + (r.lateNights || 0), 0)
    if (late <= 0) return String(bill.nights)
    return `${bill.nights} (incl. ${late} late)`
}

/** One label/amount line in the summary block. */
function summaryLine(doc: jsPDF, y: number, label: string, value: string, opts: { bold?: boolean; note?: string; color?: [number, number, number]; rule?: 'thin' | 'thick' | 'none' } = {}): number {
    const top = room(doc, y, 7)
    doc.setFont('Helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.bold ? 9.5 : 8.2)
    doc.setTextColor(...(opts.color ?? INK))
    doc.text(label, MARGIN + 1, top)
    doc.text(value, MARGIN + CONTENT_W - 1, top, { align: 'right' })

    let next = top + (opts.bold ? 4 : 3.4)
    if (opts.note) {
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(6.6)
        doc.setTextColor(...MUTED)
        doc.text(opts.note, MARGIN + 1, next)
        next += 3
    }
    if (opts.rule !== 'none') {
        doc.setLineWidth(opts.rule === 'thick' ? 0.6 : 0.15)
        doc.setDrawColor(...(opts.rule === 'thick' ? BRAND : RULE))
        doc.line(MARGIN, next - 1.4, MARGIN + CONTENT_W, next - 1.4)
    }
    return next + 1.4
}

function drawSummary(doc: jsPDF, y: number, bill: BookingBill): number {
    const { totals, payments } = bill
    let cursor = heading(doc, y, 'Summary of charges')

    for (const line of bill.rooms) {
        const late = line.lateNights > 0 ? `, incl. ${line.lateNights} late-checkout night${line.lateNights === 1 ? '' : 's'}` : ''
        cursor = summaryLine(
            doc,
            cursor,
            `Room accommodation — Room ${line.roomNumber}${line.roomType ? ` (${line.roomType})` : ''}`,
            amount(line.stayCost),
            { note: `${line.nights} night${line.nights === 1 ? '' : 's'}${line.nightlyRate > 0 ? ` @ ${amount(line.nightlyRate)}` : ''}${late}` },
        )
    }
    if (bill.rooms.length === 0) {
        cursor = summaryLine(doc, cursor, 'Room accommodation', amount(totals.stayCost))
    }
    if (totals.roomDiscount > 0) {
        cursor = summaryLine(doc, cursor, 'Less: room discount', `(${amount(totals.roomDiscount)})`, { note: 'Bargain rate agreed at the desk' })
    }
    for (const charge of bill.charges) {
        cursor = summaryLine(doc, cursor, `${charge.description}`, amount(charge.amount), { note: charge.chargeType.replace(/_/g, ' ') })
    }

    const billedOrders = bill.orders.filter(o => o.billed)
    cursor = summaryLine(doc, cursor, `Food & beverage — ${billedOrders.length} order${billedOrders.length === 1 ? '' : 's'}`, amount(round2(totals.ordersTotal - totals.serviceCharge)), {
        note: 'Room service and orders billed to the stay, before the service charge',
    })
    if (totals.serviceCharge > 0 || totals.serviceChargeOverridden) {
        cursor = summaryLine(doc, cursor, 'Room service charge', amount(totals.serviceCharge), {
            note: totals.serviceChargeOverridden
                ? `Set by the cashier — the rules produced ${amount(totals.serviceChargeAuto)}`
                : '10% on kitchen items, on rooms where it applies',
        })
    }
    if (totals.vat > 0) {
        cursor = summaryLine(doc, cursor, 'VAT', amount(totals.vat), { note: 'On the room and manual charges only' })
    }
    if (totals.extraHourCharge > 0) {
        cursor = summaryLine(doc, cursor, 'Extra hour charge', amount(totals.extraHourCharge), { note: 'Late departure, charged at the till' })
    }
    // Said out loud rather than folded into a subtotal that would then not
    // reconcile against the figure the guest was actually charged.
    const adjustment = round2(totals.adjustment - totals.extraHourCharge)
    if (Math.abs(adjustment) > 0.01) {
        cursor = summaryLine(doc, cursor, 'Adjustment at checkout', amount(adjustment), { note: 'Charged on the bill but not attributable to a line above' })
    }

    cursor = summaryLine(doc, cursor, bill.mode === 'issued' ? 'TOTAL CHARGED' : 'TOTAL SO FAR', amount(totals.total), { bold: true, rule: 'thick' })

    if (payments.collectedTotal > 0) {
        cursor = summaryLine(doc, cursor, 'Less: received', `(${amount(payments.collectedTotal)})`)
    }
    if (payments.returnToGuest > 0.01) {
        cursor = summaryLine(doc, cursor, 'RETURN TO GUEST', amount(payments.returnToGuest), { bold: true, note: 'Taken in advance beyond the bill' })
    } else if (payments.credit > 0.01) {
        cursor = summaryLine(doc, cursor, 'BALANCE ON CREDIT ACCOUNT', amount(payments.credit), { bold: true, color: DUE, note: 'Posted to the guest\'s ledger account at checkout' })
    } else if (payments.uncollected > 0.01) {
        cursor = summaryLine(doc, cursor, 'NOT COLLECTED', amount(payments.uncollected), { bold: true, color: DUE, note: 'Charged but never handed over — on the guest\'s account, or still owed' })
    } else {
        cursor = summaryLine(doc, cursor, bill.mode === 'issued' ? 'SETTLED IN FULL' : 'STILL TO COLLECT', amount(payments.netDue), { bold: true, color: payments.netDue > 0.01 ? DUE : INK })
    }

    return cursor + 3
}

const PAY_COLUMNS: PdfColumn[] = [
    { key: 'when', label: 'Date & time', weight: 3 },
    { key: 'kind', label: 'Type', weight: 2 },
    { key: 'method', label: 'Method', weight: 2 },
    { key: 'amount', label: 'Amount', align: 'right', weight: 1.6 },
]

function drawPayments(doc: jsPDF, y: number, bill: BookingBill, calendar: Calendar): number {
    const { payments, settlement } = bill
    const rows: Record<string, string>[] = []

    const advanceWhen = bill.checkedInAt ? formatDateTime(bill.checkedInAt, calendar) : '—'
    if (payments.advanceSplitKnown) {
        if (payments.advanceCash > 0) rows.push({ when: advanceWhen, kind: 'Advance', method: 'Cash', amount: amount(payments.advanceCash) })
        if (payments.advanceQr > 0) rows.push({ when: advanceWhen, kind: 'Advance', method: 'QR / digital', amount: amount(payments.advanceQr) })
    } else if (payments.advanceTotal > 0) {
        rows.push({ when: advanceWhen, kind: 'Advance', method: `${(payments.advanceMethod || 'unknown').replace(/_/g, ' ')} — split not recorded`, amount: amount(payments.advanceTotal) })
    }

    const settledWhen = settlement ? formatDateTime(settlement.at, calendar) : '—'
    if (payments.settlementCash > 0) rows.push({ when: settledWhen, kind: 'At checkout', method: 'Cash', amount: amount(payments.settlementCash) })
    if (payments.settlementQr > 0) rows.push({ when: settledWhen, kind: 'At checkout', method: 'QR / digital', amount: amount(payments.settlementQr) })
    if (payments.credit > 0) rows.push({ when: settledWhen, kind: 'At checkout', method: 'Credit — guest ledger account', amount: amount(payments.credit) })
    if (payments.uncollected > 0.01) rows.push({ when: settledWhen, kind: 'At checkout', method: 'Not collected', amount: amount(payments.uncollected) })

    if (rows.length === 0) {
        const top = heading(doc, y, 'Payments & settlement')
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(7.5)
        doc.setTextColor(...MUTED)
        doc.text('Nothing has been received against this stay yet.', MARGIN + 1, top)
        return top + 6
    }

    let cursor = heading(doc, y, 'Payments & settlement')
    cursor = drawTable(doc, cursor, PAY_COLUMNS, rows, {
        when: 'Applied against the bill',
        kind: '',
        method: '',
        amount: amount(round2(payments.collectedTotal + payments.credit + payments.uncollected)),
    }, MARGIN, CONTENT_W, MAX_Y)

    if (payments.detail === 'reconstructed') {
        cursor = room(doc, cursor + 2, 8)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(6.6)
        doc.setTextColor(...MUTED)
        doc.text(
            doc.splitTextToSize('Rebuilt from the booking record and the checkout snapshot — this stay predates the payments table, so the cash/QR split is only as detailed as those could say.', CONTENT_W),
            MARGIN,
            cursor,
        )
        cursor += 6
    }
    return cursor + 4
}

/** One row per calendar day in Nepal time, so the days line up with the
 *  business day the rest of the books are kept in. */
interface StatementDay {
    date: string
    orders: BookingBillOrder[]
    subtotal: number
    serviceCharge: number
    total: number
}

export function groupOrdersByNstDay(orders: BookingBillOrder[]): StatementDay[] {
    const byDate = new Map<string, StatementDay>()
    for (const order of orders) {
        const date = getNstDateString(new Date(order.placedAt))
        const day = byDate.get(date) ?? { date, orders: [], subtotal: 0, serviceCharge: 0, total: 0 }
        day.orders.push(order)
        day.subtotal = round2(day.subtotal + order.subtotal)
        day.serviceCharge = round2(day.serviceCharge + order.serviceCharge)
        day.total = round2(day.total + order.billedTotal)
        byDate.set(date, day)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const DAY_COLUMNS: PdfColumn[] = [
    { key: 'date', label: 'Date', weight: 3 },
    { key: 'orders', label: 'Orders', align: 'right', weight: 1.2 },
    { key: 'subtotal', label: 'F&B subtotal', align: 'right', weight: 2 },
    { key: 'service', label: 'Service charge', align: 'right', weight: 2 },
    { key: 'total', label: 'Day total', align: 'right', weight: 2 },
]

function drawDailySummary(doc: jsPDF, y: number, bill: BookingBill, days: StatementDay[], calendar: Calendar): number {
    if (days.length === 0) return y

    const billedTotal = round2(days.reduce((s, d) => s + d.total, 0))
    // Header, one row per day, the totals row and the note beneath it. drawTable
    // will paginate mid-table quite happily — and did, leaving a page holding
    // nothing but the totals row — so the whole block asks for its space first.
    // drawTable's own row geometry, rounded up: a five-column table renders at
    // ~6mm a row, ~10mm of header and ~7mm of totals, plus this section's
    // heading and the note under it. Erring high costs an early page break;
    // erring low is what stranded the totals row on a page of its own.
    let cursor = room(doc, y, 30 + days.length * 6.2)
    cursor = heading(doc, cursor, 'Daily transaction summary')
    cursor = drawTable(
        doc,
        cursor,
        DAY_COLUMNS,
        days.map(d => ({
            date: formatDate(`${d.date}T00:00:00+05:45`, calendar),
            orders: String(d.orders.length),
            subtotal: amount(d.subtotal),
            service: amount(d.serviceCharge),
            total: amount(d.total),
        })),
        {
            date: `${days.length} day${days.length === 1 ? '' : 's'}`,
            orders: String(days.reduce((s, d) => s + d.orders.length, 0)),
            subtotal: amount(round2(days.reduce((s, d) => s + d.subtotal, 0))),
            service: amount(round2(days.reduce((s, d) => s + d.serviceCharge, 0))),
            total: amount(billedTotal),
        },
        MARGIN,
        CONTENT_W,
        MAX_Y,
    )

    // The day rows carry the service charge the rules produced. When a cashier
    // typed over it, the bill's food total is that figure shifted by the
    // difference — so state the difference instead of printing a table that
    // silently fails to add up to the line in the summary above.
    const delta = round2(bill.totals.ordersTotal - billedTotal)
    const notes: string[] = []
    if (Math.abs(delta) > 0.01) {
        notes.push(`The cashier set the service charge by hand: the bill's food and beverage total is ${amount(bill.totals.ordersTotal)}, ${delta > 0 ? 'above' : 'below'} the ${amount(billedTotal)} these days add up to by ${amount(Math.abs(delta))}.`)
    }
    notes.push('Room accommodation is billed separately and is not included in the figures above.')

    cursor = room(doc, cursor + 2, 10)
    doc.setFont('Helvetica', 'italic')
    doc.setFontSize(6.6)
    doc.setTextColor(...MUTED)
    const lines = doc.splitTextToSize(notes.join(' '), CONTENT_W)
    doc.text(lines, MARGIN, cursor)
    return cursor + lines.length * 3 + 4
}

const KIND_LABEL: Record<BookingBillOrder['kind'], string> = {
    room_qr: 'In-room QR',
    dining_table: 'Restaurant table',
    direct: 'Placed at the desk',
}

/** The order log: a banded header per day, then each order with its lines. */
function drawOrderLog(doc: jsPDF, y: number, days: StatementDay[], calendar: Calendar): number {
    if (days.length === 0) return y

    // Flows on from whatever came before rather than claiming a page of its
    // own: the summary blocks above already break where they must, and forcing
    // a break here left half-empty pages either side of it. It only needs room
    // for its heading and the first day's band.
    let cursor = heading(doc, room(doc, y + 3, 34), 'Itemised order log')

    for (const day of days) {
        cursor = room(doc, cursor, 16)

        doc.setFillColor(27, 36, 48)
        doc.rect(MARGIN, cursor - 3.2, CONTENT_W, 5.6, 'F')
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(7.4)
        doc.setTextColor(255, 255, 255)
        doc.text(formatDate(`${day.date}T00:00:00+05:45`, calendar), MARGIN + 2, cursor)
        doc.text(`${day.orders.length} order${day.orders.length === 1 ? '' : 's'} · ${amount(day.total)}`, MARGIN + CONTENT_W - 2, cursor, { align: 'right' })
        cursor += 5.6

        for (const order of day.orders) {
            cursor = drawOrder(doc, cursor, order)
        }
        cursor += 2.5
    }
    return cursor
}

function drawOrder(doc: jsPDF, y: number, order: BookingBillOrder): number {
    // Header plus at least the first line, so an order never opens at the very
    // foot of a page with its items stranded on the next one.
    let cursor = room(doc, y, 11)

    doc.setFillColor(247, 249, 251)
    doc.rect(MARGIN, cursor - 3, CONTENT_W, 4.8, 'F')
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(6.9)
    doc.setTextColor(...INK)
    doc.text(`${formatTime(order.placedAt)}  ·  ${order.ref}  ·  ${KIND_LABEL[order.kind]}${order.tableLabel ? ` (${order.tableLabel})` : ''}`, MARGIN + 2, cursor)
    doc.text(order.billed ? amount(order.billedTotal) : 'not billed', MARGIN + CONTENT_W - 2, cursor, { align: 'right' })
    cursor += 5

    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(6.8)
    for (const item of order.items) {
        cursor = room(doc, cursor, 5)
        doc.setTextColor(...INK)
        const name = item.variation ? `${item.name} (${item.variation})` : item.name
        doc.text(doc.splitTextToSize(name, CONTENT_W * 0.55)[0] ?? name, MARGIN + 5, cursor)
        doc.setTextColor(...MUTED)
        doc.text(String(item.quantity), MARGIN + CONTENT_W * 0.66, cursor, { align: 'right' })
        doc.text(amount(item.unitPrice), MARGIN + CONTENT_W * 0.82, cursor, { align: 'right' })
        doc.setTextColor(...INK)
        doc.text(amount(item.lineTotal), MARGIN + CONTENT_W - 2, cursor, { align: 'right' })
        cursor += 3.4
    }

    if (order.serviceCharge > 0) {
        cursor = room(doc, cursor, 5)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(6.6)
        doc.setTextColor(...MUTED)
        doc.text('Service charge', MARGIN + 5, cursor)
        doc.text(amount(order.serviceCharge), MARGIN + CONTENT_W - 2, cursor, { align: 'right' })
        cursor += 3.4
    }

    // An order the folio never counted is still listed — somebody placed it
    // against this room — but it must be unmistakable that it was not charged.
    if (!order.billed) {
        cursor = room(doc, cursor, 5)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(6.6)
        doc.setTextColor(...MUTED)
        doc.text(
            order.status === 'cancelled'
                ? 'Cancelled — not on this bill'
                : 'Not on this bill — placed after it was issued, or against another stay',
            MARGIN + 5,
            cursor,
        )
        cursor += 3.4
    }

    doc.setLineWidth(0.1)
    doc.setDrawColor(...RULE)
    doc.line(MARGIN, cursor - 2, MARGIN + CONTENT_W, cursor - 2)
    return cursor + 1
}

/** Page numbers and the running footer, stamped once every page exists. */
function stampFooter(doc: jsPDF, bill: BookingBill, business: GuestStatementBusiness): void {
    const pages = doc.getNumberOfPages()
    for (let page = 1; page <= pages; page++) {
        doc.setPage(page)
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(6.2)
        doc.setTextColor(...MUTED)
        doc.text(`${business.name} · Guest statement · ${bill.guestName}`, MARGIN, PAGE_H - 8)
        doc.text(`Page ${page} of ${pages}`, MARGIN + CONTENT_W, PAGE_H - 8, { align: 'right' })
    }
}

/**
 * Build the statement for one stay. `bill` is the payload of
 * GET /api/bookings/bill — pass it through untouched.
 */
export function buildGuestStatementDoc(
    bill: BookingBill,
    business: GuestStatementBusiness,
    opts: { calendar?: Calendar } = {},
): jsPDF {
    const calendar = opts.calendar ?? DEFAULT_CALENDAR
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

    // Only orders the folio actually charged shape the day roll-up; the ones it
    // did not are still printed in the log below, marked as such.
    const days = groupOrdersByNstDay(bill.orders.filter(o => o.billed))
    const unbilled = bill.orders.filter(o => !o.billed)
    const logDays = groupOrdersByNstDay(bill.orders)

    let y = drawLetterhead(doc, business, bill, calendar)
    y = drawMetaCards(doc, y, bill, calendar)
    y = drawSummary(doc, y, bill)
    y = drawPayments(doc, y, bill, calendar)
    y = drawDailySummary(doc, y, bill, days, calendar)

    if (unbilled.length > 0) {
        y = room(doc, y, 10)
        doc.setFont('Helvetica', 'italic')
        doc.setFontSize(6.6)
        doc.setTextColor(...MUTED)
        doc.text(
            doc.splitTextToSize(`${unbilled.length} order${unbilled.length === 1 ? '' : 's'} placed against this room ${unbilled.length === 1 ? 'was' : 'were'} not charged on this bill. ${unbilled.length === 1 ? 'It is' : 'They are'} listed in the order log and marked as not billed.`, CONTENT_W),
            MARGIN,
            y,
        )
    }

    drawOrderLog(doc, y, logDays, calendar)
    stampFooter(doc, bill, business)
    return doc
}

/** Filename that sorts by guest then stay, and never collides across stays. */
export function guestStatementFilename(bill: BookingBill): string {
    const slug = (bill.guestName || 'guest').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guest'
    return `statement-${slug}-${bill.checkIn.slice(0, 10)}-${bill.bookingId.slice(0, 8)}.pdf`
}

/** Build and save it, the way the other admin exports do. */
export function downloadGuestStatement(
    bill: BookingBill,
    business: GuestStatementBusiness,
    opts: { calendar?: Calendar } = {},
): void {
    buildGuestStatementDoc(bill, business, opts).save(guestStatementFilename(bill))
}
