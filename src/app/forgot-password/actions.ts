'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { sendPasswordResetCodeEmail } from '@/lib/email'

export type ForgotPasswordState = {
    error: string | null
    success: boolean
    email: string
}

export type ResetWithCodeState = {
    error: string | null
    success: boolean
}

export async function forgotPasswordAction(
    prevState: ForgotPasswordState,
    formData: FormData
): Promise<ForgotPasswordState> {
    const email = (formData.get('email') as string | null)?.trim().toLowerCase()
    const turnstileToken = formData.get('cf-turnstile-response') as string | null

    if (!email) return { error: 'Email is required.', success: false, email: '' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Invalid email address.', success: false, email: '' }

    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.', success: false, email: '' }
    }

    const rateLimitError = await checkRateLimit(
        'PASSWORD_RESET',
        RATE_LIMIT_RULES.PASSWORD_RESET.requests,
        RATE_LIMIT_RULES.PASSWORD_RESET.windowSeconds
    )
    if (rateLimitError) return { error: 'Too many requests. Please wait an hour before trying again.', success: false, email: '' }

    const supabase = await createAdminClient()
    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL || 'https://kkkhane.com'}/forgot-password`

    try {
        // Generate the recovery OTP without asking Supabase's SMTP service to
        // send it. This lets the same Brevo transport deliver both staff
        // invitations and recovery codes, while Supabase remains the authority
        // that validates and consumes the one-time code.
        const { data, error } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo },
        })

        if (!error && data.properties?.email_otp) {
            await sendPasswordResetCodeEmail(email, data.properties.email_otp)
        }
    } catch (error: unknown) {
        console.error('Forgot password error:', error)
    }

    // Always show the code-entry step, even when the address does not exist,
    // so this endpoint cannot be used to discover registered accounts.
    return { error: null, success: true, email }
}

export async function resetPasswordWithCodeAction(
    prevState: ResetWithCodeState,
    formData: FormData
): Promise<ResetWithCodeState> {
    const email = (formData.get('email') as string | null)?.trim().toLowerCase()
    const code = (formData.get('code') as string | null)?.replace(/\s/g, '')
    const password = formData.get('password') as string | null
    const confirmPassword = formData.get('confirmPassword') as string | null

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: 'Invalid email address.', success: false }
    }
    if (!code || !/^\d{6,8}$/.test(code)) {
        return { error: 'Enter the full verification code from your email.', success: false }
    }
    if (!password || password.length < 8) {
        return { error: 'Password must be at least 8 characters.', success: false }
    }
    if (password !== confirmPassword) {
        return { error: 'Passwords do not match.', success: false }
    }

    const rateLimitError = await checkRateLimit('PASSWORD_RESET_VERIFY', 10, 900)
    if (rateLimitError) return { error: 'Too many attempts. Please request a new code.', success: false }

    const supabase = await createServerClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'recovery',
    })

    if (verifyError) {
        return { error: 'That code is invalid or has expired. Request a new code and try again.', success: false }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
        return { error: updateError.message, success: false }
    }

    // Password recovery creates a session as part of OTP verification. End it
    // so the user explicitly proves the new password on the normal login page.
    await supabase.auth.signOut()
    return { error: null, success: true }
}
