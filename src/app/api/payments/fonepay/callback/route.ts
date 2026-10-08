// FonePay redirects the user's browser here after payment.
// URL: /api/payments/fonepay/callback?payment_id=<uuid>&PRN=...&BID=...&AMT=...&UID=...&DV=...&RC=00
//
// RC "00" means success; any other value is a failure or cancellation.
// We verify the HMAC-SHA512 response signature before activating the subscription.

import { type NextRequest, NextResponse } from 'next/server'
import { verifyFonepayCallback, type FonepayCallbackParams } from '@/lib/payments/fonepay'
import { autoApprovePayment } from '@/lib/payments/autoApprove'

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl
    const paymentId = searchParams.get('payment_id')

    const failUrl = '/admin/billing/payment-failed?gateway=fonepay'

    if (!paymentId) {
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const rc = searchParams.get('RC') ?? searchParams.get('rc') ?? ''
    if (rc !== '00') {
        // Payment cancelled or failed — no action needed, row stays pending.
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    const params: FonepayCallbackParams = {
        PRN: searchParams.get('PRN') ?? '',
        BID: searchParams.get('BID') ?? '',
        AMT: searchParams.get('AMT') ?? '',
        UID: searchParams.get('UID') ?? '',
        DV:  searchParams.get('DV')  ?? '',
        RC:  rc,
    }

    if (!verifyFonepayCallback(params)) {
        console.error('[FonePay callback] signature verification failed', { paymentId, ...params })
        return NextResponse.redirect(new URL(failUrl, request.url))
    }

    // BID is FonePay's own transaction reference — store it for reconciliation.
    const result = await autoApprovePayment(paymentId, params.BID)
    if ('error' in result) {
        console.error('[FonePay callback] auto-approve failed:', result.error)
        return NextResponse.redirect(
            new URL(`/admin/billing/payment-pending?gateway=fonepay&payment_id=${paymentId}`, request.url),
        )
    }

    return NextResponse.redirect(
        new URL(`/admin/dashboard?plan_activated=${result.tier}`, request.url),
    )
}
