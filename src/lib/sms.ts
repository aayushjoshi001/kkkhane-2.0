/**
 * MessageBird SMS integration
 * Env vars required: MESSAGEBIRD_API_KEY
 */

const MESSAGEBIRD_API = 'https://rest.messagebird.com/messages'

type SmsResult = { success: true } | { success: false; error: string }

async function sendSms(to: string, text: string): Promise<SmsResult> {
    // API key from env or fallback to user provided one
    const token = process.env.MESSAGEBIRD_API_KEY || 'bk_eu1_QDobai8YAhbKAOuqjhoPsge0qtYrs'
    // Originator must be alphanumeric (max 11 chars) or a valid phone number
    const originator = process.env.MESSAGEBIRD_ORIGINATOR || 'KKKhane'

    if (!token) {
        console.warn('[SMS] MESSAGEBIRD_API_KEY not set — skipping SMS')
        return { success: false, error: 'SMS not configured' }
    }

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
