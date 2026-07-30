// Formatting shared by every day-book statement view (on-screen table, range
// export, EOD zip export) so the three never drift on what a category or a
// voucher-shaped description reads as.

import type { DayBookEntry } from '@/types/database'

export const DAY_BOOK_CATEGORY_LABELS: Record<string, string> = {
    order_payment:    'Order Payment',
    room_deposit:     'Room Deposit',
    booking_payment:  'Booking Payment',
    expense:          'Expense',
    refund:           'Refund',
    salary:           'Salary / Wage',
    advance:          'Advance',
    bank_deposit:     'Bank Deposit',
    withdrawal:       'Bank Withdrawal',
    other:            'Other',
}

export function formatDayBookDescription(desc: string): string {
    if (!desc) return ''
    if (desc.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(desc)
            if (parsed.voucher_type && parsed.voucher_number) {
                const typeLabel = parsed.voucher_type === 'receipt' ? 'Receipt' : 'Payment'
                const partyLabel = parsed.party_name ? ` (To: ${parsed.party_name})` : ''
                const receivedFromLabel = parsed.party_name && parsed.voucher_type === 'receipt' ? ` (From: ${parsed.party_name})` : partyLabel
                return `${typeLabel} ${parsed.voucher_number}${receivedFromLabel} - ${parsed.particulars || 'No details'}`
            }
        } catch {
            // fallback
        }
    }
    return desc
}

export const isDayBookSourceCash = (type: DayBookEntry['type']) => type === 'cash_in' || type === 'cash_out'
