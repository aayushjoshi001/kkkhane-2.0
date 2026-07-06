// lib/auth.ts
// Unified role resolution helper — replaces the 10-line auth pattern
// duplicated across every admin/staff page.
'use server'

import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { getJwtClaims } from '@/lib/supabase/jwt'
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
async function safeGetUser(
    supabase: Awaited<ReturnType<typeof createServerClient>>
) {
    try {
        const { data, error } = await supabase.auth.getUser()
        if (error) return null
        return data.user
    } catch {
        return null
    }
}

async function _getCurrentUser(options?: { allowSuspended?: boolean }): Promise<CurrentUser> {
    const supabase = await createServerClient()
    const user = await safeGetUser(supabase)

    if (!user) {
        redirect('/login')
    }

    const adminSupabase = await createAdminClient()

    // Try JWT claims first (fast path — no DB call for role)
    const claims = await getJwtClaims()
    if (claims?.restaurant_id && claims?.app_role) {
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
            id: user.id,
            email: user.email || '',
            restaurantId: claims.restaurant_id,
            role: claims.app_role as RoleName,
        }
    }

    // Fallback: admin DB lookup (needed when JWT hasn't refreshed yet)
    const { data: userData } = await adminSupabase
        .from('users')
        .select('restaurant_id, roles(name), restaurants(is_suspended, subscription_expires_at, subscription_status)')
        .eq('id', user.id)
        .single()

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
        id: user.id,
        email: user.email || '',
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
    const user = await safeGetUser(supabase)

    if (!user) return null

    // Try JWT claims first
    const claims = await getJwtClaims()
    if (claims?.restaurant_id && claims?.app_role) {
        return {
            id: user.id,
            email: user.email || '',
            restaurantId: claims.restaurant_id,
            role: claims.app_role as RoleName,
        }
    }

    // Fallback DB lookup
    const adminSupabase = await createAdminClient()
    const { data: userData } = await adminSupabase
        .from('users')
        .select('restaurant_id, roles(name)')
        .eq('id', user.id)
        .single()

    if (!userData?.restaurant_id) {
        return {
            id: user.id,
            email: user.email || '',
            restaurantId: '',
            role: 'onboarding'
        }
    }

    const roleName = (userData.roles as unknown as { name: string } | null)?.name || 'waiter'

    return {
        id: user.id,
        email: user.email || '',
        restaurantId: userData.restaurant_id,
        role: roleName as RoleName,
    }
}
