// Which bookings share a folio.
//
// A multi-room reservation is several `bookings` rows tied together by
// `bookings.group_id` (see supabase/migrations/20260727120000_booking_groups.sql).
// The guest pays once, so anything that adds up a stay's money — room-service
// orders, manual charges, the advance already taken — has to add it up across
// every room on the reservation, not just the room the cashier happened to
// click. Routes that only ever looked at one booking id call this first.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The shape /api/bookings/group returns for a multi-room reservation — the
 * rooms on the bill and the combined figures the cashier settles against.
 * Type-only, so the billing screens can share it without pulling the server
 * helper below into the client bundle.
 */
export type GroupBill = {
    groupId: string
    guestName: string
    /** Nights on the longest room of the reservation. */
    nights: number
    rooms: Array<{
        bookingId: string
        roomId: string
        roomNumber: string
        nights: number
        stayCost: number
        paidAmount: number
    }>
    /** Every room's stay cost added up — what the guest owes for rooms. */
    stayCost: number
    /** Combined advance already taken across the reservation's rooms. */
    advancePaid: number
}

/**
 * Every booking billing onto the same folio as `bookingId`, oldest first.
 *
 * An ordinary single-room stay returns just `[bookingId]`, so callers take the
 * identical path they always did. Cancelled rooms are left out — they were
 * dropped from the reservation and must not appear on its bill — but the
 * booking asked for is always included, even if it is itself cancelled, so a
 * caller never gets back a list that doesn't contain what it asked about.
 */
export async function resolveFolioBookingIds(
    supabase: SupabaseClient,
    bookingId: string,
): Promise<string[]> {
    const { data: booking } = await supabase
        .from('bookings')
        .select('group_id')
        .eq('id', bookingId)
        .maybeSingle()

    if (!booking?.group_id) return [bookingId]

    const { data: members } = await supabase
        .from('bookings')
        .select('id')
        .eq('group_id', booking.group_id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true })

    const ids = (members || []).map(m => m.id as string)
    if (ids.length === 0) return [bookingId]
    return ids.includes(bookingId) ? ids : [bookingId, ...ids]
}
