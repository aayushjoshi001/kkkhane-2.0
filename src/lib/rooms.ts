// lib/rooms.ts
// The room↔order bridge, resolved by key.
//
// A hotel room's QR is the qr_token of the `tables` row linked to it via
// tables.room_id. Everything that needs to know "is this table a room, and who
// is staying in it right now" goes through here, so the answer can't drift
// between the customer QR page, the order path, and the cashier's folio.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RoomContext {
    roomId: string
    roomNumber: string
    /** The stay currently checked in to this room, or null if nobody is. */
    bookingId: string | null
    guestName: string | null
}

/** The stay currently checked in to a room, if any. */
export async function getActiveBookingForRoom(
    admin: SupabaseClient,
    roomId: string,
): Promise<{ id: string; guest_name: string } | null> {
    const { data } = await admin
        .from('bookings')
        .select('id, guest_name')
        .eq('room_id', roomId)
        .eq('status', 'checked_in')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data ?? null
}

/**
 * Resolve the room a table is the in-room QR for, plus its active stay.
 * Returns null for ordinary dining tables (room_id IS NULL) — callers treat that
 * as "not a room", leaving the normal table flow untouched.
 */
export async function getRoomContextForTable(
    admin: SupabaseClient,
    tableId: string,
): Promise<RoomContext | null> {
    const { data: table } = await admin
        .from('tables')
        .select('room_id, rooms:room_id(id, room_number)')
        .eq('id', tableId)
        .maybeSingle()

    if (!table?.room_id) return null

    const room = table.rooms as unknown as { room_number?: string } | null
    const booking = await getActiveBookingForRoom(admin, table.room_id as string)

    return {
        roomId: table.room_id as string,
        roomNumber: room?.room_number ?? '',
        bookingId: booking?.id ?? null,
        guestName: booking?.guest_name ?? null,
    }
}
