import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        
        const { roomId, status } = await req.json()
        if (!roomId || !status) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }
        
        const supabase = await createAdminClient()
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
