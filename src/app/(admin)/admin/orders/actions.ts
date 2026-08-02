'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { syncInvoiceToIrd } from '@/lib/irdSync'
import { isValidReasonCode } from '@/lib/voidReasons'

export async function refundOrderAction(
    orderId: string,
    reason: string,
    refundAmount?: number,
    reasonCode?: string | null
): Promise<{ error?: string; success?: boolean; partial?: boolean }> {
    const currentUser = await requireRole('manager', 'super_admin')

    if (!reason.trim()) return { error: 'A reason is required for refunds.' }

    const supabase = await createAdminClient()

    const cleanCode = isValidReasonCode('refund', reasonCode) ? reasonCode! : null

    const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('id, restaurant_id, total_amount, payment_status, status, refunded_amount, refund_reason')
        .eq('id', orderId)
        .single()

    if (fetchError || !order) return { error: 'Order not found.' }
    if (order.payment_status === 'refunded') return { error: 'Order has already been fully refunded.' }
    if (!['paid', 'unpaid'].includes(order.payment_status)) {
        return { error: `Cannot refund an order with payment status: ${order.payment_status}` }
    }

    const totalAmount = order.total_amount ?? 0
    const alreadyRefunded = order.refunded_amount ?? 0
    const maxRefundable = totalAmount - alreadyRefunded

    // Default to full refund if no amount specified
    const amount = refundAmount !== undefined ? refundAmount : maxRefundable

    if (amount <= 0) return { error: 'Refund amount must be greater than 0.' }
    if (amount > maxRefundable) {
        return { error: `Cannot refund more than the remaining amount (${maxRefundable}).` }
    }

    const newRefundedTotal = alreadyRefunded + amount
    const isFullRefund = newRefundedTotal >= totalAmount

    const notePrefix = isFullRefund ? '[REFUNDED]' : `[PARTIAL REFUND Rs.${amount}]`
    const newPaymentStatus = isFullRefund ? 'refunded' : order.payment_status

    // The reason used to be appended to customer_note — a guest-written,
    // guest-visible field — which mixed staff-only audit text into the order and
    // left it unreadable after a second partial refund. It has its own column
    // now; successive refunds still append, so the full history survives.
    const newRefundReason = order.refund_reason
        ? `${order.refund_reason} | ${notePrefix} ${reason.trim()}`
        : `${notePrefix} ${reason.trim()}`

    const { error: updateError } = await supabase
        .from('orders')
        .update({
            payment_status: newPaymentStatus,
            refunded_amount: newRefundedTotal,
            refund_reason: newRefundReason.slice(0, 1000),
            // Latest code wins: a partial refund for one cause followed by
            // another for a different cause should read as the most recent.
            refund_reason_code: cleanCode,
        })
        .eq('id', orderId)

    if (updateError) return { error: updateError.message }

    // Trigger IRD CBMS Credit Note Sync on refund
    const { data: rest } = await supabase
        .from('restaurants')
        .select('vat_registered')
        .eq('id', order.restaurant_id)
        .single()

    if (rest?.vat_registered) {
        const isVatRegistered = true
        const vatRate = 13
        const negativeAmount = -amount
        const negativeVatVal = isVatRegistered ? (negativeAmount - (negativeAmount / 1.13)) : 0
        const negativeTaxableVal = negativeAmount - negativeVatVal
        const creditNoteNumber = `CN-DINE-${orderId.split('-')[0].toUpperCase()}`

        void syncInvoiceToIrd(order.restaurant_id, {
            invoiceNumber: creditNoteNumber,
            buyerName: 'Refunded Guest',
            buyerPan: null,
            totalAmount: negativeAmount,
            discountAmount: 0,
            taxableAmount: negativeTaxableVal,
            vatAmount: negativeVatVal
        })
    }

    void logAudit({
        restaurantId: order.restaurant_id,
        userId: currentUser.id,
        action: 'order_cancelled',
        entityType: 'order',
        entityId: orderId,
        oldValue: { payment_status: order.payment_status, refunded_amount: alreadyRefunded },
        newValue: { payment_status: newPaymentStatus, refunded_amount: newRefundedTotal, reason, reasonCode: cleanCode, partial: !isFullRefund },
    })

    revalidatePath('/admin/orders')
    return { success: true, partial: !isFullRefund }
}
