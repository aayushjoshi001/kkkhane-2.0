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

// Update a room category. Only the fields present in the body are changed; every
// query is scoped to the caller's restaurant so one tenant can't edit another's.
export async function PATCH(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { id, name, description, base_price, capacity } = body
        if (!id) {
            return NextResponse.json({ error: 'Room category id is required' }, { status: 400 })
        }

        const updates: Record<string, unknown> = {}
        if (name !== undefined) {
            if (!String(name).trim()) return NextResponse.json({ error: 'Category name cannot be empty' }, { status: 400 })
            updates.name = String(name).trim()
        }
        if (description !== undefined) updates.description = description?.trim() || null
        if (base_price !== undefined) {
            if (isNaN(Number(base_price)) || Number(base_price) < 0) return NextResponse.json({ error: 'Enter a valid base price' }, { status: 400 })
            updates.base_price = Number(base_price)
        }
        if (capacity !== undefined) {
            if (isNaN(Number(capacity)) || Number(capacity) < 1) return NextResponse.json({ error: 'Enter a valid capacity' }, { status: 400 })
            updates.capacity = Number(capacity)
        }
        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('room_types')
            .update(updates)
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)
            .select()
            .single()

        if (error) throw error
        if (!data) return NextResponse.json({ error: 'Room category not found' }, { status: 404 })
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

// Soft-delete a room category. Blocked while any active room still uses it, so a
// room is never orphaned onto a category that has vanished from the list.
export async function DELETE(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const id = body?.id || new URL(req.url).searchParams.get('id')
        if (!id) {
            return NextResponse.json({ error: 'Room category id is required' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { count } = await supabase
            .from('rooms')
            .select('id', { count: 'exact', head: true })
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('type_id', id)
            .eq('is_active', true)

        if ((count ?? 0) > 0) {
            return NextResponse.json(
                { error: `This category is used by ${count} room${count === 1 ? '' : 's'}. Reassign or remove those rooms first.` },
                { status: 409 }
            )
        }

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
