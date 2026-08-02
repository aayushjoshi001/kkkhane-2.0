// lib/voidReasons.ts
// The vocabulary behind every void, comp and refund.
//
// The point of a code is that it can be counted. Free text still travels with
// it — a code says "kitchen error", the text says which dish and what went
// wrong — but only the code makes "we lost Rs. 14,200 to kitchen errors in
// Shrawan" a query rather than an afternoon of reading.
//
// This file is the source of truth; the DB columns are plain text with no CHECK
// constraint, so adding a reason is a change here and nothing else. Codes are
// stored, never displayed — rename a label freely, but never reuse or repoint
// an existing code, because historical rows still carry it.

/**
 * Void and comp are stored on the row (orders/order_items.cancellation_kind);
 * refund is not a cancellation and lives on its own columns, but it draws its
 * reasons from the same file so a manager sees one consistent vocabulary.
 */
export type CancellationKind = 'void' | 'comp'
export type ReasonContext = CancellationKind | 'refund'

export interface ReasonOption {
    code: string
    label: string
    /** Shown under the label where the distinction isn't obvious from the name alone. */
    hint?: string
}

/**
 * Something went wrong and the item comes off the bill. Ordered roughly by how
 * often a busy floor reaches for them, because the first three are what a
 * cashier picks under pressure and a mis-picked code is worse than no code.
 */
export const VOID_REASONS: readonly ReasonOption[] = [
    { code: 'wrong_item', label: 'Wrong item ordered', hint: 'Entered or picked incorrectly' },
    { code: 'customer_changed_mind', label: 'Guest changed their mind' },
    { code: 'kitchen_error', label: 'Kitchen error', hint: 'Made wrong, or made twice' },
    { code: 'quality_issue', label: 'Quality complaint', hint: 'Sent back — cold, undercooked, off' },
    { code: 'out_of_stock', label: 'Out of stock' },
    { code: 'long_wait', label: 'Took too long', hint: 'Guest cancelled or left' },
    { code: 'duplicate_entry', label: 'Duplicate entry', hint: 'Same order rung up twice' },
    { code: 'spillage', label: 'Dropped or spilled' },
    { code: 'test_order', label: 'Test / training order' },
    { code: 'other_void', label: 'Other' },
] as const

/**
 * The food was made and served, and nobody is being charged for it. Distinct
 * from a void because it is a decision, not a mistake — and because staff meals
 * are a payroll cost, not wastage.
 */
export const COMP_REASONS: readonly ReasonOption[] = [
    { code: 'staff_meal', label: 'Staff meal' },
    { code: 'service_recovery', label: 'Service recovery', hint: 'Made good on a complaint' },
    { code: 'vip_guest', label: 'VIP / owner’s guest' },
    { code: 'tasting', label: 'Tasting or sampling' },
    { code: 'promotion', label: 'Promotion or event' },
    { code: 'owner_consumption', label: 'Owner consumption' },
    { code: 'other_comp', label: 'Other' },
] as const

/** Money already taken is going back. Kept separate: an overcharge is a billing fault, not wastage. */
export const REFUND_REASONS: readonly ReasonOption[] = [
    { code: 'overcharge', label: 'Billing error / overcharge' },
    { code: 'quality_issue', label: 'Quality complaint' },
    { code: 'wrong_item', label: 'Wrong item delivered' },
    { code: 'service_failure', label: 'Service failure' },
    { code: 'duplicate_payment', label: 'Paid twice' },
    { code: 'order_not_delivered', label: 'Never delivered' },
    { code: 'other_refund', label: 'Other' },
] as const

export const REASONS_BY_CONTEXT: Record<ReasonContext, readonly ReasonOption[]> = {
    void: VOID_REASONS,
    comp: COMP_REASONS,
    refund: REFUND_REASONS,
}

/** True when `code` is a reason this context actually offers. */
export function isValidReasonCode(context: ReasonContext, code: string | null | undefined): boolean {
    if (!code) return false
    return REASONS_BY_CONTEXT[context].some(r => r.code === code)
}

/**
 * Display label for a stored code. Falls back to the raw code rather than an
 * empty cell, so a row written by an older build (or a code retired since) is
 * still legible in a report instead of silently vanishing.
 */
export function reasonLabel(code: string | null | undefined): string {
    if (!code) return '—'
    for (const options of Object.values(REASONS_BY_CONTEXT)) {
        const match = options.find(r => r.code === code)
        if (match) return match.label
    }
    return code
}

/** The expense category each kind posts to — what keeps wastage and giveaways separable in the books. */
export const CANCELLATION_EXPENSE_CATEGORY: Record<CancellationKind, string> = {
    void: 'Order Cancellation',
    comp: 'Complimentary & Staff Meals',
}

export const KIND_LABEL: Record<CancellationKind, string> = {
    void: 'Void',
    comp: 'Comp',
}
