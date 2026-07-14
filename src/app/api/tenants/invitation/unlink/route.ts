import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = await createAdminClient()
        const myId = currentUser.restaurantId

        // 1. Fetch current linkage
        const { data: myRest, error: fetchErr } = await supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', myId)
            .single()

        if (fetchErr || !myRest) {
            return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
        }

        const partnerId = myRest.linked_restaurant_id || myRest.linked_hotel_id
        if (!partnerId) {
            return NextResponse.json({ error: 'No linked partner found to unlink' }, { status: 400 })
        }

        // 2. Clear linkage on both sides atomically
        // Clear partner's links
        const { error: partnerErr } = await supabase
            .from('restaurants')
            .update({
                linked_hotel_id: null,
                linked_restaurant_id: null
            })
            .eq('id', partnerId)

        if (partnerErr) throw partnerErr

        // Clear my links
        const { error: myErr } = await supabase
            .from('restaurants')
            .update({
                linked_hotel_id: null,
                linked_restaurant_id: null
            })
            .eq('id', myId)

        if (myErr) throw myErr

        return NextResponse.json({ success: true, message: 'Partner unlinked successfully' })
    } catch (e: any) {
        console.error('Unlink error:', e)
        return NextResponse.json({ error: e.message || 'Server error during unlinking' }, { status: 500 })
    }
}
