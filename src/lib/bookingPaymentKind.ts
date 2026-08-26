// What a booking_payments row is: money taken before the bill was settled, or
// the settlement of the bill itself.
//
// This used to be read straight off `note === 'Settlement'`, the literal string
// the checkout route writes. `note` is free text the front desk types on the
// advance form, so a clerk who wrote "Settlement" into their own deposit had it
// counted as one: bookingBill dropped it from advanceTotal and the guest was
// asked for the whole bill a second time.
//
// booking_payments.payment_kind now carries it. The note fallback stays for rows
// written before that column existed, and for anything a previous release writes
// mid-rollout.

export type BookingPaymentKind = 'advance' | 'settlement'

/** The note the checkout route writes on a settlement row. */
export const SETTLEMENT_NOTE = 'Settlement'

export interface BookingPaymentKindRow {
    payment_kind?: string | null
    note?: string | null
}

export function bookingPaymentKind(row: BookingPaymentKindRow): BookingPaymentKind {
    if (row.payment_kind === 'settlement' || row.payment_kind === 'advance') {
        return row.payment_kind
    }
    return row.note === SETTLEMENT_NOTE ? 'settlement' : 'advance'
}

export function isSettlementPayment(row: BookingPaymentKindRow): boolean {
    return bookingPaymentKind(row) === 'settlement'
}

/**
 * PostgREST filter for "this is a settlement row", covering both the column and
 * the legacy note. Use with `.or(...)`.
 */
export const SETTLEMENT_ROW_FILTER =
    `payment_kind.eq.settlement,and(payment_kind.is.null,note.eq.${SETTLEMENT_NOTE})`
