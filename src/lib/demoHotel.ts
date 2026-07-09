// lib/demoHotel.ts
// Seeds the demo hotel with everything the check-in → in-room order → checkout
// flow needs: room types, rooms (some occupied), a dining table per room so the
// in-room QR reaches the kitchen (the room↔OMS bridge matches table.label to
// room_number), checked-in bookings with advances, a couple of incidental
// charges, and one live room-service order so the kitchen and folio aren't empty.
//
// Idempotent: if rooms already exist for this restaurant it does nothing, so
// repeated demo logins never duplicate the seed. Called from the login server
// action after the hotel restaurant is provisioned.

import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const qrToken = () => randomBytes(18).toString('base64url')

const ROOM_TYPES = [
    { name: 'Standard', base_price: 3500, capacity: 2, amenities: ['WiFi', 'TV', 'AC'], description: 'Cozy room for two with all the essentials.' },
    { name: 'Deluxe', base_price: 5500, capacity: 3, amenities: ['WiFi', 'TV', 'AC', 'Mini Bar', 'Balcony'], description: 'Spacious room with a private balcony.' },
    { name: 'Suite', base_price: 9000, capacity: 4, amenities: ['WiFi', 'TV', 'AC', 'Mini Bar', 'Balcony', 'Living Area', 'Bathtub'], description: 'Premium suite with a separate living area.' },
]

const ROOMS: { room_number: string; floor: string; type: string; status: 'available' | 'occupied' }[] = [
    { room_number: '101', floor: '1', type: 'Standard', status: 'available' },
    { room_number: '102', floor: '1', type: 'Standard', status: 'available' },
    { room_number: '201', floor: '2', type: 'Deluxe', status: 'occupied' },
    { room_number: '202', floor: '2', type: 'Deluxe', status: 'available' },
    { room_number: '203', floor: '2', type: 'Deluxe', status: 'occupied' },
    { room_number: '301', floor: '3', type: 'Suite', status: 'occupied' },
]

// Guests occupying rooms — drives the bookings + folios the front desk sees.
const GUESTS: Record<string, { name: string; phone: string; adults: number; advanceRatio: number; method: 'cash' | 'qr_digital' }> = {
    '201': { name: 'Anish Sharma', phone: '9801000201', adults: 2, advanceRatio: 0.5, method: 'cash' },
    '203': { name: 'Maya Gurung', phone: '9801000203', adults: 2, advanceRatio: 1.0, method: 'qr_digital' },
    '301': { name: 'David Chen', phone: '9801000301', adults: 3, advanceRatio: 0.3, method: 'cash' },
}

const NIGHTS = 2

export async function seedDemoHotel(admin: SupabaseClient, restaurantId: string): Promise<void> {
    // Idempotency guard — rooms are the marker that the hotel is already seeded.
    const { data: existingRooms } = await admin
        .from('rooms')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .limit(1)
    if (existingRooms && existingRooms.length > 0) return

    // 1. Room types
    const { data: insertedTypes, error: typeError } = await admin
        .from('room_types')
        .insert(ROOM_TYPES.map(t => ({ restaurant_id: restaurantId, is_active: true, ...t })))
        .select('id, name')
    if (typeError) throw new Error(`room_types seed failed: ${typeError.message}`)
    const typeIdByName = new Map<string, string>((insertedTypes || []).map(t => [t.name as string, t.id as string]))
    const priceByName = new Map<string, number>(ROOM_TYPES.map(t => [t.name, t.base_price]))

    // 2. Rooms
    const { data: insertedRooms, error: roomError } = await admin
        .from('rooms')
        .insert(ROOMS.map(r => ({
            restaurant_id: restaurantId,
            room_number: r.room_number,
            floor: r.floor,
            type_id: typeIdByName.get(r.type) ?? null,
            status: r.status,
            is_active: true,
        })))
        .select('id, room_number')
    if (roomError) throw new Error(`rooms seed failed: ${roomError.message}`)
    const roomIdByNumber = new Map<string, string>((insertedRooms || []).map(r => [r.room_number as string, r.id as string]))

    // 3. A dining table per room, labelled with the room number, so the in-room
    //    QR resolves and the folio can match its orders (the room↔OMS bridge).
    const { data: insertedTables, error: tableError } = await admin
        .from('tables')
        .insert(ROOMS.map(r => ({
            restaurant_id: restaurantId,
            label: r.room_number,
            qr_token: qrToken(),
            is_active: true,
        })))
        .select('id, label')
    if (tableError) throw new Error(`room tables seed failed: ${tableError.message}`)
    const tableIdByRoom = new Map<string, string>((insertedTables || []).map(t => [t.label as string, t.id as string]))

    // 4. Bookings for the occupied rooms, with advances collected at check-in.
    const now = new Date()
    const checkOut = new Date(now.getTime() + NIGHTS * 24 * 60 * 60 * 1000)
    const bookingIdByRoom = new Map<string, string>()
    for (const roomNo of Object.keys(GUESTS)) {
        const g = GUESTS[roomNo]
        const roomId = roomIdByNumber.get(roomNo)
        const roomType = ROOMS.find(r => r.room_number === roomNo)!.type
        const roomTotal = (priceByName.get(roomType) ?? 0) * NIGHTS
        const paid = Math.round(roomTotal * g.advanceRatio)
        const paymentStatus = paid >= roomTotal ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
        if (!roomId) continue
        const { data: booking, error: bookingError } = await admin
            .from('bookings')
            .insert({
                restaurant_id: restaurantId,
                room_id: roomId,
                guest_name: g.name,
                guest_phone: g.phone,
                check_in: now.toISOString(),
                check_out: checkOut.toISOString(),
                adults: g.adults,
                status: 'checked_in',
                total_amount: roomTotal,
                paid_amount: paid,
                payment_status: paymentStatus,
                advance_payment_method: paid > 0 ? g.method : 'none',
                notes: 'KYC: Demo ID on file',
            })
            .select('id')
            .single()
        if (bookingError) throw new Error(`bookings seed failed: ${bookingError.message}`)
        if (booking?.id) bookingIdByRoom.set(roomNo, booking.id)
    }

    // 5. A couple of incidental charges so folios show more than the room rate.
    const charges: { room: string; description: string; amount: number; charge_type: string }[] = [
        { room: '201', description: 'Mini bar — soft drinks', amount: 350, charge_type: 'minibar' },
        { room: '301', description: 'Laundry service', amount: 600, charge_type: 'laundry' },
    ]
    for (const c of charges) {
        const bookingId = bookingIdByRoom.get(c.room)
        if (!bookingId) continue
        await admin.from('room_charges').insert({
            restaurant_id: restaurantId,
            booking_id: bookingId,
            description: c.description,
            amount: c.amount,
            charge_type: c.charge_type,
        })
    }

    // 6. One live in-room order for Room 203 so the kitchen queue and the room
    //    folio have real data on first login. Best-effort — never block the seed.
    try {
        const tableId = tableIdByRoom.get('203')
        const { data: menuItems } = await admin
            .from('menu_items')
            .select('id')
            .eq('restaurant_id', restaurantId)
            .eq('is_available', true)
            .limit(2)
        if (tableId && menuItems && menuItems.length > 0) {
            const { data: session } = await admin
                .from('sessions')
                .insert({
                    table_id: tableId,
                    restaurant_id: restaurantId,
                    status: 'active',
                    session_token: `s-${qrToken()}`,
                    guest_count: 2,
                })
                .select('id')
                .single()
            if (session?.id) {
                await admin.rpc('place_order', {
                    p_session_id: session.id,
                    p_items: menuItems.map((m, i) => ({
                        menu_item_id: m.id,
                        quantity: i === 0 ? 2 : 1,
                        special_request: null,
                        modifiers: [],
                    })),
                    p_customer_note: 'Room service — Room 203',
                    p_client_request_id: `demo-hotel-seed-203-${restaurantId}`,
                })
            }
        }
    } catch (e) {
        console.error('[demoHotel] live in-room order seed failed (non-fatal):', e)
    }
}
