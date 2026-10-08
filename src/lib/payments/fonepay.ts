import crypto from 'crypto'

// FonePay Business ePay — Nepal's bank-linked QR network.
//
// Unlike eSewa/Khalti (server-side session), FonePay is a plain GET redirect:
// we build a signed URL and send the customer there; FonePay appends the result
// to our return URL on completion.
//
// Credentials: FONEPAY_MERCHANT_CODE  (PID from FonePay Business dashboard)
//              FONEPAY_SECRET_KEY     (merchant secret for HMAC-SHA512)
//
// Sandbox: https://dev.fonepay.com/payment/merchant-request
// Live:    https://fonepay.com/payment/merchant-request

const MERCHANT_CODE = process.env.FONEPAY_MERCHANT_CODE ?? 'TEST_MERCHANT'
const SECRET_KEY    = process.env.FONEPAY_SECRET_KEY    ?? 'test_secret'

// FonePay sandbox uses a different host from production.
const BASE_URL =
    MERCHANT_CODE === 'TEST_MERCHANT'
        ? 'https://dev.fonepay.com/payment/merchant-request'
        : 'https://fonepay.com/payment/merchant-request'

function hmacSha512Hex(message: string): string {
    return crypto.createHmac('sha512', SECRET_KEY).update(message).digest('hex').toLowerCase()
}

// Build the signed GET URL to redirect the customer to FonePay's hosted QR page.
//
// DV = HMAC-SHA512(secret, "PID,MD,PRN,AMT,CRN,DT,R1,R2,RU")
// FonePay requires DT in MM/DD/YYYY format (US locale, not ISO).
export function buildFonepayUrl(params: {
    amountNPR: number
    prn:       string   // our stable payment ID (UUID) — echoed back in callback
    returnUrl: string
    remark:    string   // max 50 chars shown to customer on FonePay screen
}): string {
    const { amountNPR, prn, returnUrl, remark } = params

    const amt = amountNPR.toFixed(2)
    const dt  = new Date().toLocaleDateString('en-US', {
        month: '2-digit',
        day:   '2-digit',
        year:  'numeric',
    }) // MM/DD/YYYY
    const md  = 'P'
    const crn = 'NPR'
    const r1  = remark.slice(0, 50)
    const r2  = 'KKKhane'

    // Signature covers the exact ordered list FonePay specifies.
    const message = [MERCHANT_CODE, md, prn, amt, crn, dt, r1, r2, returnUrl].join(',')
    const dv      = hmacSha512Hex(message)

    const url = new URL(BASE_URL)
    url.searchParams.set('PID', MERCHANT_CODE)
    url.searchParams.set('MD',  md)
    url.searchParams.set('PRN', prn)
    url.searchParams.set('AMT', amt)
    url.searchParams.set('CRN', crn)
    url.searchParams.set('DT',  dt)
    url.searchParams.set('R1',  r1)
    url.searchParams.set('R2',  r2)
    url.searchParams.set('RU',  returnUrl)
    url.searchParams.set('DV',  dv)

    return url.toString()
}

export interface FonepayCallbackParams {
    PRN: string   // our payment reference echoed back
    BID: string   // FonePay's bank transaction ID
    AMT: string   // amount (decimal string, e.g. "9999.00")
    UID: string   // FonePay user ID
    DV:  string   // response HMAC
    RC:  string   // "00" = success
}

// Verify FonePay's callback signature.
//
// Response DV = HMAC-SHA512(secret, "PRN,BID,AMT,UID,RC")
// RC "00" is the only success code; anything else is a failure or cancellation.
export function verifyFonepayCallback(p: FonepayCallbackParams): boolean {
    if (p.RC !== '00') return false

    const message  = [p.PRN, p.BID, p.AMT, p.UID, p.RC].join(',')
    const expected = hmacSha512Hex(message)
    return expected === p.DV.toLowerCase()
}
