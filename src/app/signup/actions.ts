'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/ratelimit'
import { verifyTurnstileToken } from '@/lib/turnstile'

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
    const serverSupabase = await createServerClient()

    let createdUser;
    let authError;
    try {
        const result = await adminSupabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { full_name: fullName.trim() },
        })
        createdUser = result.data
        authError = result.error
    } catch (e: any) {
        console.error('Signup error:', e)
        if (e?.message?.includes('fetch failed') || e?.cause?.code) {
            return { error: 'Network error connecting to the server. Please try again later.' }
        }
        return { error: 'An unexpected error occurred during signup.' }
    }

    if (authError || !createdUser?.user) {
        const isEmailTaken = authError?.message?.toLowerCase().includes('already registered') || 
                             authError?.message?.toLowerCase().includes('already been registered')
        return { error: isEmailTaken ? 'That email is already registered. Try logging in.' : (authError?.message || 'Failed to create account.') }
    }

    try {
        const { error: signInError } = await serverSupabase.auth.signInWithPassword({
            email,
            password,
        })

        if (signInError) {
            return { error: 'Account created, but failed to log in automatically. Please log in manually.' }
        }
    } catch (e) {
        return { error: 'Account created, but a network error prevented automatic login. Please log in manually.' }
    }

    return { success: true }
}
