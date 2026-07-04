'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/ratelimit'
import { TIER_LIMITS, type Tier } from '@/lib/tiers'
import { isPinEligibleRole } from '@/lib/staffPin'
import { generateStaffPin, generateStaffLoginEmail, generateDiscardPassword } from '@/lib/staffPin.server'

export interface CreateStaffPinResult {
    success?: true
    pin?: string
    staff?: {
        id: string
        full_name: string
        avatar_url: string | null
        is_active: boolean
        role_id: number
        created_at: string
        roles: { id: number; name: string; description: string | null } | null
    }
    error?: string
}

/**
 * Creates a POS staff account (waiter/kitchen/cashier) that logs in via a
 * 4-digit PIN instead of email+password. The PIN is shown to the admin
 * exactly once here — it's never emailed, and by design there's no forced
 * reset on first use (see docs: speed on shared terminals beats rotation).
 *
 * The PIN itself is never persisted — only a bcrypt hash (via the
 * verify_staff_pin/hash_staff_pin Postgres functions added in
 * 20260703050023_add_staff_pin_auth.sql), and the underlying Supabase Auth
 * user gets a synthetic, never-used email + a discarded random password
 * (Supabase requires *some* email/password pair to exist; actual staff
 * sign-in never touches either — see /login's staffPinLoginAction).
 */
export async function createStaffPinAction(input: { fullName: string; roleId: number }): Promise<CreateStaffPinResult> {
    const currentUser = await getCurrentUser()
    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'You do not have permission to create staff' }
    }

    const fullName = input.fullName.trim()
    if (fullName.length < 2) return { error: 'Full name is required (2+ characters)' }
    if (!isPinEligibleRole(input.roleId)) return { error: 'PIN login is only available for Waiter, Kitchen, and Cashier roles' }

    const rateLimitError = await checkRateLimit('STAFF_PIN_CREATE', 20, 3600)
    if (rateLimitError) return { error: rateLimitError }

    const supabase = await createAdminClient()

    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('subscription_tier')
        .eq('id', currentUser.restaurantId)
        .single()

    const tier = (restaurant?.subscription_tier || 'free') as Tier
    const maxStaff = TIER_LIMITS[tier]?.max_staff ?? TIER_LIMITS.free.max_staff

    const { count: staffCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', currentUser.restaurantId)
        .neq('role_id', 5) // exclude customers

    if ((staffCount || 0) >= maxStaff) {
        return { error: `Staff limit reached. Your ${tier} plan allows ${maxStaff} staff members.` }
    }

    const pin = generateStaffPin()
    const email = generateStaffLoginEmail()

    const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: generateDiscardPassword(),
        email_confirm: true,
        user_metadata: { full_name: fullName, pin_login: true },
    })

    if (authError || !createdUser.user) {
        return { error: authError?.message || 'Failed to create staff account' }
    }

    const userId = createdUser.user.id

    const { data: pinHash, error: hashError } = await supabase.rpc('hash_staff_pin', { p_pin: pin })
    if (hashError || !pinHash) {
        await supabase.auth.admin.deleteUser(userId)
        return { error: 'Failed to secure PIN. Please try again.' }
    }

    // The auth trigger creates the public.users row synchronously in the same
    // transaction as auth.users, so it already exists by the time createUser()
    // resolves — upsert by id rather than waiting an arbitrary delay then update.
    const { error: upsertError } = await supabase
        .from('users')
        .upsert({
            id: userId,
            restaurant_id: currentUser.restaurantId,
            full_name: fullName,
            role_id: input.roleId,
            is_active: true,
            pin_hash: pinHash,
        }, { onConflict: 'id' })

    if (upsertError) {
        await supabase.auth.admin.deleteUser(userId)
        return { error: `Failed to finish staff setup: ${upsertError.message}` }
    }

    const { data: newStaff } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, is_active, role_id, department_id, created_at, roles(id, name, description), departments(id, name)')
        .eq('id', userId)
        .single()

    revalidatePath('/admin/staff')

    return {
        success: true,
        pin,
        staff: newStaff as unknown as CreateStaffPinResult['staff'],
    }
}

export async function updateStaffRoleAction(userId: string, targetRoleId: number) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    // Verify target user belongs to the same restaurant
    const { data: targetUser } = await supabase
        .from('users')
        .select('restaurant_id')
        .eq('id', userId)
        .single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) {
        return { error: 'Unauthorized' }
    }

    // Managers cannot elevate anyone to super_admin (role_id: 1)
    if (currentUser.role === 'manager' && targetRoleId === 1) {
        return { error: 'Managers cannot assign super admin role' }
    }

    const { error } = await supabase
        .from('users')
        .update({ role_id: targetRoleId })
        .eq('id', userId)

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function toggleStaffStatusAction(userId: string, isActive: boolean) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users').select('restaurant_id').eq('id', userId).single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', userId)
    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function updateStaffNameAction(userId: string, fullName: string) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users').select('restaurant_id').eq('id', userId).single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const trimmed = fullName.trim()
    if (!trimmed) return { error: 'Name cannot be empty' }

    // Update display name in both tables
    const [{ error: dbError }, { error: authError }] = await Promise.all([
        supabase.from('users').update({ full_name: trimmed }).eq('id', userId),
        supabase.auth.admin.updateUserById(userId, { user_metadata: { full_name: trimmed } }),
    ])

    if (dbError || authError) return { error: dbError?.message || authError?.message || 'Failed to update name' }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function resetStaffPasswordAction(userId: string, newPassword: string) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users').select('restaurant_id').eq('id', userId).single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    if (newPassword.length < 8) return { error: 'Password must be at least 8 characters' }

    const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword })
    if (error) return { error: error.message }

    return { success: true }
}

export async function deleteStaffAction(userId: string) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users').select('restaurant_id, role_id').eq('id', userId).single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }
    // Managers cannot delete other managers or super admins
    if (currentUser.role === 'manager' && (targetUser?.role_id === 1 || targetUser?.role_id === 2)) {
        return { error: 'Insufficient permissions to delete this account' }
    }

    // Delete from public.users first, then auth
    await supabase.from('users').delete().eq('id', userId)
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

