// lib/auth.ts
// Unified role resolution helper — replaces the 10-line auth pattern
// duplicated across every admin/staff page.
'use server'

import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { RoleName } from '@/types/database'

export interface CurrentUser {
    id: string
    email: string
    restaurantId: string
    role: RoleName | 'onboarding'
}

// Cache the restaurant suspension status across requests (30s TTL).
// This is the single most expensive call in getCurrentUser — a full DB
// round-trip that previously ran on *every* page request for every staff user.
const getCachedRestaurantStatus = unstable_cache(
    async (restaurantId: string) => {
        const adminSupabase = await createAdminClient()
        const { data } = await adminSupabase
            .from('restaurants')
            .select('is_suspended, subscription_expires_at, subscription_status')
            .eq('id', restaurantId)
            .single()
        return data
    },
    ['restaurant-status'],
    { revalidate: 30 }
)

// getUser() surfaces an AuthApiError (`refresh_token_not_found`, 400) when the
// refresh token is stale. The proxy/middleware clears the bad cookie; a Server
// Component can't write cookies, so here we just treat it as logged-out so a
// stale token can't crash a render or spam the logs on every request.
//
// A *transient* failure is a different thing entirely. Treating a network blip or
// a rotation race (`refresh_token_already_used`, raised when parallel requests
// present the same refresh token) as "logged out" bounces a perfectly valid
// session to /login mid-navigation — the sudden-logout bug. Retry those once;
// only a genuinely rejected session falls through to null.
function isTransientAuthError(error: { code?: string; status?: number; name?: string }): boolean {
    // The rotation race: another concurrent request already swapped this refresh
    // token. The session is fine — the retry picks up the rotated cookie.
    if (error.code === 'refresh_token_already_used') return true
    if (error.name === 'AuthRetryableFetchError') return true
    // 5xx, or no response at all, is the auth server or the network — not a
    // statement about the user's session. A 4xx is a real rejection.
    const status = error.status ?? 0
    return status === 0 || status >= 500
}

// Identity from the access token instead of a network call to the auth server.
// getClaims() verifies the JWT signature locally against the process-global,
// 10-minute-cached JWKS (this project signs with asymmetric ES256 keys), so a
// valid token costs no round-trip — where getUser() hit /auth/v1/user on every
// page render. It also carries the custom claims (app_role, restaurant_id) the
// fast path needs, so one local read replaces getUser() + a second getJwtClaims().
// The middleware already refreshed the cookie, so here the token is current.
interface VerifiedClaims {
    sub: string
    email: string
    app_role?: string
    restaurant_id?: string
}

async function safeGetClaims(
    supabase: Awaited<ReturnType<typeof createServerClient>>
): Promise<VerifiedClaims | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const { data, error } = await supabase.auth.getClaims()
            if (!error) {
                const c = data?.claims as Record<string, unknown> | undefined
                if (!c?.sub) return null
                return {
                    sub: c.sub as string,
                    email: typeof c.email === 'string' ? c.email : '',
                    app_role: typeof c.app_role === 'string' ? c.app_role : undefined,
                    restaurant_id: typeof c.restaurant_id === 'string' ? c.restaurant_id : undefined,
                }
            }
            if (attempt === 0 && isTransientAuthError(error)) continue
            return null
        } catch {
            // A thrown failure is treated as transient on the first pass — a
            // refresh under getClaims can lose a rotation race, and the retry
            // picks up the rotated cookie. A second failure falls through to null.
            if (attempt === 0) continue
            return null
        }
    }
    return null
}

async function _getCurrentUser(options?: { allowSuspended?: boolean }): Promise<CurrentUser> {
    const supabase = await createServerClient()
    const claims = await safeGetClaims(supabase)

    if (!claims) {
        redirect('/login')
    }

    const adminSupabase = await createAdminClient()

    // Platform super admin has no tenant of its own — it operates across every
    // restaurant from the /admin/super-admin console. Short-circuit before any
    // restaurant lookup / suspension logic (which all assume a restaurant_id) and
    // crucially before the onboarding redirect below, so a restaurant-less
    // super_admin lands on its dashboard instead of being bounced to /onboarding.
    if (claims.app_role === 'super_admin') {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: claims.restaurant_id ?? '',
            role: 'super_admin',
        }
    }

    // Fast path — the token already carries restaurant_id + app_role (production,
    // where the custom_access_token hook is enabled), so no DB call for the role.
    if (claims.restaurant_id && claims.app_role) {
        const rest = await getCachedRestaurantStatus(claims.restaurant_id)

        // Lazy auto-suspend: if subscription lapsed and not yet suspended, do it now
        if (
            rest &&
            !rest.is_suspended &&
            rest.subscription_expires_at &&
            new Date(rest.subscription_expires_at) < new Date() &&
            rest.subscription_status !== 'suspended' &&
            rest.subscription_status !== 'cancelled'
        ) {
            await adminSupabase
                .from('restaurants')
                .update({ is_suspended: true, subscription_status: 'suspended' })
                .eq('id', claims.restaurant_id)
            redirect('/suspended')
        }

        const isOwnerOrManager = claims.app_role === 'owner' || claims.app_role === 'manager'
        
        if (rest?.is_suspended && !options?.allowSuspended) {
            if (isOwnerOrManager) redirect('/admin/billing/packages')
            else redirect('/suspended')
        }

        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: claims.restaurant_id,
            role: claims.app_role as RoleName,
        }
    }

    // Fallback: admin DB lookup for the role/restaurant. Needed when the token
    // carries no custom claims — a brand-new user mid-onboarding, or any request
    // in an environment where the custom_access_token hook isn't enabled (local).
    const { data: userData } = await adminSupabase
        .from('users')
        .select('restaurant_id, roles(name), restaurants(is_suspended, subscription_expires_at, subscription_status)')
        .eq('id', claims.sub)
        .single()

    const fallbackRole = (userData?.roles as unknown as { name: string } | null)?.name

    // Platform super admin: valid with no restaurant. Mirror the fast-path branch
    // so the onboarding redirect below never fires for it.
    if (fallbackRole === 'super_admin') {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: userData?.restaurant_id ?? '',
            role: 'super_admin',
        }
    }

    if (!userData?.restaurant_id) {
        redirect('/onboarding')
    }

    const restaurant = userData.restaurants as unknown as {
        is_suspended?: boolean
        subscription_expires_at?: string | null
        subscription_status?: string
    } | null

    // Lazy auto-suspend on fallback path too
    if (
        restaurant &&
        !restaurant.is_suspended &&
        restaurant.subscription_expires_at &&
        new Date(restaurant.subscription_expires_at) < new Date() &&
        restaurant.subscription_status !== 'suspended' &&
        restaurant.subscription_status !== 'cancelled'
    ) {
        await adminSupabase
            .from('restaurants')
            .update({ is_suspended: true, subscription_status: 'suspended' })
            .eq('id', userData.restaurant_id)
        redirect('/suspended')
    }

    const isSuspended = restaurant?.is_suspended
    const roleName = (userData.roles as unknown as { name: string } | null)?.name || 'waiter'

    if (isSuspended && !options?.allowSuspended) {
        if (roleName === 'owner' || roleName === 'manager') redirect('/admin/billing/packages')
        else redirect('/suspended')
    }

    return {
        id: claims.sub,
        email: claims.email,
        restaurantId: userData.restaurant_id,
        role: roleName as RoleName,
    }
}

// React.cache deduplicates within a single render tree: layout + page both call
// getCurrentUser() but with this wrapper, the DB call only runs once per request.
export const getCurrentUser = cache(_getCurrentUser)

export async function requireRoleWithOptions(
    allowedRoles: RoleName[],
    options?: { allowSuspended?: boolean }
): Promise<CurrentUser> {
    const currentUser = await getCurrentUser(options)

    if (!allowedRoles.includes(currentUser.role as RoleName)) {
        redirect('/unauthorized')
    }

    return currentUser
}

/**
 * Require a specific role (or set of roles).
 * Redirects to /unauthorized if the user doesn't have the required role.
 */
export async function requireRole(...allowedRoles: RoleName[]): Promise<CurrentUser> {
    const currentUser = await getCurrentUser()

    // currentUser.role may be 'onboarding' (not a RoleName); such users are never
    // in an allowedRoles list, so the cast is safe and preserves the redirect.
    if (!allowedRoles.includes(currentUser.role as RoleName)) {
        redirect('/unauthorized')
    }

    return currentUser
}

/**
 * Lightweight auth check — returns CurrentUser or null (no redirect).
 * Useful for the root `/` page where we want to check without forcing login.
 */
export async function getOptionalUser(): Promise<CurrentUser | null> {
    const supabase = await createServerClient()
    const claims = await safeGetClaims(supabase)

    if (!claims) return null

    // Platform super admin has no tenant — surface it as a real role, not as an
    // onboarding user, so callers don't treat it as needing a restaurant.
    if (claims.app_role === 'super_admin') {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: claims.restaurant_id ?? '',
            role: 'super_admin',
        }
    }

    // Fast path — token carries the custom claims (production).
    if (claims.restaurant_id && claims.app_role) {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: claims.restaurant_id,
            role: claims.app_role as RoleName,
        }
    }

    // Fallback DB lookup
    const adminSupabase = await createAdminClient()
    const { data: userData } = await adminSupabase
        .from('users')
        .select('restaurant_id, roles(name)')
        .eq('id', claims.sub)
        .single()

    const fallbackRole = (userData?.roles as unknown as { name: string } | null)?.name

    if (fallbackRole === 'super_admin') {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: userData?.restaurant_id ?? '',
            role: 'super_admin',
        }
    }

    if (!userData?.restaurant_id) {
        return {
            id: claims.sub,
            email: claims.email,
            restaurantId: '',
            role: 'onboarding'
        }
    }

    const roleName = (userData.roles as unknown as { name: string } | null)?.name || 'waiter'

    return {
        id: claims.sub,
        email: claims.email,
        restaurantId: userData.restaurant_id,
        role: roleName as RoleName,
    }
}
