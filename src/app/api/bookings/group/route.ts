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
/**
 * The server's own stay cost for a single (non-group) booking.
 *
 * The cashier screens used to work this out as `price * nights` at the room's
 * CURRENT catalog rate, which is wrong for any stay that moved rooms: the folio
 * bills each night at the rate of the room actually occupied that night
 * (booking_room_stays). A guest moved from a 2,000 room to a 4,000 room on night
 * 3 of 5 was quoted 20,000 against a real bill of 16,000 — the cashier collected
 * the larger figure and the settlement then posted the 4,000 difference as a
 * "Return to Guest" refund that never happened, leaving the drawer over and the
 * books short. Quoting the folio's figure is the only way the preview and the
 * settlement can agree.
 */
async function singleStayCost(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    booking: { id: string; restaurant_id: string },
): Promise<{ stayCost: number; nights: number } | null> {
    const { data: row } = await supabase
        .from('bookings')
        .select('id, room_id, check_in, check_out, checked_out_at, status')
        .eq('id', booking.id)
        .maybeSingle()
    if (!row) return null

    const folio = await computeFolioForStays(supabase, {
        restaurantId: booking.restaurant_id,
        stays: [{
            bookingId: row.id as string,
            roomId: row.room_id as string,
            checkIn: row.check_in as string,
            checkOut: row.check_out as string,
            checkedOutAt: row.checked_out_at as string | null,
            status: row.status as string | null,
        }],
        sessionId: null,
    }).catch(() => null)

    return folio ? { stayCost: folio.stayCost, nights: folio.nights } : null
}

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
            .select('id, group_id, restaurant_id, guest_name')
            .eq('id', bookingId)
            .in('restaurant_id', targetRestaurantIds)
            .maybeSingle()

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (!booking.group_id) {
            const single = await singleStayCost(supabase, booking as { id: string; restaurant_id: string })
            return NextResponse.json({ success: true, isGroup: false, ...(single ?? {}) })
        }

        const { data: members } = await supabase
            .from('bookings')
            .select('id, room_id, check_in, check_out, checked_out_at, status, paid_amount, discount_amount, bill_settled_at, rooms:room_id(room_number)')
            .eq('group_id', booking.group_id)
            .neq('status', 'cancelled')
            .order('created_at', { ascending: true })

        if (!members || members.length < 2) {
            const single = await singleStayCost(supabase, booking as { id: string; restaurant_id: string })
            return NextResponse.json({ success: true, isGroup: false, ...(single ?? {}) })
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

        // What each room owes on its own, so the till can offer to settle one of
        // them without guessing the figure.
        //
        // This is the same rule the checkout route applies under
        // settle_member_only: one stay's own nights, its own room charges and
        // the orders carrying its booking_id. Anything belonging to the
        // reservation rather than to a room is not in here and stays on the
        // folio for whoever settles last, which is why these will usually sum to
        // less than the combined total — that difference is the point, not a
        // rounding error.
        //
        // Computed per member rather than divided out of the combined folio,
        // because the folio is not a sum of parts: service charge and VAT are
        // rate-driven and have to be worked out against each room's own items.
        const memberFolios = await Promise.all(members.map(m =>
            computeFolioForStays(supabase, {
                restaurantId: booking.restaurant_id,
                stays: [{
                    bookingId: m.id as string,
                    roomId: m.room_id as string,
                    checkIn: m.check_in as string,
                    checkOut: m.check_out as string,
                    checkedOutAt: m.checked_out_at as string | null,
                    status: m.status as string | null,
                }],
                sessionId: null,
                discountAmount: 0,
            }).catch(() => null)
        ))
        const ownTotalFor = new Map(
            members.map((m, i) => [m.id as string, memberFolios[i]?.total ?? null])
        )

        return NextResponse.json({
            success: true,
            isGroup: true,
            groupId: booking.group_id,
            guestName: booking.guest_name ?? '',
            // Nights on the longest room, matching FolioBreakdown.nights — the
            // receipt prints per-room nights from `rooms` below, this is only
            // for the one-line summaries.
            nights: folio.nights,
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
                    // This room's guest has already left, but their share is
                    // still on this bill and settles with everyone else — see
                    // /api/bookings/checkout-room. Its nights are frozen at
                    // checked_out_at, so the figures above stop growing.
                    departed: m.status === 'checked_out',
                    departedAt: (m.checked_out_at as string | null) ?? null,
                    // This room's own bill, if settled on its own. Null when the
                    // folio for it could not be computed, which the till reads as
                    // "offer the combined settle only".
                    ownTotal: ownTotalFor.get(m.id as string) ?? null,
                    settled: !!m.bill_settled_at,
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
