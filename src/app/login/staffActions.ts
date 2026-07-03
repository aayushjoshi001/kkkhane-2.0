'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/ratelimit'
import { ROLE_LANDING } from '@/lib/roleLanding'
import { PIN_ELIGIBLE_ROLE_IDS } from '@/lib/staffPin'

export interface TerminalStaffMember {
    id: string
    full_name: string
    avatar_url: string | null
    role_id: number
    roleName: string
}

export interface TerminalResult {
    restaurant?: { id: string; name: string; logoUrl: string | null }
    staff?: TerminalStaffMember[]
    error?: string
}

/**
 * Public (unauthenticated) lookup used by the staff-login screen — given the
 * restaurant slug a terminal is pinned to, returns just enough to render the
 * name grid. Deliberately excludes anything sensitive (email, pin_hash) and
 * anything that isn't PIN-eligible (managers/super admins always use
 * email+password, never show up here even if they had a pin_hash).
 */
export async function getActiveStaffForTerminal(slugRaw: string): Promise<TerminalResult> {
    const slug = slugRaw.trim().toLowerCase()
    if (!slug) return { error: 'Enter your restaurant code' }

    const rateLimitError = await checkRateLimit('STAFF_TERMINAL_LOOKUP', 30, 300)
    if (rateLimitError) return { error: rateLimitError }

    const supabase = await createAdminClient()

    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('id, name, logo_url, is_suspended')
        .eq('slug', slug)
        .maybeSingle()

    if (!restaurant || restaurant.is_suspended) {
        return { error: 'No restaurant found for that code' }
    }

    const { data: staff } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, role_id, roles(name)')
        .eq('restaurant_id', restaurant.id)
        .eq('is_active', true)
        .in('role_id', PIN_ELIGIBLE_ROLE_IDS as unknown as number[])
        .order('full_name', { ascending: true })

    return {
        restaurant: { id: restaurant.id, name: restaurant.name, logoUrl: restaurant.logo_url },
        staff: (staff || []).map(s => ({
            id: s.id,
            full_name: s.full_name,
            avatar_url: s.avatar_url,
            role_id: s.role_id,
            roleName: (s.roles as unknown as { name: string } | null)?.name || '',
        })),
    }
}

export interface PinLoginResult {
    success?: true
    landing?: string
    error?: string
}

/**
 * Verifies a staff member's PIN and, on success, mints a real session
 * server-side via Supabase's magic-link token exchange — the synthetic
 * account's email/discard-password are never used for sign-in, only
 * pin_hash (checked in Postgres via verify_staff_pin) gates access.
 */
export async function staffPinLoginAction(params: { userId: string; restaurantId: string; pin: string }): Promise<PinLoginResult> {
    const { userId, restaurantId, pin } = params

    if (!/^\d{4}$/.test(pin)) return { error: 'Incorrect PIN' }

    // Two-layer throttling: per (user, IP) to stop targeted brute force, and a
    // broader per-IP cap to stop one device scanning through many staff IDs.
    const [perUserLimit, perIpLimit] = await Promise.all([
        checkRateLimit(`PIN_LOGIN_USER_${userId}`, 5, 900),
        checkRateLimit('PIN_LOGIN_IP', 20, 900),
    ])
    if (perUserLimit) return { error: perUserLimit }
    if (perIpLimit) return { error: perIpLimit }

    const adminSupabase = await createAdminClient()

    const { data: user } = await adminSupabase
        .from('users')
        .select('id, email, restaurant_id, role_id, is_active, roles(name)')
        .eq('id', userId)
        .single()

    const roleName = (user?.roles as unknown as { name: string } | null)?.name || ''

    if (
        !user ||
        !user.is_active ||
        !user.email ||
        user.restaurant_id !== restaurantId ||
        !(PIN_ELIGIBLE_ROLE_IDS as readonly number[]).includes(user.role_id)
    ) {
        // Generic error — never reveal *why* (no such user vs. wrong restaurant vs. wrong role).
        return { error: 'Incorrect PIN' }
    }

    const { data: pinValid } = await adminSupabase.rpc('verify_staff_pin', { p_user_id: userId, p_pin: pin })
    if (!pinValid) return { error: 'Incorrect PIN' }

    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: user.email,
    })
    if (linkError || !linkData?.properties?.hashed_token) {
        return { error: 'Login failed. Please try again.' }
    }

    const serverClient = await createServerClient()
    const { error: verifyError } = await serverClient.auth.verifyOtp({
        email: user.email,
        token_hash: linkData.properties.hashed_token,
        type: 'magiclink',
    })
    if (verifyError) return { error: 'Login failed. Please try again.' }

    return { success: true, landing: ROLE_LANDING[roleName] || '/login' }
}
