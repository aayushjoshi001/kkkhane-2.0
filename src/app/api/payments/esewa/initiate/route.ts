import { NextResponse } from 'next/server'
import { requireRoleWithOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { buildEsewaParams, ESEWA_FORM_URL } from '@/lib/payments/esewa'
import { PLANS } from '@/lib/pricing'
import type { Tier } from '@/lib/tiers'

const VALID_TIERS: Tier[] = ['basic', 'premium', 'platinum', 'enterprise']
const BILLING_MONTHS = { monthly: 1, yearly: 12 }

export async function POST(request: Request) {
    try {
        const currentUser = await requireRoleWithOptions(
            ['super_admin', 'manager', 'owner'],
            { allowSuspended: true },
        )
        if (!currentUser.restaurantId) {
            return NextResponse.json({ error: 'No restaurant context' }, { status: 403 })
        }

        const body = await request.json() as { planTier?: string; cycle?: string }
        const planTier = body.planTier as Tier
        const cycle = (body.cycle === 'monthly' ? 'monthly' : 'yearly') as 'monthly' | 'yearly'

        if (!VALID_TIERS.includes(planTier)) {
            return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
        }

        const plan = PLANS.find(p => p.tier === planTier)
        if (!plan || plan.price.kind !== 'yearly') {
            return NextResponse.json({ error: 'Plan not available' }, { status: 400 })
        }

        const amount       = cycle === 'monthly' && plan.price.monthly ? plan.price.monthly : plan.price.firstYear
        const billingMonths = BILLING_MONTHS[cycle]

        // Create a pending payment record first so the callback has something to
        // look up. The transactionUuid doubles as a stable external reference so
        // we can find this row from the eSewa callback.
        const transactionUuid = crypto.randomUUID()
        const supabase        = await createAdminClient()

        const { data: payment, error: insertErr } = await supabase
            .from('subscription_payments')
            .insert({
                restaurant_id:  currentUser.restaurantId,
                amount,
                payment_method: 'esewa',
                reference_code: transactionUuid,   // matched in the callback
                notes:          `${plan.name} · ${cycle === 'monthly' ? '1 month' : '1 year'} · eSewa (pending gateway confirmation)`,
                recorded_by:    currentUser.id,
                status:         'pending',
                plan_tier:      planTier,
                billing_months: billingMonths,
            })
            .select('id')
            .single()

        if (insertErr || !payment) {
            return NextResponse.json({ error: insertErr?.message ?? 'DB error' }, { status: 500 })
        }

        const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
        const successUrl = `${appUrl}/api/payments/esewa/callback?payment_id=${payment.id}`
        const failureUrl = `${appUrl}/admin/billing/payment-failed?gateway=esewa`

        const formParams = buildEsewaParams({
            amountNPR:       amount,
            transactionUuid,
            successUrl,
            failureUrl,
        })

        return NextResponse.json({ formUrl: ESEWA_FORM_URL, formParams, paymentId: payment.id })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unexpected error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
