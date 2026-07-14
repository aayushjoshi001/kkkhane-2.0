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
        const { room_number, floor, type_id, beds } = body

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
                beds: Number(beds) || 1,
                type_id,
                status: 'available'
            })
            .select('*, room_types:type_id(*)')
            .single()

        if (error) {
            // Unique violation on (restaurant_id, room_number) — a duplicate
            // room number is a user mistake, not a server fault. Surface it as
            // a 409 with a message the toast can show verbatim.
            if (error.code === '23505') {
                return NextResponse.json(
                    { error: `Room ${room_number.trim()} already exists` },
                    { status: 409 }
                )
            }
            throw error
        }
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

// Update a room's static details (number, floor, category, notes). Status is
// owned by /api/rooms/status and intentionally not editable here.
export async function PATCH(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { id, room_number, floor, type_id, notes, beds } = body
        if (!id) {
            return NextResponse.json({ error: 'Room id is required' }, { status: 400 })
        }

        const updates: Record<string, unknown> = {}
        if (room_number !== undefined) {
            if (!String(room_number).trim()) return NextResponse.json({ error: 'Room number cannot be empty' }, { status: 400 })
            updates.room_number = String(room_number).trim()
        }
        if (floor !== undefined) updates.floor = floor?.trim() || null
        if (beds !== undefined) updates.beds = Number(beds) || 1
        if (type_id !== undefined) updates.type_id = type_id || null
        if (notes !== undefined) updates.notes = notes?.trim() || null
        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('rooms')
            .update(updates)
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)
            .select('*, room_types:type_id(*)')
            .single()

        if (error) {
            // Duplicate room number within the restaurant — a user mistake, not a fault.
            if (error.code === '23505') {
                return NextResponse.json({ error: `Room ${String(room_number).trim()} already exists` }, { status: 409 })
            }
            throw error
        }
        if (!data) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

// Soft-delete a room (is_active=false). Rooms carry booking history behind a
// RESTRICT foreign key, so a hard delete would fail for any room that has ever
// been booked — soft delete keeps the history intact. An occupied room must be
// checked out first. Any table linked to the room for in-room ordering is
// unlinked so it doesn't dangle.
export async function DELETE(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const id = body?.id || new URL(req.url).searchParams.get('id')
        if (!id) {
            return NextResponse.json({ error: 'Room id is required' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: room } = await supabase
            .from('rooms')
            .select('status')
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        if (room.status === 'occupied') {
            return NextResponse.json({ error: 'Room is occupied. Check out the guest before deleting it.' }, { status: 409 })
        }

        // Unlink any in-room ordering table pointing at this room.
        await supabase.from('tables').update({ room_id: null }).eq('room_id', id).eq('restaurant_id', currentUser.restaurantId)

        const { error } = await supabase
            .from('rooms')
            .update({ is_active: false })
            .eq('id', id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (error) throw error
        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
