'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { requireRole } from '@/lib/auth'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'

export async function verifyPayment(
    claimId: string,
    action: 'verified' | 'rejected'
): Promise<{ error?: string; success?: boolean }> {
    // Identity is derived server-side, never trusted from the client — the
    // caller can't stamp someone else's id on a verification.
    const { id: userId } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: claim, error } = await supabase
        .from('payment_verifications')
        .update({
            staff_verified: action === 'verified',
            staff_rejected: action === 'rejected',
            staff_verified_by: userId,
            staff_verified_at: new Date().toISOString(),
        })
        .eq('id', claimId)
        .select('restaurant_id, amount, payment_method')
        .single()

    if (error) {
        console.error('Payment verification update failed:', error)
        return { error: 'Failed to update payment status' }
    }

    void logAudit({
        restaurantId: claim.restaurant_id,
        userId,
        action: action === 'verified' ? 'payment_verified' : 'payment_rejected',
        entityType: 'payment',
        entityId: claimId,
        newValue: { amount: claim.amount, payment_method: claim.payment_method, action },
    })

    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Combined action: Verify payment claim → Mark order as paid → Close session.
 * Step 9 of Golden Path: "Verify Payment & Close Table"
 */
export async function verifyPaymentAndCloseTable(
    claimId: string
): Promise<{ error?: string; success?: boolean; tableClosed?: boolean }> {
    const { id: userId } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const supabase = await createAdminClient()

    // 1. Verify the payment claim and get associated order_id
    const { data: claim, error: claimError } = await supabase
        .from('payment_verifications')
        .update({
            staff_verified: true,
            staff_rejected: false,
            staff_verified_by: userId,
            staff_verified_at: new Date().toISOString(),
        })
        .eq('id', claimId)
        .select('order_id, restaurant_id')
        .single()

    if (claimError || !claim) {
        console.error('Payment verification update failed:', claimError)
        return { error: 'Failed to verify payment' }
    }

    if (!claim.order_id) {
        // No order linked — just verify, can't auto-close
        void logAudit({
            restaurantId: claim.restaurant_id,
            userId,
            action: 'payment_verified',
            entityType: 'payment',
            entityId: claimId,
        })
        revalidatePath('/waiter')
        return { success: true, tableClosed: false }
    }

    // 2. Mark the order as paid and get its session_id + restaurant_id
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .update({
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
        })
        .eq('id', claim.order_id)
        .select('session_id, restaurant_id')
        .single()

    if (orderError || !order) {
        console.error('Failed to update order payment:', orderError)
        revalidatePath('/waiter')
        return { success: true, tableClosed: false }
    }

    void logAudit({
        restaurantId: order.restaurant_id,
        userId,
        action: 'payment_verified',
        entityType: 'payment',
        entityId: claimId,
        newValue: { order_id: claim.order_id, payment_status: 'paid' },
    })

    // 3. Check if ALL orders in this session are now paid
    const { count: unpaidCount } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', order.session_id)
        .not('payment_status', 'in', '("paid","refunded")')
        .neq('status', 'cancelled')

    if (unpaidCount === 0) {
        // 4. All orders paid — close the session (table turns green)
        await supabase
            .from('sessions')
            .update({
                status: 'closed',
                closed_at: new Date().toISOString(),
            })
            .eq('id', order.session_id)
            .eq('status', 'active')

        await markTableDirtyForSession(supabase, order.session_id)

        void logAudit({
            restaurantId: order.restaurant_id,
            userId,
            action: 'session_closed',
            entityType: 'session',
            entityId: order.session_id,
            newValue: { reason: 'all_orders_paid' },
        })

        revalidatePath('/waiter')
        return { success: true, tableClosed: true }
    }

    revalidatePath('/waiter')
    return { success: true, tableClosed: false }
}
