import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { room_number, floor, type_id } = body

        if (!room_number || !type_id) {
            return NextResponse.json({ error: 'Room number and Room Type are required' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('rooms')
            .insert({
                restaurant_id: currentUser.restaurantId,
                room_number: room_number.trim(),
                floor: floor?.trim() || '1',
                type_id,
                status: 'available'
            })
            .select('*, room_types:type_id(*)')
            .single()

        if (error) throw error
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
