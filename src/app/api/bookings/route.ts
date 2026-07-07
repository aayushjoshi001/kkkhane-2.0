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
        const {
            room_id, guest_name, guest_phone, kyc,
            check_in, check_out, guest_count,
            advance_amount, advance_payment_method
        } = body

        if (!room_id || !guest_name || !guest_phone || !check_in || !check_out || !guest_count) {
            return NextResponse.json({ error: 'Missing required booking fields' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Validate room and capacity
        const { data: room, error: roomError } = await supabase
            .from('rooms')
            .select('*, room_types:type_id(*)')
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()

        if (roomError || !room) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }

        const maxCapacity = room.room_types?.capacity || 2
        if (Number(guest_count) > maxCapacity) {
            return NextResponse.json({ error: `Guest count (${guest_count}) exceeds room capacity (${maxCapacity})` }, { status: 400 })
        }

        // 2. Resolve advance amount
        const paidAmount = Math.max(0, Number(advance_amount) || 0)
        const advMethod = paidAmount > 0 ? (advance_payment_method || 'cash') : 'none'

        // 3. Insert booking
        const notes = kyc ? `KYC: ${kyc.trim()}` : null
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert({
                restaurant_id: currentUser.restaurantId,
                room_id,
                guest_name: guest_name.trim(),
                guest_phone: guest_phone.trim(),
                check_in: new Date(check_in).toISOString(),
                check_out: new Date(check_out).toISOString(),
                adults: Number(guest_count),
                status: 'checked_in',
                notes,
                paid_amount: paidAmount,
                advance_payment_method: advMethod,
            })
            .select()
            .single()

        if (bookingError) throw bookingError

        // 4. Update room status to occupied
        const { error: updateError } = await supabase
            .from('rooms')
            .update({ status: 'occupied' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (updateError) throw updateError

        return NextResponse.json({ success: true, data: booking })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
