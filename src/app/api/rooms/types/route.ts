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
        const { name, description, base_price, capacity } = body

        if (!name || isNaN(Number(base_price)) || isNaN(Number(capacity))) {
            return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('room_types')
            .insert({
                restaurant_id: currentUser.restaurantId,
                name: name.trim(),
                description: description?.trim() || null,
                base_price: Number(base_price),
                capacity: Number(capacity)
            })
            .select()
            .single()

        if (error) throw error
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
