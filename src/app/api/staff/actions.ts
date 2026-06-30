'use server'

import { createAdminClient } from '@/lib/supabase/server'
import type { StaffShift } from '@/types/database'

export async function clockIn(
    userId: string,
    restaurantId: string
): Promise<{ shift?: StaffShift; error?: string }> {
    const supabase = await createAdminClient()

    // Check if already clocked in (maybeSingle avoids PGRST116 on 0 rows)
    const { data: active, error: preCheckError } = await supabase
        .from('staff_shifts')
        .select('id')
        .eq('user_id', userId)
        .is('clock_out', null)
        .limit(1)
        .maybeSingle()

    if (preCheckError) {
        console.error('Clock in pre-check error:', preCheckError)
        return { error: 'Failed to clock in. Please try again.' }
    }
    if (active) {
        return { error: 'Already clocked in. Please clock out first.' }
    }

    // Call the RPC
    const { data, error } = await supabase.rpc('staff_clock_in', {
        p_user_id: userId,
        p_restaurant_id: restaurantId,
    })

    if (error) {
        console.error('Clock in error:', error)
        if (error.message.includes('ALREADY_CLOCKED_IN')) {
            return { error: 'Already clocked in. Please clock out first.' }
        }
        return { error: 'Failed to clock in. Please try again.' }
    }

    // Fetch the created shift
    const { data: shift } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('id', data)
        .single()

    return { shift: shift as StaffShift }
}

export async function clockOut(
    userId: string
): Promise<{ shift?: StaffShift; error?: string }> {
    const supabase = await createAdminClient()

    // Call the RPC — returns NUMERIC (hours_worked), not a UUID
    const { error } = await supabase.rpc('staff_clock_out', {
        p_user_id: userId,
    })

    if (error) {
        console.error('Clock out error:', error)
        if (error.message.includes('NOT_CLOCKED_IN')) {
            return { error: 'No active shift found.' }
        }
        return { error: 'Failed to clock out. Please try again.' }
    }

    // Fetch the most recently closed shift for this user
    const { data: shift } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('user_id', userId)
        .not('clock_out', 'is', null)
        .order('clock_out', { ascending: false })
        .limit(1)
        .single()

    return { shift: shift as StaffShift }
}

/**
 * Per-shift performance stats, derived from the ownership columns added across the
 * operational-flow build:
 *  • mealsCooked   — dishes this chef started (order_items.claimed_by/claimed_at)
 *  • ordersHandled — orders this waiter claimed to serve (orders.claimed_by)
 *  • deliveries    — orders this person delivered (orders.delivery_staff_id)
 * all within the shift window.
 */
export async function getShiftStats(
    userId: string,
    clockIn: string,
    clockOut?: string | null
): Promise<{ mealsCooked: number; ordersHandled: number; deliveries: number }> {
    const supabase = await createAdminClient()
    const end = clockOut || new Date().toISOString()

    const [meals, orders, deliveries] = await Promise.all([
        supabase.from('order_items').select('id', { count: 'exact', head: true })
            .eq('claimed_by', userId).gte('claimed_at', clockIn).lte('claimed_at', end),
        supabase.from('orders').select('id', { count: 'exact', head: true })
            .eq('claimed_by', userId).gte('claimed_at', clockIn).lte('claimed_at', end),
        supabase.from('orders').select('id', { count: 'exact', head: true })
            .eq('delivery_staff_id', userId).eq('status', 'delivered')
            .gte('delivered_at', clockIn).lte('delivered_at', end),
    ])

    return {
        mealsCooked: meals.count || 0,
        ordersHandled: orders.count || 0,
        deliveries: deliveries.count || 0,
    }
}

export async function getActiveShift(
    userId: string
): Promise<StaffShift | null> {
    const supabase = await createAdminClient()

    const { data } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('user_id', userId)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .single()

    return data as StaffShift | null
}

export async function getShiftHistory(
    userId: string,
    limit = 20
): Promise<StaffShift[]> {
    const supabase = await createAdminClient()

    const { data } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('user_id', userId)
        .order('clock_in', { ascending: false })
        .limit(limit)

    return (data || []) as StaffShift[]
}

export async function getAllActiveShifts(
    restaurantId: string
): Promise<(StaffShift & { user_name?: string })[]> {
    const supabase = await createAdminClient()

    const { data } = await supabase
        .from('staff_shifts')
        .select('*, users(full_name)')
        .eq('restaurant_id', restaurantId)
        .is('clock_out', null)
        .order('clock_in', { ascending: true })

    return (data || []).map((shift: unknown) => {
        const s = shift as StaffShift & { users?: { full_name?: string } }
        return {
            ...s,
            user_name: s.users?.full_name || 'Unknown',
        }
    })
}
