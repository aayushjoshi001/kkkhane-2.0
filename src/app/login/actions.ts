'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'
import { ROLE_LANDING } from '@/lib/roleLanding'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { provisionRestaurant } from '@/lib/provisioning'
import {
    DEMO_ACCOUNTS,
    DEMO_PASSWORD,
    DEMO_RESTAURANT,
    findDemoAccount,
    type DemoAccount,
} from '@/lib/demoAccounts'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

// Reference roles the app assumes exist. Seeded declaratively in
// supabase/seed.sql; upserted here too so demo login self-heals on any
// environment (e.g. a fresh local stack) without a manual `supabase db reset`.
const DEMO_ROLES = [
    { id: 1, name: 'super_admin', description: 'Full access to all restaurant operations and settings' },
    { id: 2, name: 'manager', description: 'Manages daily operations, staff, and menu' },
    { id: 3, name: 'kitchen', description: 'Views and updates order preparation status' },
    { id: 4, name: 'waiter', description: 'Takes and serves orders on the floor' },
    { id: 5, name: 'customer', description: 'Places orders via the QR menu' },
    { id: 6, name: 'cashier', description: 'Payment collection and bill settlement at the counter' },
]

// Create the auth user if missing; return its id either way. handle_new_user
// mirrors the email into public.users, so an existing account is recoverable
// by email even though admin.createUser() errors on a duplicate.
async function ensureDemoAuthUser(admin: AdminClient, account: DemoAccount): Promise<string | null> {
    const { data } = await admin.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
    })
    if (data?.user) return data.user.id

    const { data: existing } = await admin
        .from('users')
        .select('id')
        .eq('email', account.email)
        .maybeSingle()
    return existing?.id ?? null
}

// The single demo restaurant every staff demo account belongs to. Idempotent:
// looks up by slug first, only provisioning (menu, tables, settings) when absent.
async function ensureDemoRestaurant(admin: AdminClient): Promise<string | null> {
    const { data: existing } = await admin
        .from('restaurants')
        .select('id')
        .eq('slug', DEMO_RESTAURANT.slug)
        .maybeSingle()
    if (existing?.id) return existing.id

    const owner = DEMO_ACCOUNTS.find(a => a.isOwner)
    if (!owner) return null
    const ownerId = await ensureDemoAuthUser(admin, owner)
    if (!ownerId) return null

    const result = await provisionRestaurant({
        ownerId,
        ownerEmail: owner.email,
        ownerName: owner.fullName,
        name: DEMO_RESTAURANT.name,
        slug: DEMO_RESTAURANT.slug,
        businessType: DEMO_RESTAURANT.businessType,
        tier: 'pro',
    })
    if (result.restaurantId) return result.restaurantId

    // Provisioning may have lost a race (slug taken between our check and insert).
    console.error('Demo restaurant provisioning failed:', result.error)
    const { data: retry } = await admin
        .from('restaurants')
        .select('id')
        .eq('slug', DEMO_RESTAURANT.slug)
        .maybeSingle()
    return retry?.id ?? null
}

// Self-heal a demo account so its login always succeeds: ensure the auth user,
// its role, and (for staff) its membership in the shared demo restaurant exist.
async function provisionDemoAccount(admin: AdminClient, account: DemoAccount): Promise<void> {
    await admin.from('roles').upsert(DEMO_ROLES, { onConflict: 'id' })

    // Onboarding-only demo: a bare auth user with no restaurant/role so the
    // login lands on /onboarding.
    if (account.roleId === null) {
        await ensureDemoAuthUser(admin, account)
        return
    }

    const restaurantId = await ensureDemoRestaurant(admin)
    if (!restaurantId) return

    const userId = await ensureDemoAuthUser(admin, account)
    if (!userId) return

    await admin.from('users').upsert(
        {
            id: userId,
            restaurant_id: restaurantId,
            full_name: account.fullName,
            email: account.email,
            role_id: account.roleId,
            is_active: true,
        },
        { onConflict: 'id' },
    )
}

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

    // Self-heal built-in demo accounts on demand so their buttons always work,
    // even on a fresh database with no seeded users.
    const demoAccount = findDemoAccount(email)
    if (demoAccount && password === DEMO_PASSWORD) {
        try {
            await provisionDemoAccount(adminSupabase, demoAccount)
        } catch (e) {
            // Ignore existing-user / network errors on demo account creation.
            console.error('Demo account provisioning error:', e)
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
