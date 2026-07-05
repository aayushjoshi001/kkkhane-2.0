'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/ratelimit'
import { TIER_LIMITS, type Tier } from '@/lib/tiers'
import { ROLE_LANDING } from '@/lib/roleLanding'
import { logAudit } from '@/lib/audit'
import { createHash } from 'crypto'

function hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
}

const GENERIC_ERROR = 'This invite link is no longer valid.'

export async function acceptInvitationAction(
    token: string,
    input: { fullName: string; password: string }
) {
    const rateLimitError = await checkRateLimit('INVITE_ACCEPT', 10, 900)
    if (rateLimitError) return { error: rateLimitError }

    const fullName = input.fullName.trim()
    if (fullName.length < 2) return { error: 'Full name is required (2+ characters)' }
    if (input.password.length < 8) return { error: 'Password must be at least 8 characters' }

    const supabase = await createAdminClient()
    const tokenHash = hashToken(token)

    const { data: invitation } = await supabase
        .from('invitations')
        .select('id, restaurant_id, email, role_id, status, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle()

    if (!invitation || invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
        return { error: GENERIC_ERROR }
    }

    // Re-check the seat limit at accept-time (an invite can sit pending for
    // days — the org may have filled up since it was sent). Leave the
    // invitation pending so the link still works once a seat frees up.
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('subscription_tier')
        .eq('id', invitation.restaurant_id)
        .single()

    const tier = (restaurant?.subscription_tier || 'free') as Tier
    const maxStaff = TIER_LIMITS[tier]?.max_staff ?? TIER_LIMITS.free.max_staff

    const { count: staffCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', invitation.restaurant_id)
        .neq('role_id', 5)

    if ((staffCount || 0) >= maxStaff) {
        return { error: 'This restaurant has reached its staff limit. Please contact your manager.' }
    }

    // Race guard: manual creation may have used this email after the invite was sent.
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('restaurant_id', invitation.restaurant_id)
        .eq('email', invitation.email)
        .maybeSingle()

    if (existingUser) return { error: GENERIC_ERROR }

    const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
        email: invitation.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    })

    if (authError || !createdUser.user) {
        return { error: authError?.message || 'Failed to create your account' }
    }

    const userId = createdUser.user.id

    const { error: upsertError } = await supabase
        .from('users')
        .upsert({
            id: userId,
            restaurant_id: invitation.restaurant_id,
            full_name: fullName,
            role_id: invitation.role_id,
            is_active: true,
        }, { onConflict: 'id' })

    if (upsertError) {
        await supabase.auth.admin.deleteUser(userId)
        return { error: `Failed to finish account setup: ${upsertError.message}` }
    }

    await supabase
        .from('invitations')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invitation.id)

    const { data: roleRow } = await supabase.from('roles').select('name').eq('id', invitation.role_id).single()

    await logAudit({
        restaurantId: invitation.restaurant_id,
        userId,
        action: 'staff_invite_accepted',
        entityType: 'invitation',
        entityId: invitation.id,
        newValue: { accepted: true },
    })

    // We already have the plaintext password the user just chose — sign in
    // directly rather than a magic-link round trip.
    const serverClient = await createServerClient()
    const { error: signInError } = await serverClient.auth.signInWithPassword({
        email: invitation.email,
        password: input.password,
    })

    if (signInError) return { error: signInError.message }

    const roleName = roleRow?.name || 'onboarding'
    return { success: true, landing: ROLE_LANDING[roleName] || '/admin/dashboard' }
}
