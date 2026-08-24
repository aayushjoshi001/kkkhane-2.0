import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth'

export async function GET(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const roomId = searchParams.get('roomId')
        if (!roomId) {
            return NextResponse.json({ error: 'Missing roomId' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        // Both the stay in residence and any reservation still to arrive point
        // at this room, and "most recently created" does not tell them apart —
        // a reservation booked after the current guest checked in was returned
        // ahead of them, and the room panel then drew that other guest's name
        // over the occupant's charges. The guest actually in the room is the
        // answer whenever there is one; only an empty room falls through to the
        // reservation holding it, earliest arrival first.
        const { data: candidates, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('room_id', roomId)
            .eq('restaurant_id', currentUser.restaurantId)
            .in('status', ['checked_in', 'pending'])
            .order('created_at', { ascending: false })

        if (error) throw error

        const rows = candidates || []
        const data =
            rows.find(b => b.status === 'checked_in') ??
            [...rows]
                .sort((a, b) => String(a.check_in ?? '').localeCompare(String(b.check_in ?? '')))[0] ??
            null

        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
