import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// Data for the "Download all QRs" bulk PDF: every active room + table for the
// caller's restaurant, plus the branding shown on each card. Tenant-scoped by
// the caller's session.
export async function GET() {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = await createAdminClient()
        const [{ data: restaurant }, { data: rooms }, { data: tables }] = await Promise.all([
            supabase
                .from('restaurants')
                .select('name, slug, logo_url')
                .eq('id', currentUser.restaurantId)
                .single(),
            supabase
                .from('rooms')
                .select('id, room_number')
                .eq('restaurant_id', currentUser.restaurantId)
                .eq('is_active', true)
                .order('room_number', { ascending: true }),
            supabase
                .from('tables')
                .select('label, qr_token')
                .eq('restaurant_id', currentUser.restaurantId)
                .eq('is_active', true)
                .order('label', { ascending: true }),
        ])

        return NextResponse.json({
            restaurant: restaurant ?? null,
            rooms: rooms ?? [],
            tables: tables ?? [],
        })
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 })
    }
}
