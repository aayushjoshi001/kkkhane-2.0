import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getActiveBookingForRoom } from '@/lib/rooms'

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}))
        const { restaurantSlug, roomNumber, phoneNumber } = body

        if (!restaurantSlug || !roomNumber || !phoneNumber) {
            return NextResponse.json({ error: 'Missing required verification fields' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Resolve restaurant ID and linked_hotel_id from slug
        const { data: restaurant, error: restError } = await supabase
            .from('restaurants')
            .select('id, name, linked_hotel_id')
            .eq('slug', restaurantSlug)
            .single()

        if (restError || !restaurant) {
            return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
        }

        // 2. Find the room. The QR now encodes the room's immutable id (so
        // renaming a room never invalidates a printed QR), but older QRs still
        // carry the room number — resolve by whichever the param looks like.
        // Look under the restaurant tenant first, then fall back to the linked
        // hotel tenant if configured.
        const roomKey = String(roomNumber).trim()
        const roomCol = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomKey)
            ? 'id'
            : 'room_number'

        let targetRestaurantIdForRoom = restaurant.id
        let { data: room } = await supabase
            .from('rooms')
            .select('id, room_number')
            .eq('restaurant_id', targetRestaurantIdForRoom)
            .eq(roomCol, roomKey)
            .maybeSingle()

        if (!room && restaurant.linked_hotel_id) {
            targetRestaurantIdForRoom = restaurant.linked_hotel_id
            const { data: linkedRoom } = await supabase
                .from('rooms')
                .select('id, room_number')
                .eq('restaurant_id', targetRestaurantIdForRoom)
                .eq(roomCol, roomKey)
                .maybeSingle()
            if (linkedRoom) {
                room = linkedRoom
            }
        }

        if (!room) {
            // roomKey may be an id (from a new QR) — don't echo it; only the
            // number is meaningful to a guest.
            const shown = roomCol === 'room_number' ? `Room ${roomKey}` : 'This room'
            return NextResponse.json({ error: `${shown} not found in this hotel` }, { status: 404 })
        }

        // 3. Find the active checked-in booking for this room (shared with the
        // customer QR page and the cashier's folio, so the answer can't drift)
        const booking = await getActiveBookingForRoom(supabase, room.id)

        if (!booking) {
            return NextResponse.json({ error: `No active stay/check-in found for Room ${room.room_number}` }, { status: 404 })
        }

        // 4. Validate phone number (robust normalization)
        const cleanVal = (val: string) => val.replace(/\D/g, '')
        const normalizedInput = cleanVal(phoneNumber)
        const normalizedDb = cleanVal(booking.guest_phone || '')

        if (!normalizedInput || normalizedInput !== normalizedDb) {
            return NextResponse.json({ error: 'The phone number entered does not match the booking details for this room' }, { status: 403 })
        }

        // 5. Get the table's qr_token associated with this room
        let { data: table, error: tableError } = await supabase
            .from('tables')
            .select('qr_token, label')
            .eq('room_id', room.id)
            .maybeSingle()

        if (tableError) {
            return NextResponse.json({ error: 'Database error reading room QR config' }, { status: 500 })
        }

        // If no table is mapped to this room, auto-configure it now
        if (!table) {
            const { randomBytes } = await import('crypto')
            const newQrToken = randomBytes(18).toString('base64url')

            const { data: newTable, error: insertError } = await supabase
                .from('tables')
                .insert({
                    restaurant_id: restaurant.id,
                    room_id: room.id,
                    label: `Room ${room.room_number}`,
                    qr_token: newQrToken,
                    is_active: true
                })
                .select('qr_token, label')
                .maybeSingle()

            if (insertError || !newTable) {
                return NextResponse.json({ error: 'Failed to auto-configure room ordering mapping' }, { status: 500 })
            }

            table = newTable
        }

        return NextResponse.json({
            success: true,
            guestName: booking.guest_name,
            qrToken: table.qr_token,
            tableLabel: table.label,
            // The human room number, so the guest UI can show "Room 101" even
            // when the QR (and roomParam) carry the room's id.
            roomNumber: room.room_number
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error during verification' }, { status: 500 })
    }
}
