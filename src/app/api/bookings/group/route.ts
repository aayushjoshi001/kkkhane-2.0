import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { computeFolioForStays } from '@/lib/folio'

/**
 * The other rooms settling on the same bill as a given booking.
 *
 * The checkout modal is opened from one room, but a multi-room reservation is
 * billed and closed as a unit. This tells the modal what the rest of that unit
 * is — the rooms, their nightly costs, and the combined advance already paid —
 * so the cashier sees the real bill before taking payment rather than one
 * room's share of it.
 *
 * Returns `isGroup: false` for an ordinary single-room stay, which is the
 * signal for the modal to keep using its own single-room math untouched.
 */
export async function GET(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const bookingId = new URL(req.url).searchParams.get('bookingId')
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const { data: currentRest } = await supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', currentUser.restaurantId)
            .maybeSingle()

        const partnerId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
        const targetRestaurantIds = [currentUser.restaurantId]
        if (partnerId) targetRestaurantIds.push(partnerId)

        const { data: booking } = await supabase
            .from('bookings')
            .select('id, group_id, restaurant_id')
            .eq('id', bookingId)
            .in('restaurant_id', targetRestaurantIds)
            .maybeSingle()

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (!booking.group_id) {
            return NextResponse.json({ success: true, isGroup: false })
        }

        const { data: members } = await supabase
            .from('bookings')
            .select('id, room_id, check_in, check_out, checked_out_at, status, paid_amount, discount_amount, rooms:room_id(room_number)')
            .eq('group_id', booking.group_id)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: true })

        if (!members || members.length < 2) {
            return NextResponse.json({ success: true, isGroup: false })
        }

        const folio = await computeFolioForStays(supabase, {
            restaurantId: booking.restaurant_id,
            stays: members.map(m => ({
                bookingId: m.id as string,
                roomId: m.room_id as string,
                checkIn: m.check_in as string,
                checkOut: m.check_out as string,
                checkedOutAt: m.checked_out_at as string | null,
                status: m.status as string | null,
            })),
            sessionId: null,
            discountAmount: 0,
        })

        const stayCostFor = new Map(folio.rooms.map(r => [r.bookingId, r]))

        return NextResponse.json({
            success: true,
            isGroup: true,
            groupId: booking.group_id,
            // Every room the bill covers, each with the cost it contributes.
            rooms: members.map(m => {
                const line = stayCostFor.get(m.id as string)
                const roomRaw = m.rooms as unknown
                const roomRow = Array.isArray(roomRaw) ? roomRaw[0] : (roomRaw as { room_number?: string } | null)
                return {
                    bookingId: m.id,
                    roomId: m.room_id,
                    roomNumber: roomRow?.room_number ?? line?.roomNumber ?? '',
                    nights: line?.nights ?? 0,
                    stayCost: line?.stayCost ?? 0,
                    paidAmount: Number(m.paid_amount) || 0,
                }
            }),
            stayCost: folio.stayCost,
            chargesTotal: folio.chargesTotal,
            ordersTotal: folio.ordersTotal,
            // Combined advance across the reservation's rooms.
            advancePaid: members.reduce((s, m) => s + (Number(m.paid_amount) || 0), 0),
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
