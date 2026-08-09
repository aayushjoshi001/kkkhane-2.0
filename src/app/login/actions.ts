'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { ensureAutoClockIn } from '@/lib/autoClockIn'
import { redirect } from 'next/navigation'
import { checkRateLimit, RATE_LIMIT_RULES } from '@/lib/ratelimit'
import { ROLE_LANDING } from '@/lib/roleLanding'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { provisionRestaurant } from '@/lib/provisioning'
import { seedDemoHotel } from '@/lib/demoHotel'
import {
    DEMO_ACCOUNTS,
    DEMO_PASSWORD,
    DEMO_LOGIN_ENABLED,
    DEMO_TENANTS,
    findDemoAccount,
    type DemoAccount,
    type DemoTenant,
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

// Ensure the demo restaurant for a tenant (Restaurant or Hotel) exists.
// Idempotent: looks up by slug first, only provisioning (menu, tables, settings)
// when absent. For the hotel tenant it also seeds rooms, bookings and a live
// in-room order so the check-in → order → checkout flow is demoable immediately.
async function ensureDemoTenant(admin: AdminClient, tenant: DemoTenant): Promise<string | null> {
    const cfg = DEMO_TENANTS[tenant]

    const { data: existing } = await admin
        .from('restaurants')
        .select('id')
        .eq('slug', cfg.slug)
        .maybeSingle()
    let restaurantId = existing?.id ?? null

    if (!restaurantId) {
        const owner = DEMO_ACCOUNTS.find(a => a.isOwner && a.tenant === tenant)
        if (!owner) return null
        const ownerId = await ensureDemoAuthUser(admin, owner)
        if (!ownerId) return null

        const result = await provisionRestaurant({
            ownerId,
            ownerEmail: owner.email,
            ownerName: owner.fullName,
            name: cfg.name,
            slug: cfg.slug,
            businessType: cfg.businessType,
            tier: 'premium',
        })
        restaurantId = result.restaurantId ?? null

        if (!restaurantId) {
            // Provisioning may have lost a race (slug taken between check and insert).
            console.error('Demo tenant provisioning failed:', result.error)
            const { data: retry } = await admin
                .from('restaurants')
                .select('id')
                .eq('slug', cfg.slug)
                .maybeSingle()
            restaurantId = retry?.id ?? null
        }
    }

    // Route the demo's drinks to the bar so the BOT board isn't empty. Runs on
    // every demo login (not just first provisioning) so a demo restaurant seeded
    // before the station split still showcases the kitchen/bar routing. Idempotent
    // and best-effort.
    if (restaurantId) {
        try {
            await admin
                .from('menu_categories')
                .update({ station: 'bar' })
                .eq('restaurant_id', restaurantId)
                .in('name', ['Beverages', 'Drinks', 'Bar'])
                .neq('station', 'bar')
        } catch (e) {
            console.error('Demo bar-category tag failed:', e)
        }
    }

    // Seed hotel-specific data (rooms, bookings, room-numbered tables). Idempotent
    // and best-effort — a seeding hiccup must never block the demo login.
    if (restaurantId && tenant === 'hotel') {
        try {
            await seedDemoHotel(admin, restaurantId)
        } catch (e) {
            console.error('Demo hotel seed failed:', e)
        }
    }

    return restaurantId
}

// Self-heal a demo account so its login always succeeds: ensure the auth user,
// its role, and (for staff) its membership in its tenant's demo restaurant exist.
async function provisionDemoAccount(admin: AdminClient, account: DemoAccount): Promise<void> {
    await admin.from('roles').upsert(DEMO_ROLES, { onConflict: 'id' })

    // Onboarding-only demo: a bare auth user with no restaurant/role so the
    // login lands on /onboarding.
    if (account.roleId === null) {
        await ensureDemoAuthUser(admin, account)
        return
    }

    const restaurantId = await ensureDemoTenant(admin, account.tenant)
    if (!restaurantId) return

    const userId = await ensureDemoAuthUser(admin, account)
    if (!userId) return

    const roleId = await resolveRoleId(admin, account)
    if (!roleId) return

    await admin.from('users').upsert(
        {
            id: userId,
            restaurant_id: restaurantId,
            full_name: account.fullName,
            email: account.email,
            role_id: roleId,
            is_active: true,
        },
        { onConflict: 'id' },
    )
}

// Resolve the account's role id. Accounts pinned to a stable seed id (1-6) use
// it directly; accounts carrying roleName (bartender) resolve by name because
// that role's id varies by environment. If the role is somehow absent it is
// created at MAX(id)+1 — the same rule the migration and seed use — so demo
// login self-heals even on an environment that missed the migration.
async function resolveRoleId(admin: AdminClient, account: DemoAccount): Promise<number | null> {
    if (!account.roleName) return account.roleId

    const { data: existing } = await admin
        .from('roles')
        .select('id')
        .eq('name', account.roleName)
        .maybeSingle()
    if (existing?.id) return existing.id

    const { data: max } = await admin
        .from('roles')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()
    const nextId = (max?.id ?? 0) + 1
    const { data: created } = await admin
        .from('roles')
        .insert({ id: nextId, name: account.roleName, description: 'Views and updates drink preparation status at the bar' })
        .select('id')
        .maybeSingle()
    return created?.id ?? null
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
    // even on a fresh database with no seeded users. Disabled on the production
    // deployment (DEMO_LOGIN_ENABLED) so a stranger can't recreate/reset a demo
    // account there by POSTing the known password — the chips are hidden there too.
    const demoAccount = findDemoAccount(email)
    if (DEMO_LOGIN_ENABLED && demoAccount && password === DEMO_PASSWORD) {
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
    if (currentUser.id && currentUser.restaurantId) {
        await ensureAutoClockIn(currentUser.id, currentUser.restaurantId, { forceNewShift: true })
    }
    redirect(ROLE_LANDING[currentUser.role] || '/admin/dashboard')
}
