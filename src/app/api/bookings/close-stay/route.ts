import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { computeFolioForStays } from '@/lib/folio'

/**
 * Release a room whose bill is already paid.
 *
 * The second half of an early settlement (see `close_stay` in
 * bookings/checkout). The money was posted when the guest paid; all that is
 * left the next morning is to close the stay, close the room's QR session and
 * hand the room to housekeeping. Deliberately a separate endpoint rather than a
 * flag on checkout: nothing here touches the ledger, so a desk closing rooms at
 * the start of a shift can never accidentally re-post a settlement.
 *
 * Refuses to close a stay that still owes money. Anything ordered or accrued
 * after the guest settled — another night, a last round of room service — lands
 * on the same folio and reopens a balance, and closing over the top of it would
 * write off real revenue silently. The desk is told the figure and settles it
 * through the normal checkout path, which by then is collecting only the
 * remainder.
 */

/** A rounding cushion, not a tolerance for unpaid money: the folio and the
 *  stored paid amount are both rounded to paisa and can differ in the last
 *  place. Anything above this is a real balance. */
const SETTLED_EPSILON = 0.5

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const bookingId = typeof body.booking_id === 'string' ? body.booking_id : ''
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        const [restResponse, bookingResponse] = await Promise.all([
            supabase
                .from('restaurants')
                .select('linked_restaurant_id, linked_hotel_id')
                .eq('id', currentUser.restaurantId)
                .maybeSingle(),
            supabase
                .from('bookings')
                .select('id, room_id, group_id, status, paid_amount, check_in, check_out, checked_out_at, bill_settled_at, restaurant_id, guest_name')
                .eq('id', bookingId)
                .maybeSingle()
        ])

        const currentRest = restResponse.data
        const partnerId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id
        
        const booking = bookingResponse.data
        if (booking && booking.restaurant_id !== currentUser.restaurantId && booking.restaurant_id !== partnerId) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (booking.status === 'checked_out') {
            return NextResponse.json({ error: 'This stay is already checked out' }, { status: 409 })
        }
        if (booking.status === 'cancelled') {
            return NextResponse.json({ error: 'This booking was cancelled' }, { status: 409 })
        }

        // A combined bill closes as one unit, exactly as it settles as one —
        // see the group path in bookings/checkout.
        type Member = {
            id: string
            room_id: string
            check_in: string
            check_out: string
            checked_out_at: string | null
            status: string | null
            paid_amount: number | null
        }
        let members: Member[] = [{
            id: booking.id,
            room_id: booking.room_id,
            check_in: booking.check_in,
            check_out: booking.check_out,
            checked_out_at: booking.checked_out_at ?? null,
            status: booking.status ?? null,
            paid_amount: booking.paid_amount,
        }]

        if (booking.group_id) {
            const { data: groupRows } = await supabase
                .from('bookings')
                .select('id, room_id, check_in, check_out, checked_out_at, status, paid_amount')
                .eq('group_id', booking.group_id)
                .neq('status', 'cancelled')
                .order('created_at', { ascending: true })
            if (groupRows && groupRows.length > 0) members = groupRows as Member[]
        }

        // Recomputed, never trusted from the client — the balance is the whole
        // point of this check. The stored service-charge override and discount
        // are replayed by the folio itself, so this reproduces the figure the
        // guest was actually charged plus anything added since.
        const folio = await computeFolioForStays(supabase, {
            restaurantId: booking.restaurant_id,
            stays: members.map(m => ({
                bookingId: m.id,
                roomId: m.room_id,
                checkIn: m.check_in,
                checkOut: m.check_out,
                checkedOutAt: m.checked_out_at,
                status: m.status,
            })),
            sessionId: null,
        })

        const paid = members.reduce((s, m) => s + (Number(m.paid_amount) || 0), 0)
        const balance = Math.round((folio.total - paid) * 100) / 100

        if (balance > SETTLED_EPSILON) {
            return NextResponse.json({
                error: `This stay still owes Rs. ${balance.toFixed(2)} — charges were added after the bill was settled. Settle the balance before closing the room.`,
                balance,
                total: folio.total,
                paid,
            }, { status: 409 })
        }

        const memberIds = members.map(m => m.id)
        // Only rooms this reservation still occupies — one that departed early
        // (see /api/bookings/checkout-room) went to housekeeping then and may
        // already hold a different guest.
        const memberRoomIds = members
            .filter(m => m.status !== 'checked_out')
            .map(m => m.room_id)

        // `checked_out_at` is stamped by the bookings_stamp_checked_out_at
        // trigger the moment status flips, so it is not set here.
        const [bookingRes, sessionRes, roomRes] = await Promise.all([
            supabase
                .from('bookings')
                .update({ status: 'checked_out' })
                .in('id', memberIds),
            supabase
                .from('sessions')
                .update({ status: 'closed', closed_at: new Date().toISOString() })
                .in('booking_id', memberIds)
                .eq('status', 'active'),
            supabase
                .from('rooms')
                .update({ status: 'dirty' })
                .in('id', memberRoomIds)
        ])

        if (bookingRes.error) throw bookingRes.error
        if (roomRes.error) throw roomRes.error

        void logAudit({
            restaurantId: booking.restaurant_id,
            userId: currentUser.id,
            action: 'booking_checked_out',
            entityType: 'booking',
            entityId: bookingId,
            newValue: {
                // No money moved here — this is the release of a room whose
                // bill was settled earlier, recorded so the two halves of that
                // settlement can be read back as one story.
                closed_after_early_settlement: true,
                bill_settled_at: booking.bill_settled_at,
                settled_booking_ids: memberIds,
                total_amount: folio.total,
                paid_amount: paid,
                group_id: booking.group_id || null,
            },
        })

        return NextResponse.json({
            success: true,
            roomsClosed: memberRoomIds.length,
            roomIds: memberRoomIds,
            bookingIds: memberIds,
            total: folio.total,
            paid,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
