// eSewa redirects the user's browser here after payment completes.
// URL: /api/payments/esewa/callback?payment_id=<uuid>&data=<base64json>
//
// We verify the eSewa signature, double-check with their status API, then
// auto-upgrade the tenant and redirect to the success page. Any failure goes
// to the manual-pending page so the admin can approve it by hand.

import { type NextRequest, NextResponse } from 'next/server'
import { verifyEsewaCallback } from '@/lib/payments/esewa'
import { autoApprovePayment } from '@/lib/payments/autoApprove'

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl
    const paymentId   = searchParams.get('payment_id')
    const encodedData = searchParams.get('data')

    const failUrl = '/admin/billing/payment-failed?gateway=esewa'

    if (!paymentId || !encodedData) {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const verified = await verifyEsewaCallback(encodedData)
    if (!verified) {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const result = await autoApprovePayment(paymentId, verified.transactionCode)
    if ('error' in result) {
        // Upgrade failed — the payment row stays pending for manual review.
        console.error('[eSewa callback] auto-approve failed:', result.error)
        return NextResponse.redirect(
            new URL(`/admin/billing/payment-pending?gateway=esewa&payment_id=${paymentId}`, request.url),
        )
    }

    return NextResponse.redirect(
        new URL(`/admin/dashboard?plan_activated=${result.tier}`, request.url),
    )
}
