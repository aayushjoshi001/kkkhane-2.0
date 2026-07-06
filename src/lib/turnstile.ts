export async function verifyTurnstileToken(token: string | null | undefined): Promise<boolean> {
    if (!token) return false

    const secretKey = process.env.TURNSTILE_SECRET_KEY
    if (!secretKey) {
        console.warn('TURNSTILE_SECRET_KEY is not configured. Skipping Turnstile verification.')
        return true
    }

    try {
        const formData = new URLSearchParams()
        formData.append('secret', secretKey)
        formData.append('response', token)

        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData,
        })

        const data = await res.json()
        return data.success
    } catch (e) {
        console.error('Turnstile verification failed:', e)
        return false
    }
}
