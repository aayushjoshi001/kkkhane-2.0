'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures } from '@/lib/features'
import { FINANCE_GATED_ROLES } from '@/types/database'
import { revalidatePath } from 'next/cache'
import { computeMonthlyAccrualPreview, insertAccruals } from '@/lib/payroll'
import { getNstDateString, getEffectiveJoinDate, isValidDateString, addDays } from '@/lib/timezone'

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

// Sets the date a staff member actually started working (distinct from
// created_at, which is when their account was created). Used to prorate
// their salary accrual — see computeMonthlyAccrualPreview in lib/payroll.ts.
export async function updateStaffJoinDateAction(userId: string, joinDate: string) {
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

    if (!isValidDateString(joinDate)) return { error: 'Invalid join date' }

    const { error } = await supabase
        .from('users')
        .update({ join_date: joinDate })
        .eq('id', userId)

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}

// Records a salary change effective from a given date, optionally ending on a
// given date (open-ended if omitted, i.e. "until the manager changes it
// again"). Scoped to a single staff member. Closes out any existing
// open-ended segment (or backfills the staff member's current flat salary as
// a historical segment) so accrual calculations never lose track of what was
// paid before the change. lib/payroll.ts looks up the correct rate per day
// from this history, so future accruals automatically use the new rate from
// effectiveFrom onward without any other code needing to change.
export async function increaseStaffSalaryAction(
    userId: string,
    newSalary: number,
    effectiveFrom: string,
    effectiveTo?: string | null
) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: targetUser } = await supabase
        .from('users')
        .select('restaurant_id, monthly_salary, join_date, created_at')
        .eq('id', userId)
        .single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) {
        return { error: 'Unauthorized' }
    }

    if (newSalary < 0) return { error: 'Salary cannot be negative' }
    if (!isValidDateString(effectiveFrom)) return { error: 'Invalid start date' }
    if (effectiveTo && !isValidDateString(effectiveTo)) return { error: 'Invalid end date' }
    if (effectiveTo && effectiveTo < effectiveFrom) return { error: 'End date must be on or after the start date' }

    const dayBeforeStr = addDays(effectiveFrom, -1)

    const { data: openSegment, error: openSegmentError } = await supabase
        .from('staff_salary_history')
        .select('id, monthly_salary, effective_from')
        .eq('user_id', userId)
        .is('effective_to', null)
        .maybeSingle()

    if (openSegmentError) return { error: openSegmentError.message }

    if (openSegment) {
        if (openSegment.effective_from >= effectiveFrom) {
            return { error: 'A salary change is already scheduled on or after this start date' }
        }
        const { error: closeError } = await supabase
            .from('staff_salary_history')
            .update({ effective_to: dayBeforeStr })
            .eq('id', openSegment.id)
        if (closeError) return { error: closeError.message }

        // If the new change has a defined end date (a temporary/backdated
        // adjustment), the old rate needs to keep covering the days after it
        // ends — otherwise accrual for that gap would silently fall back to
        // the flat monthly_salary instead of what was actually in effect.
        if (effectiveTo) {
            const { error: continuationError } = await supabase
                .from('staff_salary_history')
                .insert({
                    restaurant_id: currentUser.restaurantId,
                    user_id: userId,
                    monthly_salary: openSegment.monthly_salary,
                    effective_from: addDays(effectiveTo, 1),
                    effective_to: null,
                    created_by: currentUser.id
                })
            if (continuationError) return { error: continuationError.message }
        }
    } else if (Number(targetUser.monthly_salary) > 0) {
        const backfillFrom = getEffectiveJoinDate(targetUser.join_date, targetUser.created_at)
        if (backfillFrom < effectiveFrom) {
            const { error: backfillError } = await supabase
                .from('staff_salary_history')
                .insert({
                    restaurant_id: currentUser.restaurantId,
                    user_id: userId,
                    monthly_salary: targetUser.monthly_salary,
                    effective_from: backfillFrom,
                    effective_to: dayBeforeStr,
                    created_by: currentUser.id
                })
            if (backfillError) return { error: backfillError.message }
        }
    }

    const { error: insertError } = await supabase
        .from('staff_salary_history')
        .insert({
            restaurant_id: currentUser.restaurantId,
            user_id: userId,
            monthly_salary: newSalary,
            effective_from: effectiveFrom,
            effective_to: effectiveTo || null,
            created_by: currentUser.id
        })

    if (insertError) return { error: insertError.message }

    // If the new rate is already in effect today, refresh the flat
    // monthly_salary field so the rest of the UI shows the current rate
    const today = getNstDateString()
    if (effectiveFrom <= today && (!effectiveTo || effectiveTo >= today)) {
        await supabase.from('users').update({ monthly_salary: newSalary }).eq('id', userId)
    }

    revalidatePath('/admin/staff')
    return { success: true }
}

export async function recordLedgerTransactionAction(
    userId: string,
    amount: number,
    entryType: 'salary_payout' | 'advance_payment' | 'bonus' | 'deduction' | 'accrual',
    paymentMethod: 'cash' | 'bank_transfer' | 'qr_digital' | null,
    note: string | null,
    bankName?: string
) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    // Verify target user belongs to the same restaurant
    const { data: targetUser } = await supabase
        .from('users')
        .select('restaurant_id, full_name')
        .eq('id', userId)
        .single()

    if (targetUser?.restaurant_id !== currentUser.restaurantId) {
        return { error: 'Unauthorized' }
    }

    if (amount <= 0) return { error: 'Amount must be greater than zero' }

    const finalNote = note?.trim()
        ? `${note.trim()}` + (bankName ? ` (Paid via: ${bankName})` : '')
        : (bankName ? `Paid via: ${bankName}` : '')

    const { error } = await supabase
        .from('staff_ledger')
        .insert({
            restaurant_id: currentUser.restaurantId,
            user_id: userId,
            amount: amount,
            entry_type: entryType,
            payment_method: paymentMethod,
            note: finalNote || '',
            created_by: currentUser.id
        })

    if (error) return { error: error.message }

    // ── Auto-post matching entry to Day Book session if open and is a payout
    const isPayout = entryType === 'salary_payout' || entryType === 'advance_payment'
    if (isPayout && paymentMethod) {
        const now = new Date()
        const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000
        const todayDateNst = new Date(now.getTime() + NST_OFFSET_MS).toISOString().split('T')[0]

        const { data: openSession } = await supabase
            .from('day_book_sessions')
            .select('id')
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('date', todayDateNst)
            .eq('status', 'open')
            .maybeSingle()

        if (openSession) {
            const isCash = paymentMethod === 'cash'
            const dbType = isCash ? 'cash_out' : 'bank_out'
            const dbCategory = entryType === 'salary_payout' ? 'salary' : 'advance'
            const staffName = targetUser?.full_name || 'Staff'
            const dbDescription = `[Staff Payout] Paid ${entryType === 'salary_payout' ? 'Salary' : 'Advance'} to ${staffName}` + (note?.trim() ? ` (${note.trim()})` : '')

            await supabase
                .from('day_book_entries')
                .insert({
                    session_id: openSession.id,
                    type: dbType,
                    amount: amount,
                    description: dbDescription,
                    category: dbCategory,
                    bank_name: !isCash ? bankName?.trim() : null
                })
        }
    }

    revalidatePath('/admin/staff')
    revalidatePath('/admin/cash-book')
    revalidatePath('/admin/bank-book')
    revalidatePath('/admin/bank-ledger')
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

    // Fetch ledger entries AND fresh opening_balance in parallel
    const [ledgerResult, userResult] = await Promise.all([
        supabase
            .from('staff_ledger')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true }),
        supabase
            .from('users')
            .select('opening_balance, monthly_salary')
            .eq('id', userId)
            .single()
    ])

    if (ledgerResult.error) throw new Error(ledgerResult.error.message)

    return {
        entries: ledgerResult.data || [],
        openingBalance: userResult.data?.opening_balance ?? 0,
        monthlySalary: userResult.data?.monthly_salary ?? 0,
    }
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

export async function fetchAutoAccrualPreviewAction(year: number, month: number) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()
    return computeMonthlyAccrualPreview(supabase, currentUser.restaurantId, year, month)
}

export async function executeAutoAccrualAction(
    year: number,
    month: number,
    accruals: Array<{ userId: string; amount: number; note: string }>
) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    if (accruals.length === 0) return { success: true }

    try {
        await insertAccruals(supabase, currentUser.restaurantId, year, month, accruals, currentUser.id)
    } catch (e) {
        return { error: e instanceof Error ? e.message : 'Failed to record salary accruals' }
    }

    revalidatePath('/admin/staff')
    return { success: true }
}

