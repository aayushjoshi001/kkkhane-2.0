'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { getNstDateString } from '@/lib/timezone'
import { revalidatePath } from 'next/cache'

export type AttendanceStatus = 'present' | 'absent'

// Today's attendance status for every staff member in the restaurant, keyed
// by user id. A staff member with no entry yet is unmarked for today.
export async function fetchTodayAttendanceAction() {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()
    const today = getNstDateString()

    const { data, error } = await supabase
        .from('staff_attendance')
        .select('user_id, status, reason')
        .eq('restaurant_id', currentUser.restaurantId)
        .eq('date', today)

    if (error) throw new Error(error.message)

    const attendance: Record<string, { status: AttendanceStatus; reason: string | null }> = {}
    for (const row of data || []) {
        attendance[row.user_id] = { status: row.status as AttendanceStatus, reason: row.reason }
    }
    return { date: today, attendance }
}

// Marks a staff member present ("In") or absent ("Out", with an optional
// reason) for today. Re-marking the same day overwrites the existing entry —
// attendance is a fresh decision each day.
export async function markAttendanceAction(userId: string, status: AttendanceStatus, reason?: string) {
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

    const today = getNstDateString()

    const { error } = await supabase
        .from('staff_attendance')
        .upsert({
            restaurant_id: currentUser.restaurantId,
            user_id: userId,
            date: today,
            status,
            reason: status === 'absent' ? (reason || null) : null,
            marked_by: currentUser.id,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,date' })

    if (error) return { error: error.message }

    revalidatePath('/admin/staff')
    return { success: true }
}
