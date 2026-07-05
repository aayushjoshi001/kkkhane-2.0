'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { randomBytes, createHash } from 'crypto'
import { checkRateLimit } from '@/lib/ratelimit'
import { TIER_LIMITS, type Tier } from '@/lib/tiers'
import { sendStaffInviteEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'

const INVITE_TTL_DAYS = 7
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function newToken() {
    return randomBytes(32).toString('hex')
}

function hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
}

const INVITATION_SELECT = 'id, email, role_id, status, expires_at, created_at, roles(id, name, description), invited_by(id, full_name)'

export async function createInvitationAction(input: { email: string; roleId: number }) {
    const currentUser = await getCurrentUser()
    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'You do not have permission to invite staff' }
    }

    const email = input.email.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return { error: 'Invalid email address' }

    // Only super_admin can grant super_admin — same rule as updateStaffRoleAction.
    if (input.roleId === 1 && currentUser.role !== 'super_admin') {
        return { error: 'Managers cannot invite super admin accounts' }
    }

    const rateLimitError = await checkRateLimit('STAFF_INVITE_CREATE', 20, 3600)
    if (rateLimitError) return { error: rateLimitError }

    const supabase = await createAdminClient()

    // Reject if this email is already a staff/customer account in this restaurant.
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('restaurant_id', currentUser.restaurantId)
        .eq('email', email)
        .maybeSingle()

    if (existingUser) {
        return { error: 'This email already belongs to an account in your restaurant' }
    }

    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('subscription_tier')
        .eq('id', currentUser.restaurantId)
        .single()

    const tier = (restaurant?.subscription_tier || 'free') as Tier
    const maxStaff = TIER_LIMITS[tier]?.max_staff ?? TIER_LIMITS.free.max_staff

    // Count active staff only — pending invites don't consume a seat yet;
    // the accept flow re-checks this to close the race.
    const { count: staffCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', currentUser.restaurantId)
        .neq('role_id', 5)

    if ((staffCount || 0) >= maxStaff) {
        return { error: `Staff limit reached. Your ${tier} plan allows ${maxStaff} staff members.` }
    }

    const token = newToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Re-inviting an email with a pending invite updates that row (new
    // token/expiry) instead of erroring on the partial unique index.
    const { data: pendingInvite } = await supabase
        .from('invitations')
        .select('id')
        .eq('restaurant_id', currentUser.restaurantId)
        .eq('email', email)
        .eq('status', 'pending')
        .maybeSingle()

    let invitationId: string
    if (pendingInvite) {
        const { error } = await supabase
            .from('invitations')
            .update({ role_id: input.roleId, token_hash: tokenHash, expires_at: expiresAt })
            .eq('id', pendingInvite.id)
        if (error) return { error: error.message }
        invitationId = pendingInvite.id
    } else {
        const { data: created, error } = await supabase
            .from('invitations')
            .insert({
                restaurant_id: currentUser.restaurantId,
                email,
                role_id: input.roleId,
                token_hash: tokenHash,
                invited_by: currentUser.id,
                expires_at: expiresAt,
            })
            .select('id')
            .single()
        if (error || !created) return { error: error?.message || 'Failed to create invitation' }
        invitationId = created.id
    }

    const { data: roleRow } = await supabase.from('roles').select('name').eq('id', input.roleId).single()
    const { data: restaurantRow } = await supabase.from('restaurants').select('name').eq('id', currentUser.restaurantId).single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://kkkhane.com'
    await sendStaffInviteEmail(
        email,
        restaurantRow?.name || 'your restaurant',
        roleRow?.name || 'staff',
        `${appUrl}/invite/${token}`,
        INVITE_TTL_DAYS,
    )

    await logAudit({
        restaurantId: currentUser.restaurantId,
        userId: currentUser.id,
        action: 'staff_invited',
        entityType: 'invitation',
        entityId: invitationId,
        newValue: { email, role_id: input.roleId },
    })

    const { data: invitation } = await supabase
        .from('invitations')
        .select(INVITATION_SELECT)
        .eq('id', invitationId)
        .single()

    revalidatePath('/admin/staff')
    return { success: true, invitation }
}

export async function revokeInvitationAction(invitationId: string) {
    const currentUser = await getCurrentUser()
    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'You do not have permission to manage invitations' }
    }

    const supabase = await createAdminClient()

    const { data: invitation } = await supabase
        .from('invitations')
        .select('restaurant_id')
        .eq('id', invitationId)
        .single()

    if (invitation?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const { error } = await supabase.from('invitations').update({ status: 'revoked' }).eq('id', invitationId)
    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function resendInvitationAction(invitationId: string) {
    const currentUser = await getCurrentUser()
    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'You do not have permission to manage invitations' }
    }

    const rateLimitError = await checkRateLimit('STAFF_INVITE_CREATE', 20, 3600)
    if (rateLimitError) return { error: rateLimitError }

    const supabase = await createAdminClient()

    const { data: invitation } = await supabase
        .from('invitations')
        .select('restaurant_id, email, role_id')
        .eq('id', invitationId)
        .single()

    if (invitation?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const token = newToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabase
        .from('invitations')
        .update({ status: 'pending', token_hash: tokenHash, expires_at: expiresAt })
        .eq('id', invitationId)

    if (error) return { error: error.message }

    const { data: roleRow } = await supabase.from('roles').select('name').eq('id', invitation.role_id).single()
    const { data: restaurantRow } = await supabase.from('restaurants').select('name').eq('id', invitation.restaurant_id).single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://kkkhane.com'
    await sendStaffInviteEmail(
        invitation.email,
        restaurantRow?.name || 'your restaurant',
        roleRow?.name || 'staff',
        `${appUrl}/invite/${token}`,
        INVITE_TTL_DAYS,
    )

    const { data: updatedInvitation } = await supabase
        .from('invitations')
        .select(INVITATION_SELECT)
        .eq('id', invitationId)
        .single()

    revalidatePath('/admin/staff')
    return { success: true, invitation: updatedInvitation }
}
