// The money block at the foot of a bill: what it adds up to, what has already
// been paid, and what the guest hands over now.
//
// This used to be worked out twice — once in the ESC/POS builder and once in
// the on-screen receipt JSX — with a comment on each asking the next person to
// remember to update the other. They had already drifted, and both were wrong
// in the same way, which is what a duplicated calculation eventually buys you.
// Both now render whatever this returns, so the paper and the screen cannot
// disagree about a number the guest is being asked to pay.
//
// The bug being fixed: the closing figure was computed as
//
//     total − (advance + cashPaid + qrPaid)
//
// but the cashier screens pre-fill `cashPaid` with the whole outstanding
// balance the moment a payment method is picked — that is what the guest is
// *about* to hand over, not what they have handed over. So the bill subtracted
// the payment from itself and the bottom line printed 0.00 on every estimate,
// while the only figure the guest needed (bill minus advance) appeared nowhere.
// The advance line above it looked ignored because, as far as the closing
// figure went, it was: everything cancelled to zero regardless.
//
// So money already in hand (the advance) is deducted to reach the amount
// payable, and money being handed over right now is reported below it as the
// method of payment. Those are different things and are no longer added
// together.

/** One line in the run-up to the total. */
export interface InvoiceSummaryLine {
    label: string
    amount: number
    /** '+' and '-' are printed; '' is the plain subtotal. */
    sign: '+' | '-' | ''
}

export interface InvoiceSummary {
    /** Subtotal through tax, in the order they belong on a bill. */
    lines: InvoiceSummaryLine[]
    /** What the bill comes to, before anything already paid. */
    total: number
    /** Money taken before this settlement. 0 when there was none. */
    advancePaid: number
    /**
     * The closing figure — what the guest hands over now, after the advance.
     * This is the number that belongs at the BOTTOM of the bill, and it is
     * deliberately not reduced by the cash/QR being tendered against it.
     */
    amountPayable: number
    /** Set when the advance exceeded the bill and money goes back instead. */
    returnToGuest: number
    /** Label for the closing figure — it flips when there is change to give. */
    finalLabel: 'GRAND TOTAL' | 'RETURN TO GUEST'
    /** `amountPayable`, or `returnToGuest` when that is what is happening. */
    finalAmount: number
}

/** The fields of an invoice this cares about. Structural, so both the ESC/POS
 *  ActiveInvoice and the receipt component's copy satisfy it. */
export interface InvoiceSummaryInput {
    type?: string
    stayCost?: number
    qrOrdersTotal?: number
    linkedOrdersTotal?: number
    manualChargesTotal?: number
    /** Explicit subtotal, when the caller already knows it (table bills). */
    subtotal?: number
    serviceCharge?: number
    service_charge_amount?: number
    taxAmount?: number
    tax_amount?: number
    discountAmount?: number
    extraHourCharge?: number
    total: number
    advancePaid?: number
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function summariseInvoice(invoice: InvoiceSummaryInput): InvoiceSummary {
    const n = (v: unknown) => Number(v) || 0

    const extraHour = n(invoice.extraHourCharge)
    // A caller that knows its own subtotal wins. The fallback deliberately
    // leaves the extra-hour charge OUT, because it is billed as its own line
    // below — folding it in as well would show it twice in a bill that still
    // has to add up, so it was previously hidden from the guest entirely to
    // keep the arithmetic honest. It can be shown now without breaking that.
    const subtotal = invoice.subtotal != null
        ? n(invoice.subtotal)
        : n(invoice.stayCost) + n(invoice.qrOrdersTotal) + n(invoice.linkedOrdersTotal) + n(invoice.manualChargesTotal)

    const serviceCharge = n(invoice.serviceCharge) || n(invoice.service_charge_amount)
    const tax = n(invoice.taxAmount) || n(invoice.tax_amount)
    const discount = n(invoice.discountAmount)

    const lines: InvoiceSummaryLine[] = [{ label: 'SUBTOTAL', amount: round2(subtotal), sign: '' }]
    if (extraHour > 0) lines.push({ label: 'EXTRA HOUR', amount: round2(extraHour), sign: '+' })
    if (serviceCharge > 0) lines.push({ label: 'SERVICE CHARGE', amount: round2(serviceCharge), sign: '+' })
    if (discount > 0) lines.push({ label: 'DISCOUNT', amount: round2(discount), sign: '-' })
    if (tax > 0) lines.push({ label: 'TAX (VAT)', amount: round2(tax), sign: '+' })

    const total = round2(invoice.total)
    const advancePaid = Math.max(0, round2(n(invoice.advancePaid)))
    const net = round2(total - advancePaid)

    // A guest who put down more than the bill came to gets the difference back;
    // the closing figure says so rather than printing a payable of 0.00 and
    // leaving the desk to work out that money is owed in the other direction.
    const returnToGuest = net < 0 ? round2(-net) : 0
    const amountPayable = net > 0 ? net : 0

    return {
        lines,
        total,
        advancePaid,
        amountPayable,
        returnToGuest,
        finalLabel: returnToGuest > 0 ? 'RETURN TO GUEST' : 'GRAND TOTAL',
        finalAmount: returnToGuest > 0 ? returnToGuest : amountPayable,
    }
}
