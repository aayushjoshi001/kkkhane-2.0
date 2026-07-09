'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures } from '@/lib/features'
import { FINANCE_GATED_ROLES } from '@/types/database'
import { revalidatePath } from 'next/cache'

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

    // Finance-plan gate: these roles only exist for the enterprise finance
    // feature, so block assignment while it is disabled.
    const { data: targetRole } = await supabase
        .from('roles')
        .select('name')
        .eq('id', targetRoleId)
        .single()
    if (targetRole && (FINANCE_GATED_ROLES as readonly string[]).includes(targetRole.name)) {
        const features = await getRestaurantFeatures(currentUser.restaurantId)
        if (!features?.financeEnabled) {
            return { error: 'This role requires the Enterprise Finance plan' }
        }
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

export async function updateStaffSalaryAction(userId: string, salary: number) {
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

    if (salary < 0) return { error: 'Salary cannot be negative' }

    const { error } = await supabase
        .from('users')
        .update({ monthly_salary: salary })
        .eq('id', userId)

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function recordLedgerTransactionAction(
    userId: string,
    amount: number,
    entryType: 'salary_payout' | 'advance_payment' | 'bonus' | 'deduction' | 'accrual',
    paymentMethod: 'cash' | 'bank_transfer' | 'qr_digital' | null,
    note: string | null
) {
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

    if (amount <= 0) return { error: 'Amount must be greater than zero' }

    const { error } = await supabase
        .from('staff_ledger')
        .insert({
            restaurant_id: currentUser.restaurantId,
            user_id: userId,
            amount: amount,
            entry_type: entryType,
            payment_method: paymentMethod,
            note: note || '',
            created_by: currentUser.id
        })

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function fetchStaffLedgerAction(userId: string) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    // Verify target user belongs to the same restaurant
    const { data: targetUser } = await supabase
        .from('users')
        .select('restaurant_id')
        .eq('id', userId)
        .single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) {
        throw new Error('Unauthorized')
    }

    const { data, error } = await supabase
        .from('staff_ledger')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)
    return data
}

export async function updateOpeningBalanceAction(userId: string, openingBalance: number) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users')
        .select('restaurant_id')
        .eq('id', userId)
        .single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) {
        return { error: 'Unauthorized' }
    }

    if (openingBalance < 0) return { error: 'Opening balance cannot be negative' }

    const { error } = await supabase
        .from('users')
        .update({ opening_balance: openingBalance })
        .eq('id', userId)

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}
