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

    try {
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
    } catch (err: any) {
        console.error('Terminal lookup error:', err)
        return { error: 'Network error connecting to the server.' }
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

    try {
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
    } catch (err: any) {
        console.error('Staff PIN login error:', err)
        if (err?.message?.includes('fetch failed') || err?.cause?.code) {
            return { error: 'Network connection failed. Please check your internet or try again later.' }
        }
        return { error: 'An unexpected error occurred during login.' }
    }

    return { success: true, landing: ROLE_LANDING[roleName] || '/login' }
}

/**
 * Validates a manager/owner's credentials to authorize wiping the terminal slug
 * from a POS device, ensuring cashiers cannot unpair a terminal themselves.
 */
export async function authorizeUnpairAction(params: { email: string; password: string }): Promise<{ success?: boolean; error?: string }> {
    const { email, password } = params

    if (!email || !password) return { error: 'Email and password are required' }

    const rateLimitError = await checkRateLimit('UNPAIR_TERMINAL', 5, 900)
    if (rateLimitError) return { error: rateLimitError }

    const adminSupabase = await createAdminClient()

    // We just need to verify the password, so we use signInWithPassword on a dummy client,
    // or just use admin auth. Supabase admin does not have a direct verify password method.
    // The easiest way is to use a standard client to attempt a login.
    const tempClient = await createServerClient()
    let signInData;
    
    try {
        const { data, error } = await tempClient.auth.signInWithPassword({
            email,
            password
        })

        if (error || !data.user) {
            return { error: 'Invalid manager credentials' }
        }
        signInData = data;
    } catch (err: any) {
        console.error('Authorize unpair error:', err)
        if (err?.message?.includes('fetch failed') || err?.cause?.code) {
            return { error: 'Network connection failed. Please check your internet or try again later.' }
        }
        return { error: 'An unexpected error occurred. Please try again.' }
    }

    // Now check if this user is actually a manager or super_admin
    const { data: userData } = await adminSupabase
        .from('users')
        .select('role_id, roles(name)')
        .eq('id', signInData.user.id)
        .single()

    const roleName = (userData?.roles as unknown as { name: string } | null)?.name
    
    // We must sign them out immediately since we are just checking credentials, 
    // we don't want the terminal browser to actually hold this manager's session.
    await tempClient.auth.signOut()

    if (roleName !== 'manager' && roleName !== 'super_admin') {
        return { error: 'Only managers can unpair a terminal' }
    }

    return { success: true }
}
