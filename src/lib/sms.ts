/**
 * SMS sending, provider-selected at call time.
 *
 * Sparrow SMS is preferred when configured — it's a Nepal-local aggregator
 * with better delivery and lower per-message cost to +977 numbers than an
 * international gateway. MessageBird remains the fallback until a Sparrow
 * account (https://sparrowsms.com) is set up.
 *
 * Env vars:
 *   SPARROW_SMS_TOKEN, SPARROW_SMS_FROM   — preferred, used when both are set
 *   MESSAGEBIRD_API_KEY, MESSAGEBIRD_ORIGINATOR — fallback
 */

const SPARROW_SMS_API = 'https://api.sparrowsms.com/v2/sms/'
const MESSAGEBIRD_API = 'https://rest.messagebird.com/messages'

type SmsResult = { success: true } | { success: false; error: string }

async function sendViaSparrow(to: string, text: string): Promise<SmsResult> {
    const token = process.env.SPARROW_SMS_TOKEN!
    const from = process.env.SPARROW_SMS_FROM!

    // Sparrow expects a bare 10-digit Nepal mobile number, no country code.
    const normalized = to.replace(/\D/g, '')
    const formattedTo = normalized.length > 10 ? normalized.slice(-10) : normalized

    try {
        const res = await fetch(SPARROW_SMS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, from, to: formattedTo, text }),
        })

        const body = await res.json().catch(() => ({}))

        if (!res.ok || body.response_code !== 200) {
            console.error('[SMS] Sparrow send failed:', body)
            return { success: false, error: body.response ?? `HTTP ${res.status}` }
        }

        return { success: true }
    } catch (err) {
        console.error('[SMS] Network error:', err)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}

async function sendViaMessageBird(to: string, text: string): Promise<SmsResult> {
    const token = process.env.MESSAGEBIRD_API_KEY!
    // Originator must be alphanumeric (max 11 chars) or a valid phone number
    const originator = process.env.MESSAGEBIRD_ORIGINATOR || 'KKKhane'

    // Strip out any non-numeric characters for MessageBird
    const normalized = to.replace(/\D/g, '')
    // Typically MessageBird requires country code, assume +977 if 10 digits
    const formattedTo = normalized.length === 10 ? `977${normalized}` : normalized

    try {
        const res = await fetch(MESSAGEBIRD_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `AccessKey ${token}`
            },
            body: JSON.stringify({
                originator: originator,
                recipients: [formattedTo],
                body: text, // MessageBird handles concatenation for >160 chars automatically
            }),
        })

        const body = await res.json().catch(() => ({}))

        if (!res.ok) {
            console.error('[SMS] MessageBird Send failed:', body)
            return { success: false, error: body.errors?.[0]?.description ?? `HTTP ${res.status}` }
        }

        return { success: true }
    } catch (err) {
        console.error('[SMS] Network error:', err)
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
}

async function sendSms(to: string, text: string): Promise<SmsResult> {
    if (process.env.SPARROW_SMS_TOKEN && process.env.SPARROW_SMS_FROM) {
        return sendViaSparrow(to, text)
    }
    if (process.env.MESSAGEBIRD_API_KEY) {
        return sendViaMessageBird(to, text)
    }
    console.warn('[SMS] No SMS provider configured — skipping SMS')
    return { success: false, error: 'SMS not configured' }
}

/** Notify customer their order was received and is being prepared. */
export async function sendOrderConfirmationSms(
    phone: string,
    orderId: string,
    restaurantName: string
): Promise<SmsResult> {
    const shortId = orderId.substring(0, 8).toUpperCase()
    return sendSms(
        phone,
        `${restaurantName}: Your order #${shortId} has been received and is being prepared. Thank you!`
    )
}

/** Notify customer their order is ready for pickup / delivery. */
export async function sendOrderReadySms(
    phone: string,
    orderId: string,
    restaurantName: string
): Promise<SmsResult> {
    const shortId = orderId.substring(0, 8).toUpperCase()
    return sendSms(
        phone,
        `${restaurantName}: Order #${shortId} is ready! Your waiter will bring it to your table shortly.`
    )
}

/** Notify loyalty member they earned points. */
export async function sendLoyaltyPointsSms(
    phone: string,
    pointsEarned: number,
    pointsBalance: number,
    restaurantName: string
): Promise<SmsResult> {
    return sendSms(
        phone,
        `${restaurantName}: You earned ${pointsEarned} loyalty points! Balance: ${pointsBalance} pts. Thank you for dining with us.`
    )
}
