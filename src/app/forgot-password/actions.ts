'use server'

import { createServerClient } from '@/lib/supabase/server'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'
import { verifyTurnstileToken } from '@/lib/turnstile'

export async function forgotPasswordAction(
    prevState: { error: string | null; success: boolean },
    formData: FormData
): Promise<{ error: string | null; success: boolean }> {
    const email = (formData.get('email') as string | null)?.trim().toLowerCase()
    const turnstileToken = formData.get('cf-turnstile-response') as string | null

    if (!email) return { error: 'Email is required.', success: false }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Invalid email address.', success: false }

    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.', success: false }
    }

    const rateLimitError = await checkRateLimit(
        'PASSWORD_RESET',
        RATE_LIMIT_RULES.PASSWORD_RESET.requests,
        RATE_LIMIT_RULES.PASSWORD_RESET.windowSeconds
    )
    if (rateLimitError) return { error: 'Too many requests. Please wait an hour before trying again.', success: false }

    const supabase = await createServerClient()
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`

    try {
        // Always return success to prevent email enumeration
        await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    } catch (e: any) {
        console.error('Forgot password error:', e)
        if (e?.message?.includes('fetch failed') || e?.cause?.code) {
            return { error: 'Network error connecting to the server. Please try again later.', success: false }
        }
    }

    return { error: null, success: true }
}
