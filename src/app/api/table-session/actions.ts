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
            .select('id, session_token')
            .eq('table_id', tableId)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (existingSession) {
            sessionToken = existingSession.session_token
            sessionUUID = existingSession.id
        }
    }

    // 3. Room context: an in-room QR binds its session to the guest's stay, and
    //    lives as long as the booking rather than the 4-hour dining default.
    //    Null for ordinary dining tables, which behave exactly as before.
    const roomContext = await getRoomContextForTable(supabase, tableId)

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

    return {
        sessionToken,
        sessionUUID,
        isIpRestricted,
        clientIp: ipCheckResult.clientIp,
        roomNotCheckedIn: false,
    }
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
