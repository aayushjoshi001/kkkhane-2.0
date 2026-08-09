import { createAdminClient } from '@/lib/supabase/server'

/**
 * Ensures that a staff member has an open active shift when accessing the system.
 * If forceNewShift is true (e.g. on new login), it closes any old open shift and starts a new shift.
 */
export async function ensureAutoClockIn(userId: string, restaurantId: string, options?: { forceNewShift?: boolean }) {
    if (!userId || !restaurantId) return

    try {
        const supabase = await createAdminClient()

        // Check if user already has an active open shift
        const { data: active } = await supabase
            .from('staff_shifts')
            .select('id, clock_in, break_minutes')
            .eq('user_id', userId)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (options?.forceNewShift && active) {
            // Auto clock out old open shift to create a clean new shift for this login session
            const now = new Date().toISOString()
            const totalMinutes = (new Date(now).getTime() - new Date(active.clock_in).getTime()) / 60000
            const hoursWorked = Math.max(0, Math.round(((totalMinutes - (active.break_minutes || 0)) / 60) * 100) / 100)

            await supabase
                .from('staff_shifts')
                .update({ clock_out: now, hours_worked: hoursWorked })
                .eq('id', active.id)

            // Clock in new shift
            await supabase.rpc('staff_clock_in', {
                p_user_id: userId,
                p_restaurant_id: restaurantId,
            })
            return
        }

        if (!active) {
            // Auto clock-in user if they don't have an active open shift
            await supabase.rpc('staff_clock_in', {
                p_user_id: userId,
                p_restaurant_id: restaurantId,
            })
        }
    } catch (err) {
        console.error('Auto clock-in error:', err)
    }
}

/**
 * Automatically clocks out any active open shift for the user when they log out.
 */
export async function ensureAutoClockOut(userId: string) {
    if (!userId) return

    try {
        const supabase = await createAdminClient()

        // Check if user has an active open shift
        const { data: active } = await supabase
            .from('staff_shifts')
            .select('id, clock_in, break_minutes')
            .eq('user_id', userId)
            .is('clock_out', null)
            .limit(1)
            .maybeSingle()

        if (active) {
            const now = new Date().toISOString()
            const totalMinutes = (new Date(now).getTime() - new Date(active.clock_in).getTime()) / 60000
            const hoursWorked = Math.max(0, Math.round(((totalMinutes - (active.break_minutes || 0)) / 60) * 100) / 100)

            await supabase
                .from('staff_shifts')
                .update({
                    clock_out: now,
                    hours_worked: hoursWorked
                })
                .eq('id', active.id)
        }
    } catch (err) {
        console.error('Auto clock-out error:', err)
    }
}
