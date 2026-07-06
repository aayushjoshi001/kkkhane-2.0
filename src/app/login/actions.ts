'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'
import { ROLE_LANDING } from '@/lib/roleLanding'
import { verifyTurnstileToken } from '@/lib/turnstile'

export async function loginAction(prevState: { error: string | null }, formData: FormData) {
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const explicitRedirect = formData.get('redirect') as string
    const turnstileToken = formData.get('cf-turnstile-response') as string | null

    if (!email || !password) {
        return { error: 'Email and password are required' }
    }

    // Rate limit: 5 attempts per 15 minutes per IP
    const rateLimitError = await checkRateLimit('LOGIN', RATE_LIMIT_RULES.LOGIN.requests, RATE_LIMIT_RULES.LOGIN.windowSeconds)
    if (rateLimitError) {
        return { error: 'Too many attempts. Please wait 15 minutes before trying again.' }
    }

    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.' }
    }

    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    if (email === 'newuser@srms.app' && password === 'Password123!') {
        try {
            await adminSupabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name: 'New Onboarding User' }
            })
        } catch (e) {
            // Ignore existing user errors or network errors on demo account creation
            console.error('Demo user creation error:', e)
        }
    }

    try {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            return { error: error.message }
        }
    } catch (err: any) {
        console.error('Login error:', err)
        if (err?.message?.includes('fetch failed') || err?.cause?.code) {
            return { error: 'Network connection failed. Please check your internet or try again later.' }
        }
        return { error: 'An unexpected error occurred during login. Please try again.' }
    }

    // If middleware bounced the user off a specific protected route, send them
    // back there instead of their role's default landing page.
    if (explicitRedirect) {
        redirect(explicitRedirect)
    }

    // Otherwise resolve the landing page the same way the rest of the app does —
    // getCurrentUser() already redirects to /onboarding or /suspended as needed,
    // so there's no need to re-derive role/restaurant state here by hand.
    const currentUser = await getCurrentUser()
    redirect(ROLE_LANDING[currentUser.role] || '/admin/dashboard')
}
