'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRoleWithOptions } from '@/lib/auth'

export async function submitPaymentReferenceAction(data: {
    amount: number
    method: 'esewa' | 'bank'
    reference_code: string
    notes: string
}) {
    try {
        const currentUser = await requireRoleWithOptions(['super_admin', 'manager', 'owner'], { allowSuspended: true })
        if (!currentUser.restaurantId) throw new Error('No restaurant context')

        const adminSupabase = await createAdminClient()

        // Insert into subscription_payments table
        const { error } = await adminSupabase
            .from('subscription_payments')
            .insert({
                restaurant_id: currentUser.restaurantId,
                amount: data.amount,
                payment_method: data.method,
                reference_code: data.reference_code,
                notes: data.notes,
                recorded_by: currentUser.id
            })

        if (error) throw error

        return { success: true }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to submit payment reference' }
    }
}
