'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function getActiveShiftsAction(restaurantId: string) {
    const currentUser = await requireRole('manager', 'super_admin')
    if (restaurantId !== currentUser.restaurantId) return { data: [], error: 'Unauthorized' }
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('staff_shifts')
        .select('*, users(full_name, role_id, roles(name))')
        .eq('restaurant_id', restaurantId)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
    return { data: data || [] }
}

export async function getRecentShiftsAction(restaurantId: string, limit = 50) {
    const currentUser = await requireRole('manager', 'super_admin')
    if (restaurantId !== currentUser.restaurantId) return { data: [], error: 'Unauthorized' }
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('staff_shifts')
        .select('*, users(full_name, role_id, roles(name))')
        .eq('restaurant_id', restaurantId)
        .not('clock_out', 'is', null)
        .order('clock_in', { ascending: false })
        .limit(limit)
    return { data: data || [] }
}

export async function approveShiftAction(shiftId: string) {
    // The approver is whoever is signed in — it was previously passed from the
    // client, which sent the shift's own user_id, so every approval recorded
    // the staff member as their own approver.
    const currentUser = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error, count } = await supabase
        .from('staff_shifts')
        .update({ is_approved: true, approved_by: currentUser.id }, { count: 'exact' })
        .eq('id', shiftId)
        .eq('restaurant_id', currentUser.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Shift not found.' }
    revalidatePath('/admin/shifts')
    return { success: true }
}

/**
 * Manager corrects a shift's clock-in/clock-out time and break minutes.
 * Recalculates hours_worked. Resets is_approved so the correction gets re-reviewed.
 */
export async function correctShiftAction(
    shiftId: string,
    correction: {
        clock_in?: string   // ISO datetime
        clock_out?: string  // ISO datetime
        break_minutes?: number
        notes?: string
    }
): Promise<{ error?: string; success?: boolean }> {
    const currentUser = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: shift } = await supabase
        .from('staff_shifts')
        .select('clock_in, clock_out, break_minutes, restaurant_id')
        .eq('id', shiftId)
        .single()

    if (!shift) return { error: 'Shift not found' }

    const newClockIn = correction.clock_in ?? shift.clock_in
    const newClockOut = correction.clock_out ?? shift.clock_out
    const newBreakMins = correction.break_minutes ?? shift.break_minutes ?? 0

    let hoursWorked: number | null = null
    if (newClockIn && newClockOut) {
        const totalMins = (new Date(newClockOut).getTime() - new Date(newClockIn).getTime()) / 60000
        hoursWorked = Math.max(0, Math.round((totalMins - newBreakMins) / 60 * 100) / 100)
    }

    const { error } = await supabase
        .from('staff_shifts')
        .update({
            clock_in: newClockIn,
            clock_out: newClockOut ?? null,
            break_minutes: newBreakMins,
            hours_worked: hoursWorked,
            notes: correction.notes !== undefined ? correction.notes : undefined,
            is_approved: false, // reset — corrected shift needs re-approval
        })
        .eq('id', shiftId)

    if (error) return { error: error.message }

    void logAudit({
        restaurantId: shift.restaurant_id,
        userId: currentUser.id,
        action: 'shift_corrected',
        entityType: 'shift',
        entityId: shiftId,
        oldValue: { clock_in: shift.clock_in, clock_out: shift.clock_out, break_minutes: shift.break_minutes },
        newValue: { clock_in: newClockIn, clock_out: newClockOut, break_minutes: newBreakMins, hours_worked: hoursWorked },
    })

    revalidatePath('/admin/shifts')
    return { success: true }
}

export async function forceClockOutAction(shiftId: string) {
    const currentUser = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const now = new Date().toISOString()

    // Get shift for hours calculation
    const { data: shift } = await supabase
        .from('staff_shifts')
        .select('clock_in, break_minutes')
        .eq('id', shiftId)
        .eq('restaurant_id', currentUser.restaurantId)
        .single()

    if (!shift) return { error: 'Shift not found' }

    const clockIn = new Date(shift.clock_in)
    const clockOut = new Date(now)
    const totalMinutes = (clockOut.getTime() - clockIn.getTime()) / 60000
    const hoursWorked = Math.max(0, (totalMinutes - (shift.break_minutes || 0)) / 60)

    const { error, count } = await supabase
        .from('staff_shifts')
        .update({ clock_out: now, hours_worked: Math.round(hoursWorked * 100) / 100 }, { count: 'exact' })
        .eq('id', shiftId)
        .eq('restaurant_id', currentUser.restaurantId)
    if (error) return { error: error.message }
    if (!count) return { error: 'Shift not found.' }
    revalidatePath('/admin/shifts')
    return { success: true }
}
