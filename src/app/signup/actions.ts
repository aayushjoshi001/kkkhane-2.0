'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/ratelimit'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { sendSignupVerificationCodeEmail } from '@/lib/email'

export async function registerUserAction(formData: FormData) {
    const fullName = formData.get('fullName') as string
    const email = (formData.get('email') as string).toLowerCase().trim()
    const password = formData.get('password') as string

    if (!fullName || !email || !password) {
        return { error: 'All fields are required.' }
    }

    const rateLimitError = await checkRateLimit('SIGNUP', 3, 3600)
    if (rateLimitError) return { error: rateLimitError }

    const turnstileToken = formData.get('cf-turnstile-response') as string | null
    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
        if (!turnstileToken) {
            return { error: 'Please complete the CAPTCHA.' }
        }
        const isValid = await verifyTurnstileToken(turnstileToken)
        if (!isValid) {
            return { error: 'CAPTCHA verification failed. Please try again.' }
        }
    }

    const adminSupabase = await createAdminClient()
    let generatedLink
    let authError
    try {
        const result = await adminSupabase.auth.admin.generateLink({
            type: 'signup',
            email,
            password,
            options: { data: { full_name: fullName.trim() } },
        })
        generatedLink = result.data
        authError = result.error
    } catch (error: unknown) {
        console.error('Signup error:', error)
        if (error instanceof Error && error.message.includes('fetch failed')) {
            return { error: 'Network error connecting to the server. Please try again later.' }
        }
        return { error: 'An unexpected error occurred during signup.' }
    }

    if (authError || !generatedLink?.user || !generatedLink.properties?.email_otp) {
        const isEmailTaken = authError?.message?.toLowerCase().includes('already registered') || 
                             authError?.message?.toLowerCase().includes('already been registered')
        return { error: isEmailTaken ? 'That email is already registered. Try logging in.' : (authError?.message || 'Failed to create verification code.') }
    }

    const delivery = await sendSignupVerificationCodeEmail(
        email,
        generatedLink.properties.email_otp,
        fullName.trim(),
    )

    if (!delivery.success) {
        // Do not leave an unreachable unverified account behind: once email
        // delivery is configured, the person must be able to retry signup.
        await adminSupabase.auth.admin.deleteUser(generatedLink.user.id)
        return { error: 'We could not send the verification email. Please try again after email delivery is configured.' }
    }

    return { success: true, requiresVerification: true, email }
}

export async function verifySignupCodeAction(emailInput: string, codeInput: string) {
    const email = emailInput.trim().toLowerCase()
    const code = codeInput.replace(/\s/g, '')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Invalid email address.' }
    if (!/^\d{6,8}$/.test(code)) return { error: 'Enter the full verification code from your email.' }

    const rateLimitError = await checkRateLimit('SIGNUP_VERIFY', 10, 900)
    if (rateLimitError) return { error: 'Too many attempts. Please wait and try again.' }

    const supabase = await createServerClient()
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' })
    if (error) {
        console.warn('Signup code verification failed', { code: error.code, status: error.status })
        return { error: 'That code is invalid or has expired. Use the code from the newest email, or start signup again.' }
    }

    return { success: true }
}
