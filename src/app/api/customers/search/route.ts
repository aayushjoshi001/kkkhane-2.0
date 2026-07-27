import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
// getOptionalUser, not getCurrentUser: the latter signals an unauthenticated
// caller by throwing Next's redirect, which the catch below would swallow and
// report as a 500. An API route wants a plain 401.
import { getOptionalUser } from '@/lib/auth'

/** A returning guest, as offered to the front desk while registering a stay. */
export interface GuestSuggestion {
    phone: string
    name: string
    email: string | null
    /** Citizenship/passport number from their last stay, if recorded. */
    kyc: string | null
    /** How many times they have stayed before. */
    visits: number
    lastStayAt: string | null
    loyaltyPoints: number | null
}

/** Below this, a search is too broad to be useful and just leaks the guest list. */
const MIN_QUERY_LENGTH = 3

/**
 * Look up guests who have stayed here before, by phone prefix or name.
 *
 * Feeds the suggestion list on the booking form so a returning guest is
 * recognised as one and their details are filled in rather than retyped.
 *
 * This returns guest PII, so it is deliberately narrow: staff only, scoped to
 * the caller's own restaurant, and never to a restaurant id supplied by the
 * client. A short query is rejected rather than answered, since two characters
 * would match most of the book and turn this into a "download our guest list"
 * endpoint for any signed-in account.
 */
export async function GET(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Front-desk roles only. A kitchen or bar login has no reason to read
        // the guest book.
        const allowedRoles = ['manager', 'super_admin', 'cashier', 'waiter']
        if (!allowedRoles.includes(currentUser.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        const query = (new URL(req.url).searchParams.get('q') || '').trim()
        if (query.length < MIN_QUERY_LENGTH) {
            return NextResponse.json({ success: true, customers: [] })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase.rpc('search_guest_history', {
            // Always the session's own restaurant — never read from the request.
            p_restaurant_id: currentUser.restaurantId,
            p_query: query,
            p_limit: 8,
        })

        if (error) {
            console.error('search_guest_history error:', error)
            return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
        }

        const customers: GuestSuggestion[] = (data || []).map((row: {
            guest_phone: string
            guest_name: string
            guest_email: string | null
            kyc: string | null
            visits: number | string
            last_stay_at: string | null
            loyalty_points: number | null
        }) => ({
            phone: row.guest_phone,
            name: row.guest_name,
            email: row.guest_email,
            kyc: row.kyc,
            visits: Number(row.visits) || 0,
            lastStayAt: row.last_stay_at,
            loyaltyPoints: row.loyalty_points,
        }))

        return NextResponse.json({ success: true, customers })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
