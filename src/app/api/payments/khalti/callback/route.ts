// Khalti redirects the user's browser here after payment.
// URL: /api/payments/khalti/callback?payment_id=<uuid>&pidx=<khalti_pidx>&status=Completed&...
//
// We confirm the payment with Khalti's lookup API (not just trust the URL params),
// then auto-upgrade the tenant. Any failure falls back to the pending page.

import { type NextRequest, NextResponse } from 'next/server'
import { verifyKhaltiPayment } from '@/lib/payments/khalti'
import { autoApprovePayment } from '@/lib/payments/autoApprove'

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl
    const paymentId = searchParams.get('payment_id')
    const pidx      = searchParams.get('pidx')
    const status    = searchParams.get('status')

    const failUrl = '/admin/billing/payment-failed?gateway=khalti'

    if (!paymentId || !pidx) {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    // Khalti also redirects on failure with status != Completed.
    if (status !== 'Completed') {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const verified = await verifyKhaltiPayment(pidx)
    if (!verified) {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const result = await autoApprovePayment(paymentId, verified.transactionId)
    if ('error' in result) {
        console.error('[Khalti callback] auto-approve failed:', result.error)
        return NextResponse.redirect(
            new URL(`/admin/billing/payment-pending?gateway=khalti&payment_id=${paymentId}`, request.url),
        )
    }

    return NextResponse.redirect(
        new URL(`/admin/dashboard?plan_activated=${result.tier}`, request.url),
    )
}
