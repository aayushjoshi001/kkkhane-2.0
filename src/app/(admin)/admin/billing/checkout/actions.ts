'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRoleWithOptions } from '@/lib/auth'
import type { Tier } from '@/lib/tiers'

export async function submitPaymentReferenceAction(data: {
    amount: number
    method: 'esewa' | 'khalti' | 'fonepay' | 'bank'
    reference_code: string
    notes: string
    plan_tier: Tier
    billing_months: number
}) {
    try {
        const currentUser = await requireRoleWithOptions(['super_admin', 'manager', 'owner'], { allowSuspended: true })
        if (!currentUser.restaurantId) throw new Error('No restaurant context')

        const adminSupabase = await createAdminClient()

        const { error } = await adminSupabase
            .from('subscription_payments')
            .insert({
                restaurant_id: currentUser.restaurantId,
                amount: data.amount,
                payment_method: data.method,
                reference_code: data.reference_code,
                notes: data.notes,
                recorded_by: currentUser.id,
                // Workflow columns (added in 20261007120000 migration)
                status: 'pending',
                plan_tier: data.plan_tier,
                billing_months: data.billing_months,
            })

        if (error) throw error

        return { success: true }
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Failed to submit payment reference' }
    }
}
