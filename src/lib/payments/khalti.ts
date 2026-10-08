// Khalti ePay v2 — Nepal's second-largest digital wallet.
//
// Flow: server initiates → Khalti returns {pidx, payment_url} → user pays on
// Khalti's hosted page → Khalti redirects to return_url?pidx=...&status=Completed
// → server calls lookup API to confirm before activating.
//
// Credential: KHALTI_SECRET_KEY  (from Khalti merchant dashboard)
// Test key:   test_secret_key_dc74e0fd5737c8143c4a0932f76d8445

const SECRET_KEY = process.env.KHALTI_SECRET_KEY ?? 'test_secret_key_dc74e0fd5737c8143c4a0932f76d8445'

const BASE_URL =
    SECRET_KEY.startsWith('test_secret_key')
        ? 'https://dev.khalti.com/api/v2'
        : 'https://khalti.com/api/v2'

interface KhaltiInitiateParams {
    returnUrl:         string
    websiteUrl:        string
    amountNPR:         number   // in rupees — we convert to paisa internally
    purchaseOrderId:   string   // stable ID (our paymentId UUID)
    purchaseOrderName: string
}

interface KhaltiInitiateResult {
    pidx:       string
    paymentUrl: string
}

// Call Khalti to create a hosted checkout session.
export async function initiateKhaltiPayment(
    params: KhaltiInitiateParams
): Promise<KhaltiInitiateResult | { error: string }> {
    try {
        const res = await fetch(`${BASE_URL}/epayment/initiate/`, {
            method:  'POST',
            headers: {
                Authorization:  `Key ${SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                return_url:          params.returnUrl,
                website_url:         params.websiteUrl,
                amount:              params.amountNPR * 100, // paisa
                purchase_order_id:   params.purchaseOrderId,
                purchase_order_name: params.purchaseOrderName,
            }),
            cache: 'no-store',
        })

        const data = await res.json() as Record<string, unknown>
        if (!res.ok) return { error: JSON.stringify(data) }

        return {
            pidx:       data.pidx as string,
            paymentUrl: data.payment_url as string,
        }
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Khalti API error' }
    }
}

// Confirm a completed payment via Khalti's lookup API.
// Called from the callback route BEFORE activating the subscription.
export async function verifyKhaltiPayment(pidx: string): Promise<{
    amountNPR:     number
    transactionId: string
} | null> {
    try {
        const res = await fetch(`${BASE_URL}/epayment/lookup/`, {
            method:  'POST',
            headers: {
                Authorization:  `Key ${SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body:  JSON.stringify({ pidx }),
            cache: 'no-store',
        })

        const data = await res.json() as Record<string, unknown>
        if (data.status !== 'Completed') return null

        return {
            amountNPR:     (data.total_amount as number) / 100,
            transactionId: data.transaction_id as string,
        }
    } catch {
        return null
    }
}
