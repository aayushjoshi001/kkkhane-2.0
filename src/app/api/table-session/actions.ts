'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { getOrCreateActiveSession } from '@/lib/sessions'
import { getOptionalUser } from '@/lib/auth'
import { getRoomContextForTable } from '@/lib/rooms'

export async function initTableSession(
    tableId: string,
    restaurantId: string,
    isWaiterMode: boolean,
    waiterSessionEnabled: boolean,
    providedSessionToken?: string | null
) {
    const supabase = await createAdminClient()
    let sessionToken = providedSessionToken
    let sessionUUID: string | undefined

    // 1. IP Check
    const ipCheckResult = await verifyClientIp(restaurantId, 'customer')
    const optionalUser = isWaiterMode ? await getOptionalUser() : null
    const isIpRestricted = !ipCheckResult.allowed && !optionalUser

    // Room context: an in-room QR binds its session to the guest's stay, and
    // lives as long as the booking rather than the 4-hour dining default.
    // Null for ordinary dining tables, which behave exactly as before.
    const roomContext = await getRoomContextForTable(supabase, tableId)

    // 2. Validate existing session if any
    if (sessionToken) {
        const { data: validSession } = await supabase
            .from('sessions')
            .select('id, session_token')
            .eq('session_token', sessionToken)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .maybeSingle()

        if (!validSession) {
            sessionToken = null
        } else {
            sessionUUID = validSession.id
        }
    }

    if (!sessionToken) {
        const { data: existingSession } = await supabase
            .from('sessions')
            .select('id, session_token, booking_id')
            .eq('table_id', tableId)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (existingSession) {
            // Verify that this session does not belong to a different checked-out booking stay
            if (roomContext?.bookingId && existingSession.booking_id && existingSession.booking_id !== roomContext.bookingId) {
                // Booking changed! Do not reuse the stale session
                sessionToken = null
                sessionUUID = undefined
            } else {
                sessionToken = existingSession.session_token
                sessionUUID = existingSession.id
            }
        }
    }

    // A room with nobody checked in never opens a session — its orders could
    // never be billed to a folio. The QR page surfaces this to the guest.
    if (roomContext && !roomContext.bookingId) {
        return {
            sessionToken: null,
            sessionUUID: undefined,
            isIpRestricted,
            clientIp: ipCheckResult.clientIp,
            roomNotCheckedIn: true,
        }
    }

    // 4. Auto-open session if needed
    if (!sessionToken && !isIpRestricted && !waiterSessionEnabled) {
        const session = await getOrCreateActiveSession(
            supabase,
            tableId,
            restaurantId,
            roomContext?.bookingId
                ? { bookingId: roomContext.bookingId, expiresAt: await getStayExpiry(supabase, roomContext.bookingId) }
                : undefined,
        )
        if (session) {
            sessionToken = session.session_token
            sessionUUID = session.id
        }
    }

    if (sessionUUID && roomContext?.bookingId) {
        await supabase
            .from('sessions')
            .update({ booking_id: roomContext.bookingId })
            .eq('id', sessionUUID)
            .is('booking_id', null)
    }

    return {
        sessionToken,
        sessionUUID,
        isIpRestricted,
        clientIp: ipCheckResult.clientIp,
        roomNotCheckedIn: false,
    }
}

/**
 * Links the current dining-table session to an in-house guest's active stay,
 * purely by phone number — no waiter/cashier action needed. Used when a hotel
 * guest scans an ordinary restaurant table (not their room QR) and identifies
 * as staying at the hotel. Once linked, every order this session places is
 * reachable via sessions.booking_id, the same mechanism a waiter's manual
 * "link to booking" already uses — so it shows up in the room bill, the
 * stay-billing view, and the cashier's folio without any extra plumbing.
 */
export async function linkInHouseGuest(sessionToken: string, phoneNumber: string) {
    const supabase = await createAdminClient()

    const { data: session } = await supabase
        .from('sessions')
        .select('id, restaurant_id, booking_id')
        .eq('session_token', sessionToken)
        .eq('status', 'active')
        .maybeSingle()

    if (!session) {
        return { error: 'Your table session has expired. Please rescan the QR code.' }
    }
    if (session.booking_id) {
        return { error: 'This table is already linked to a room.' }
    }

    const cleanVal = (val: string) => val.replace(/\D/g, '')
    const normalizedInput = cleanVal(phoneNumber)
    if (!normalizedInput) {
        return { error: 'Please enter a valid phone number.' }
    }

    // Resolve linked hotel if any (since this might be a dining session at a partner restaurant)
    const { data: restLink } = await supabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', session.restaurant_id)
        .maybeSingle()

    const targetRestaurantId = restLink?.linked_hotel_id || session.restaurant_id

    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, guest_name, guest_phone')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in')
        .order('created_at', { ascending: false })

    const booking = (bookings || []).find(b => cleanVal(b.guest_phone || '') === normalizedInput)

    if (!booking) {
        return { error: 'No active stay found with that phone number.' }
    }

    const expiresAt = await getStayExpiry(supabase, booking.id)

    const { error: updateError } = await supabase
        .from('sessions')
        .update({ booking_id: booking.id, ...(expiresAt ? { expires_at: expiresAt } : {}) })
        .eq('id', session.id)
        .is('booking_id', null)

    if (updateError) {
        return { error: 'Failed to link this table to your room. Please try again.' }
    }

    return { success: true, guestName: booking.guest_name }
}

/** A room session should live until the guest checks out, not 4 hours. */
async function getStayExpiry(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    bookingId: string,
): Promise<string | null> {
    const { data } = await supabase
        .from('bookings')
        .select('check_out')
        .eq('id', bookingId)
        .maybeSingle()
    if (!data?.check_out) return null
    // Never shrink below the default dining TTL — a same-day checkout shouldn't
    // leave the guest with an already-expired session.
    const checkOut = new Date(data.check_out)
    const fourHours = new Date(Date.now() + 4 * 60 * 60 * 1000)
    return (checkOut > fourHours ? checkOut : fourHours).toISOString()
}
