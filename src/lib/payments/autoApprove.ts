// Internal auto-approval — called from payment gateway callbacks, not from
// a user action. There is no requireRole() here because the caller has already
// verified the payment cryptographically (eSewa HMAC + status API, or Khalti
// lookup API). Trust is established by the gateway signature, not by a session.
//
// This mirrors approveSubscriptionPaymentAction in super-admin/actions.ts but
// skips the role check and accepts the gateway's transaction ID so we can record
// it for reconciliation. If you change the approval logic there, keep both in
// sync — or better, extract a shared helper and reference it from both.

import { createAdminClient } from '@/lib/supabase/server'
import { updateSubscriptionTier } from '@/app/(admin)/admin/super-admin/actions'
import type { Tier } from '@/lib/tiers'

export async function autoApprovePayment(
    paymentId:        string,
    gatewayReference: string,   // transaction_code (eSewa) or transaction_id (Khalti)
): Promise<{ success: true; tier: Tier; newExpiry: string } | { error: string }> {
    const supabase = await createAdminClient()

    const { data: payment, error: fetchErr } = await supabase
        .from('subscription_payments')
        .select('id, restaurant_id, plan_tier, billing_months, status')
        .eq('id', paymentId)
        // tenant-scope-exempt: paymentId is the PK on subscription_payments;
        // restaurant_id comes from the row itself and is used below — no cross-
        // tenant access is possible here because only our server generates these
        // IDs (embedded in the gateway success_url we control).
        .maybeSingle()

    if (fetchErr || !payment) return { error: 'Payment record not found' }
    // Idempotent — gateway may call the callback more than once.
    if (payment.status === 'approved') {
        const { data: rest } = await supabase
            .from('restaurants')
            .select('subscription_expires_at')
            .eq('id', payment.restaurant_id)
            // tenant-scope-exempt: reading own restaurant after lookup by restaurant_id from payment row
            .maybeSingle()
        return {
            success:   true,
            tier:      (payment.plan_tier ?? 'basic') as Tier,
            newExpiry: rest?.subscription_expires_at ?? new Date().toISOString(),
        }
    }

    const tier   = (payment.plan_tier ?? 'basic') as Tier
    const months = payment.billing_months ?? 12

    const tierResult = await updateSubscriptionTier(payment.restaurant_id, tier)
    if (tierResult?.error) return { error: `Tier upgrade failed: ${tierResult.error}` }

    const { data: rest } = await supabase
        .from('restaurants')
        .select('subscription_expires_at')
        .eq('id', payment.restaurant_id)
        // tenant-scope-exempt: restaurant_id is sourced from the payment row above
        .maybeSingle()

    const base = rest?.subscription_expires_at
        ? new Date(Math.max(new Date(rest.subscription_expires_at).getTime(), Date.now()))
        : new Date()
    const newExpiry = new Date(base)
    newExpiry.setMonth(newExpiry.getMonth() + months)

    await supabase
        .from('restaurants')
        .update({
            subscription_expires_at: newExpiry.toISOString(),
            subscription_status:     'active',
            is_suspended:            false,
        })
        .eq('id', payment.restaurant_id)
        // tenant-scope-exempt: restaurant_id sourced from payment row above

    const { error: approveErr } = await supabase
        .from('subscription_payments')
        .update({
            status:       'approved',
            approved_at:  new Date().toISOString(),
            // Store the gateway's own reference in the notes so finance can reconcile.
            notes:        `Auto-approved via gateway · ref: ${gatewayReference}`,
        })
        .eq('id', paymentId)
        // tenant-scope-exempt: paymentId is PK, restaurant_id scoped above

    if (approveErr) return { error: `DB update failed: ${approveErr.message}` }

    return { success: true, tier, newExpiry: newExpiry.toISOString() }
}
