import 'server-only'
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

type ActiveSession = { id: string; session_token: string; booking_id?: string | null }

/** Extra context when the table is a hotel room's in-room QR. */
export interface RoomSessionOptions {
    /** The stay this session bills to. Binds sessions.booking_id. */
    bookingId?: string | null
    /**
     * When the stay ends. A dining session defaults to a 4-hour TTL, which would
     * strand a multi-night guest ordering breakfast on a session opened at
     * dinner. For a room we let the session live as long as the booking.
     */
    expiresAt?: string | null
}

/**
 * Returns the table's active (non-expired) dining session, creating one on the
 * fly if none exists. This powers self-service ordering: a guest scans the table
 * QR and can order immediately — no waiter needs to "open" the table first.
 * Access is gated upstream by the WiFi/IP restriction, so the caller must only
 * invoke this once the client IP has been allowed.
 *
 * Must be called with a service-role (admin) Supabase client.
 */
export async function getOrCreateActiveSession(
    admin: SupabaseClient,
    tableId: string,
    restaurantId: string,
    room?: RoomSessionOptions,
    seatNumber: number = 1,
): Promise<ActiveSession | null> {
    // 1. Reuse an existing active, non-expired session if there is one.
    const existing = await findActiveSession(admin, tableId, seatNumber)
    if (existing) {
        // If this is a hotel room stay and the active booking has changed,
        // we must NOT reuse this session! Close it so a new one is created.
        if (room?.bookingId && existing.booking_id && existing.booking_id !== room.bookingId) {
            await admin
                .from('sessions')
                .update({ status: 'closed', closed_at: new Date().toISOString() })
                .eq('id', existing.id)
            // Continue past this block to create a fresh session
        } else {
            // A session opened before check-in (or before this column existed) has no
            // stay attached. Bind it now so its orders land on the right folio.
            if (room?.bookingId && !existing.booking_id) {
                await admin
                    .from('sessions')
                    .update({ booking_id: room.bookingId, ...(room.expiresAt ? { expires_at: room.expiresAt } : {}) })
                    .eq('id', existing.id)
                    .is('booking_id', null)
                return { ...existing, booking_id: room.bookingId }
            }
            return existing
        }
    }

    // 2. Expire any stale active sessions that passed expires_at but were never
    //    cleaned up — otherwise the unique-active-per-table-per-seat index blocks
    //    the insert.
    await admin
        .from('sessions')
        .update({ status: 'expired', closed_at: new Date().toISOString() })
        .eq('table_id', tableId)
        .eq('seat_number', seatNumber)
        .eq('status', 'active')
        .lt('expires_at', new Date().toISOString())

    // 3. Create a fresh guest session. opened_by is null (no waiter involved).
    //    Token is generated here (URL-safe) rather than relying on the DB default.
    const sessionToken = randomBytes(32).toString('base64url')
    const { data, error } = await admin
        .from('sessions')
        .insert({
            table_id: tableId,
            restaurant_id: restaurantId,
            opened_by: null,
            session_token: sessionToken,
            seat_number: seatNumber,
            ...(room?.bookingId ? { booking_id: room.bookingId } : {}),
            ...(room?.expiresAt ? { expires_at: room.expiresAt } : {}),
        })
        .select('id, session_token, booking_id')
        .single()

    if (!error && data) return data

    // 4. Race: a concurrent scan created the session first (unique-active index
    //    violation). Return whatever is active now.
    if (error?.code === '23505') {
        return await findActiveSession(admin, tableId, seatNumber)
    }

    console.error('[getOrCreateActiveSession] insert failed:', error)
    return null
}

async function findActiveSession(
    admin: SupabaseClient,
    tableId: string,
    seatNumber: number = 1,
): Promise<ActiveSession | null> {
    const { data } = await admin
        .from('sessions')
        .select('id, session_token, booking_id')
        .eq('table_id', tableId)
        .eq('seat_number', seatNumber)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data ?? null
}
