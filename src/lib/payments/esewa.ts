import crypto from 'crypto'

// eSewa Payment Gateway v2 — Nepal's most popular digital wallet.
//
// Integration uses eSewa's hosted checkout (form POST to their URL).
// After payment their gateway redirects back to success_url with a base64-
// encoded JSON blob: ?data=<base64>. The blob carries a signature we must
// verify before trusting any of it.
//
// Credentials: ESEWA_PRODUCT_CODE  (merchant code, "EPAYTEST" in sandbox)
//              ESEWA_SECRET_KEY    (HMAC key from eSewa merchant dashboard)

const PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE ?? 'EPAYTEST'
const SECRET_KEY   = process.env.ESEWA_SECRET_KEY   ?? '8gBm/:&EnhH.1/q'

export const ESEWA_FORM_URL =
    PRODUCT_CODE === 'EPAYTEST'
        ? 'https://rc-epay.esewa.com.np/api/epay/main/v2/form'
        : 'https://epay.esewa.com.np/api/epay/main/v2/form'

const ESEWA_STATUS_URL =
    PRODUCT_CODE === 'EPAYTEST'
        ? 'https://rc-epay.esewa.com.np/api/epay/transaction/status/'
        : 'https://epay.esewa.com.np/api/epay/transaction/status/'

function hmacBase64(message: string): string {
    return crypto.createHmac('sha256', SECRET_KEY).update(message).digest('base64')
}

// Build the form fields to POST to eSewa. The signed_field_names order must
// match exactly what we reconstruct during verification.
export function buildEsewaParams(params: {
    amountNPR: number
    transactionUuid: string   // stable ID we generated; included in callback
    successUrl: string
    failureUrl: string
}) {
    const { amountNPR, transactionUuid, successUrl, failureUrl } = params
    const signedFields = `total_amount=${amountNPR},transaction_uuid=${transactionUuid},product_code=${PRODUCT_CODE}`
    return {
        amount:                   amountNPR,
        tax_amount:               0,
        total_amount:             amountNPR,
        transaction_uuid:         transactionUuid,
        product_code:             PRODUCT_CODE,
        product_service_charge:   0,
        product_delivery_charge:  0,
        success_url:              successUrl,
        failure_url:              failureUrl,
        signed_field_names:       'total_amount,transaction_uuid,product_code',
        signature:                hmacBase64(signedFields),
    }
}

export interface EsewaCallbackPayload {
    transaction_code:    string
    status:              string
    total_amount:        string
    transaction_uuid:    string
    product_code:        string
    signed_field_names:  string
    signature:           string
}

// Decode and verify the ?data= query param eSewa appends to success_url.
// Returns null if signature check fails or status is not COMPLETE.
export async function verifyEsewaCallback(encodedData: string): Promise<{
    transactionCode: string
    transactionUuid: string
    totalAmountNPR: number
} | null> {
    let payload: EsewaCallbackPayload
    try {
        payload = JSON.parse(Buffer.from(encodedData, 'base64').toString('utf-8'))
    } catch {
        return null
    }

    if (payload.status !== 'COMPLETE') return null

    // Recompute signature over the fields eSewa signed.
    const fields = payload.signed_field_names.split(',')
    const payloadMap = payload as unknown as Record<string, string>
    const message = fields.map(f => `${f}=${payloadMap[f]}`).join(',')
    if (hmacBase64(message) !== payload.signature) return null

    // Double-check with eSewa's status API to guard against replays.
    try {
        const url =
            `${ESEWA_STATUS_URL}?product_code=${PRODUCT_CODE}` +
            `&total_amount=${payload.total_amount}` +
            `&transaction_uuid=${payload.transaction_uuid}`
        const res  = await fetch(url, { cache: 'no-store' })
        const data = await res.json() as { status?: string }
        if (data.status !== 'COMPLETE') return null
    } catch {
        // eSewa API unreachable — signature already passed, trust it.
        // The payment record stays pending and can be manually approved later.
        return null
    }

    return {
        transactionCode:  payload.transaction_code,
        transactionUuid:  payload.transaction_uuid,
        totalAmountNPR:   parseFloat(payload.total_amount),
    }
}
