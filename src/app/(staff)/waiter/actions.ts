'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'

export async function openSession(tableId: string, restaurantId: string, guestCount?: number) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        console.error('[openSession] No authenticated user found')
        return { error: 'Unauthorized' }
    }

    // Expire any stale sessions for this table that passed their expires_at but
    // were never cleaned up — otherwise the unique-active-per-table index blocks the insert.
    await adminSupabase
        .from('sessions')
        .update({ status: 'expired', closed_at: new Date().toISOString() })
        .eq('table_id', tableId)
        .eq('status', 'active')
        .lt('expires_at', new Date().toISOString())

    // Generate a URL-safe session token (avoids DB-level base64url encoding issues)
    const { randomBytes } = await import('crypto')
    const sessionToken = randomBytes(32).toString('base64url')

    const { data, error } = await adminSupabase
        .from('sessions')
        .insert({
            table_id: tableId,
            restaurant_id: restaurantId,
            opened_by: user.id,
            guest_count: guestCount || null,
            session_token: sessionToken,
        })
        .select('*')
        .single()

    if (error) {
        console.error('[openSession] Insert failed:', error)
        if (error.code === '23505') return { error: 'Table already has an active session' }
        return { error: error.message }
    }

    void logAudit({
        restaurantId,
        userId: user.id,
        action: 'session_opened',
        entityType: 'session',
        entityId: data?.id,
        newValue: { table_id: tableId, guest_count: guestCount ?? null },
    })

    revalidatePath('/waiter')
    return { success: true, session: data }
}

export async function closeSession(sessionId: string) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data: { user } } = await supabase.auth.getUser()

    const { data: session, error } = await adminSupabase
        .from('sessions')
        .update({
            status: 'closed',
            closed_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('status', 'active')
        .select('restaurant_id')
        .single()

    if (error) return { error: error.message }

    // Closing the session leaves the table needing clean-up.
    await markTableDirtyForSession(adminSupabase, sessionId)

    void logAudit({
        restaurantId: session.restaurant_id,
        userId: user?.id ?? null,
        action: 'session_closed',
        entityType: 'session',
        entityId: sessionId,
        newValue: { reason: 'manual' },
    })

    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Opens a session for a table AND completes the open_session service request in one action.
 */
export async function openSessionFromRequest(
    requestId: string,
    tableId: string,
    restaurantId: string
): Promise<{ error?: string; success?: boolean; session?: any }> {
    const result = await openSession(tableId, restaurantId)
    if (result.error) return { error: result.error }

    const adminSupabase = await createAdminClient()
    await adminSupabase
        .from('service_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', requestId)

    return { success: true, session: result.session }
}

/**
 * Waiter marks a table as dirty (needs cleaning) or reserved.
 * Clears back to 'available' once actioned.
 */
export async function setTableStatus(
    tableId: string,
    status: 'available' | 'dirty' | 'reserved'
): Promise<{ error?: string; success?: boolean }> {
    const supabase = await createAdminClient()
    // Any manual status change resets the cleaning claim — a freshly-dirty table
    // is unclaimed, and clearing/reserving drops a stale owner.
    const { error } = await supabase
        .from('tables')
        .update({ table_status: status, cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)

    if (error) return { error: error.message }
    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Cleaning ownership — the same single-owner model as order/cooking claims.
 *  • claimTableCleaning ("I am going"): take a dirty, unclaimed table.
 *  • markTableClean: clear it back to available — only the claiming waiter (or an
 *    unclaimed table) may do this.
 *  • releaseTableCleaning: drop your own claim so someone else can take it.
 */
export async function claimTableCleaning(
    tableId: string
): Promise<{ error?: string; success?: boolean; conflict?: boolean }> {
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const { data, error } = await admin
        .from('tables')
        .update({ cleaning_claimed_by: user.id, cleaning_claimed_at: new Date().toISOString() })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        .is('cleaning_claimed_by', null)
        .select('id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Another waiter already took this table' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function releaseTableCleaning(
    tableId: string
): Promise<{ error?: string; success?: boolean }> {
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    await admin
        .from('tables')
        .update({ cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('cleaning_claimed_by', user.id)

    revalidatePath('/waiter')
    return { success: true }
}

export async function markTableClean(
    tableId: string
): Promise<{ error?: string; success?: boolean; conflict?: boolean }> {
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const { data, error } = await admin
        .from('tables')
        .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        // Owner-only, or anyone if it was never claimed.
        .or(`cleaning_claimed_by.eq.${user.id},cleaning_claimed_by.is.null`)
        .select('id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Only the waiter who took this table can mark it clean' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function findBookingByPhone(phone: string, restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const cleanPhone = phone.trim()
    const { data: booking, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'checked_in')
        .eq('guest_phone', cleanPhone)
        .maybeSingle()

    if (error) {
        console.error('[findBookingByPhone] Error:', error)
        return { error: 'Failed to search booking' }
    }
    return { success: true, booking }
}

export async function getActiveBookings(restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const { data: bookings, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'checked_in')
        .order('check_in', { ascending: false })

    if (error) {
        console.error('[getActiveBookings] Error:', error)
        return { error: 'Failed to fetch active bookings' }
    }
    return { success: true, bookings }
}

export async function linkSessionToBooking(sessionId: string, bookingId: string) {
    const adminSupabase = await createAdminClient()
    const { error } = await adminSupabase
        .from('sessions')
        .update({ booking_id: bookingId })
        .eq('id', sessionId)

    if (error) {
        console.error('[linkSessionToBooking] Error:', error)
        return { error: error.message }
    }
    revalidatePath('/waiter')
    return { success: true }
}

