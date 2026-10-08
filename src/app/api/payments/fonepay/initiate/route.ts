import { NextResponse } from 'next/server'
import { requireRoleWithOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { buildFonepayUrl } from '@/lib/payments/fonepay'
import { PLANS } from '@/lib/pricing'
import type { Tier } from '@/lib/tiers'

const VALID_TIERS: Tier[]                             = ['basic', 'premium', 'platinum', 'enterprise']
const BILLING_MONTHS: Record<string, number>          = { monthly: 1, yearly: 12 }

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
        const cycle    = body.cycle === 'monthly' ? 'monthly' : 'yearly'

        if (!VALID_TIERS.includes(planTier)) {
            return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
        }

        const plan = PLANS.find(p => p.tier === planTier)
        if (!plan || plan.price.kind !== 'yearly') {
            return NextResponse.json({ error: 'Plan not available' }, { status: 400 })
        }

        const amount        = cycle === 'monthly' && plan.price.monthly ? plan.price.monthly : plan.price.firstYear
        const billingMonths = BILLING_MONTHS[cycle] ?? 12
        const supabase      = await createAdminClient()

        const { data: payment, error: insertErr } = await supabase
            .from('subscription_payments')
            .insert({
                restaurant_id:  currentUser.restaurantId,
                amount,
                payment_method: 'fonepay',
                notes:          `${plan.name} · ${cycle === 'monthly' ? '1 month' : '1 year'} · FonePay (pending gateway confirmation)`,
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

        // Store the payment.id as PRN in reference_code — the callback will use it
        // to locate this row.
        await supabase
            .from('subscription_payments')
            .update({ reference_code: payment.id })
            .eq('id', payment.id)
            .eq('restaurant_id', currentUser.restaurantId)

        const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
        const returnUrl = `${appUrl}/api/payments/fonepay/callback?payment_id=${payment.id}`

        const fonepayUrl = buildFonepayUrl({
            amountNPR: amount,
            prn:       payment.id,
            returnUrl,
            remark:    `KKKhane ${plan.name} Plan`,
        })

        return NextResponse.json({ paymentUrl: fonepayUrl, paymentId: payment.id })
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unexpected error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
