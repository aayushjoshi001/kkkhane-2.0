import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// Matches the database's own rooms_status_check constraint - validated here
// too so a bad value gets a clean error instead of a raw Postgres exception,
// and so this allowlist is explicit rather than only enforced way down at
// the schema level.
const VALID_ROOM_STATUSES = ['available', 'occupied', 'dirty', 'maintenance', 'blocked']

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { roomId, status, force } = await req.json()
        if (!roomId || !status) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }
        if (!VALID_ROOM_STATUSES.includes(status)) {
            return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_ROOM_STATUSES.join(', ')}` }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Force-override: manager/super_admin only, for correcting a room stuck
        // in a wrong status (e.g. "occupied" with no real active stay left).
        // Skips the active-booking guard below entirely.
        const isForced = force === true
        if (isForced && !['manager', 'super_admin'].includes(currentUser.role)) {
            return NextResponse.json({ error: 'Only managers can force-override a room status.' }, { status: 403 })
        }

        // Setting a room back to "available" while a guest is still actively
        // checked in (or has a pending check-in) is exactly the inconsistent
        // state that let a new booking silently evict a real guest (§02).
        // Block it here at the source, unless a manager is deliberately
        // forcing a correction.
        if (status === 'available' && !isForced) {
            const { data: activeBooking } = await supabase
                .from('bookings')
                .select('id, guest_name')
                .eq('room_id', roomId)
                .eq('restaurant_id', currentUser.restaurantId)
                .in('status', ['checked_in', 'pending'])
                .limit(1)
                .maybeSingle()

            if (activeBooking) {
                return NextResponse.json({
                    error: `Cannot mark this room available - ${activeBooking.guest_name} is still checked in. Check them out first, or use the manager override if this is a stuck/incorrect status.`
                }, { status: 409 })
            }
        }

        const { error } = await supabase
            .from('rooms')
            .update({ status })
            .eq('id', roomId)
            .eq('restaurant_id', currentUser.restaurantId)

        if (error) throw error
        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
