import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}))
        const { restaurantSlug, roomNumber, phoneNumber } = body

        if (!restaurantSlug || !roomNumber || !phoneNumber) {
            return NextResponse.json({ error: 'Missing required verification fields' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Resolve restaurant ID from slug
        const { data: restaurant, error: restError } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('slug', restaurantSlug)
            .single()

        if (restError || !restaurant) {
            return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
        }

        // 2. Find the room by number
        const { data: room, error: roomError } = await supabase
            .from('rooms')
            .select('id, room_number')
            .eq('restaurant_id', restaurant.id)
            .eq('room_number', roomNumber.trim())
            .single()

        if (roomError || !room) {
            return NextResponse.json({ error: `Room ${roomNumber} not found in this hotel` }, { status: 404 })
        }

        // 3. Find the active checked-in booking for this room
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('id, guest_name, guest_phone, status')
            .eq('room_id', room.id)
            .eq('status', 'checked_in')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (bookingError || !booking) {
            return NextResponse.json({ error: `No active stay/check-in found for Room ${roomNumber}` }, { status: 404 })
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
            tableLabel: table.label
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error during verification' }, { status: 500 })
    }
}
