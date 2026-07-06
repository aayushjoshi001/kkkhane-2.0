'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { verifyClientIp } from '@/lib/ip-check'
import { getOrCreateActiveSession } from '@/lib/sessions'
import { getOptionalUser } from '@/lib/auth'

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

    // 3. Auto-open session if needed
    if (!sessionToken && !isIpRestricted && !waiterSessionEnabled) {
        const session = await getOrCreateActiveSession(supabase, tableId, restaurantId)
        if (session) {
            sessionToken = session.session_token
            sessionUUID = session.id
        }
    }

    return {
        sessionToken,
        sessionUUID,
        isIpRestricted,
        clientIp: ipCheckResult.clientIp
    }
}
