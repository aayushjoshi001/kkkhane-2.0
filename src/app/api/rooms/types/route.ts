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

export async function PATCH(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { id, name, description, base_price, capacity } = body

        if (!id || !name || isNaN(Number(base_price)) || isNaN(Number(capacity))) {
            return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('room_types')
            .update({
                name: name.trim(),
                description: description?.trim() || null,
                base_price: Number(base_price),
                capacity: Number(capacity)
            })
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)
            .select()
            .single()

        if (error) throw error
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

export async function DELETE(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { id } = body
        if (!id) {
            return NextResponse.json({ error: 'Category id is required' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Refuse to delete a category still assigned to any active room — the
        // room's category picker would otherwise point at a category that no
        // longer shows up anywhere in the UI.
        const { count, error: countError } = await supabase
            .from('rooms')
            .select('id', { count: 'exact', head: true })
            .eq('type_id', id)
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('is_active', true)

        if (countError) throw countError
        if (count && count > 0) {
            return NextResponse.json(
                { error: `${count} room${count > 1 ? 's' : ''} still use this category. Reassign or delete ${count > 1 ? 'them' : 'it'} first.` },
                { status: 409 }
            )
        }

        // Soft-delete: room_types.id is referenced by rooms.type_id (ON DELETE SET
        // NULL) and by historical bookings via the room, so a hard delete would
        // either silently strip categories off rooms or fight the FK. Deactivating
        // just hides it from the category list and pickers.
        const { error } = await supabase
            .from('room_types')
            .update({ is_active: false })
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (error) throw error
        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
