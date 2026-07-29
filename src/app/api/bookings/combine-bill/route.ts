import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

/**
 * Put several separately-made bookings onto one bill, and take them off it again.
 *
 * `booking_groups` already models "one guest, several rooms", but until now the
 * only way into it was the booking form: the rooms had to be chosen together,
 * in one go. Real desks don't work that way. A guest takes a room on Monday,
 * their colleague arrives Wednesday and takes another, and at checkout they
 * want one bill. Three separate stays entered hours apart are exactly the case
 * the group folio was built for — there was just no way to say so after the
 * fact.
 *
 * This is purely a re-parenting of `bookings.group_id`. No money moves and no
 * stay record changes: the folio, the group checkout RPC and the receipt all
 * key off group membership and start producing a combined bill the moment
 * membership changes. Which also means it is fully reversible right up until
 * settlement — see DELETE below.
 *
 * The rooms need not share a stay window. `computeFolioForStays` prices every
 * room over its own nights at its own rate, so a Monday room and a Wednesday
 * room combine correctly; only the header's display dates are widened to span
 * them both.
 */

/** A stay that may still be moved between bills. */
type MemberRow = {
    id: string
    room_id: string
    group_id: string | null
    guest_name: string
    guest_phone: string | null
    guest_email: string | null
    check_in: string
    check_out: string
    status: string | null
}

const OPEN_STATUSES = ['pending', 'checked_in']

/**
 * The stays that could join this one's bill — every other open room in the
 * hotel, minus the ones already on it.
 *
 * Each candidate reports how many rooms it would actually bring: a room that is
 * itself on a combined bill drags its whole bill along (see POST), and the
 * cashier has to be told that before they click, not after.
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

        const { data: anchor } = await supabase
            .from('bookings')
            .select('id, group_id, status')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (!anchor) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        const { data: open } = await supabase
            .from('bookings')
            .select('id, group_id, guest_name, guest_phone, check_in, check_out, paid_amount, rooms:room_id(room_number)')
            .eq('restaurant_id', currentUser.restaurantId)
            .in('status', OPEN_STATUSES)
            .order('check_in', { ascending: true })

        // How many open rooms sit on each combined bill, so a candidate can say
        // "+2 more rooms" rather than surprising the cashier after the fact.
        const groupSize = new Map<string, number>()
        for (const b of open || []) {
            const g = b.group_id as string | null
            if (g) groupSize.set(g, (groupSize.get(g) || 0) + 1)
        }

        const candidates = (open || [])
            .filter(b => b.id !== anchor.id)
            // Already on this bill — nothing to add.
            .filter(b => !anchor.group_id || b.group_id !== anchor.group_id)
            .map(b => {
                const roomRaw = b.rooms as unknown
                const roomRow = Array.isArray(roomRaw) ? roomRaw[0] : (roomRaw as { room_number?: string } | null)
                const g = b.group_id as string | null
                return {
                    bookingId: b.id as string,
                    roomNumber: roomRow?.room_number ?? '',
                    guestName: (b.guest_name as string) || '',
                    guestPhone: (b.guest_phone as string) || '',
                    checkIn: b.check_in as string,
                    checkOut: b.check_out as string,
                    advancePaid: Number(b.paid_amount) || 0,
                    /** Rooms this one would bring with it, itself included. */
                    bringsRooms: g ? (groupSize.get(g) || 1) : 1,
                }
            })

        return NextResponse.json({
            success: true,
            alreadyCombined: !!anchor.group_id,
            candidates,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const anchorId = typeof body.bookingId === 'string' ? body.bookingId : ''
        const requestedIds: string[] = Array.isArray(body.addBookingIds)
            ? body.addBookingIds.filter((id: unknown): id is string => typeof id === 'string' && !!id)
            : []

        if (!anchorId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }
        if (requestedIds.length === 0) {
            return NextResponse.json({ error: 'Pick at least one other room to add to this bill' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // Every booking named in the request, in one read. Scoped to the
        // caller's own restaurant: a linked partner restaurant may *read* these
        // stays to bill room service against them, but it must never be able to
        // reorganize another tenant's bills.
        const wantedIds = [...new Set([anchorId, ...requestedIds])]
        const { data: rows, error: fetchError } = await supabase
            .from('bookings')
            .select('id, room_id, group_id, guest_name, guest_phone, guest_email, check_in, check_out, status')
            .in('id', wantedIds)
            .eq('restaurant_id', currentUser.restaurantId)

        if (fetchError) throw fetchError

        const byId = new Map((rows || []).map(r => [r.id as string, r as MemberRow]))
        const anchor = byId.get(anchorId)
        if (!anchor) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        const missing = requestedIds.filter(id => !byId.has(id))
        if (missing.length > 0) {
            return NextResponse.json(
                { error: `${missing.length} of the selected rooms could not be found` },
                { status: 404 },
            )
        }

        // A settled or dropped stay has nothing left to combine — its money is
        // already in the books under its own bill, and pulling it onto another
        // folio now would bill the guest for it a second time.
        const closed = wantedIds
            .map(id => byId.get(id)!)
            .filter(b => !OPEN_STATUSES.includes(b.status || ''))
        if (closed.length > 0) {
            return NextResponse.json({
                error: closed.some(b => b.id === anchorId)
                    ? 'This stay is already closed, so its bill can no longer be changed.'
                    : `${closed.length} of the selected rooms have already checked out or been cancelled and cannot be added to this bill.`,
            }, { status: 409 })
        }

        // Pulling in a room that is itself already on a combined bill brings the
        // whole of that bill along. Taking just one room out of an existing
        // group would silently split a bill the desk had deliberately joined —
        // and leave the guest with a room's worth of charges on a folio nobody
        // is looking at.
        const foreignGroupIds = [...new Set(
            wantedIds
                .map(id => byId.get(id)!.group_id)
                .filter((g): g is string => !!g && g !== anchor.group_id),
        )]

        const absorbed: MemberRow[] = []
        if (foreignGroupIds.length > 0) {
            const { data: siblings } = await supabase
                .from('bookings')
                .select('id, room_id, group_id, guest_name, guest_phone, guest_email, check_in, check_out, status')
                .in('group_id', foreignGroupIds)
                .eq('restaurant_id', currentUser.restaurantId)
                .in('status', OPEN_STATUSES)
            for (const s of (siblings || []) as MemberRow[]) {
                if (!byId.has(s.id)) {
                    byId.set(s.id, s)
                    absorbed.push(s)
                }
            }
        }

        const members = [...byId.values()]
        if (members.length < 2) {
            return NextResponse.json({ error: 'A combined bill needs at least two rooms' }, { status: 400 })
        }

        // The anchor's own group is kept when it has one, so a room added to an
        // existing combined bill doesn't churn the group id that the audit trail
        // and any open receipt already reference.
        let groupId = anchor.group_id
        const checkIn = members.reduce((min, m) => (m.check_in < min ? m.check_in : min), members[0].check_in)
        const checkOut = members.reduce((max, m) => (m.check_out > max ? m.check_out : max), members[0].check_out)

        if (groupId) {
            // Widen the header to span every room now on it. These dates are
            // display only — each room is still billed over its own nights.
            const { error: headerError } = await supabase
                .from('booking_groups')
                .update({ check_in: checkIn, check_out: checkOut })
                .eq('id', groupId)
                .eq('restaurant_id', currentUser.restaurantId)
            if (headerError) throw headerError
        } else {
            const { data: group, error: groupError } = await supabase
                .from('booking_groups')
                .insert({
                    restaurant_id: currentUser.restaurantId,
                    // The bill goes out under the guest the cashier opened it
                    // from, not whoever happens to sort first.
                    guest_name: anchor.guest_name,
                    guest_phone: anchor.guest_phone,
                    guest_email: anchor.guest_email,
                    check_in: checkIn,
                    check_out: checkOut,
                    created_by: currentUser.id,
                })
                .select('id')
                .single()
            if (groupError) throw groupError
            groupId = group.id as string
        }

        const memberIds = members.map(m => m.id)
        const { error: linkError } = await supabase
            .from('bookings')
            .update({ group_id: groupId })
            .in('id', memberIds)
            .eq('restaurant_id', currentUser.restaurantId)
        if (linkError) throw linkError

        // Headers left with no rooms are dropped so they can't show up as empty
        // reservations. ON DELETE SET NULL on bookings.group_id means this can
        // never take a stay record with it, but the update above has already
        // moved every one of them anyway.
        if (foreignGroupIds.length > 0) {
            const { data: stillUsed } = await supabase
                .from('bookings')
                .select('group_id')
                .in('group_id', foreignGroupIds)
            const inUse = new Set((stillUsed || []).map(r => r.group_id as string))
            const empty = foreignGroupIds.filter(g => !inUse.has(g))
            if (empty.length > 0) {
                await supabase
                    .from('booking_groups')
                    .delete()
                    .in('id', empty)
                    .eq('restaurant_id', currentUser.restaurantId)
            }
        }

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_bill_combined',
            entityType: 'booking',
            entityId: anchorId,
            newValue: {
                group_id: groupId,
                member_booking_ids: memberIds,
                // Rooms that came along because they were already sharing a
                // bill with something the cashier picked.
                absorbed_booking_ids: absorbed.map(a => a.id),
                absorbed_group_ids: foreignGroupIds,
            },
        })

        return NextResponse.json({
            success: true,
            groupId,
            bookingIds: memberIds,
            roomCount: memberIds.length,
            absorbedCount: absorbed.length,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

/**
 * Take one room back off a combined bill.
 *
 * The undo for a mis-click at the desk. Only available while the stay is still
 * open — once it has been settled its share of the money is recorded against
 * the combined bill, and detaching it afterwards would leave that money
 * attributed to a bill the room is no longer on.
 */
export async function DELETE(req: Request) {
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

        const { data: booking } = await supabase
            .from('bookings')
            .select('id, group_id, status')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (!booking.group_id) {
            return NextResponse.json({ error: 'This room is not on a combined bill' }, { status: 400 })
        }
        if (!OPEN_STATUSES.includes(booking.status || '')) {
            return NextResponse.json(
                { error: 'This stay is already closed, so its bill can no longer be changed.' },
                { status: 409 },
            )
        }

        const groupId = booking.group_id as string

        // A room whose guest has already gone home (see
        // /api/bookings/checkout-room) is owed for but cannot be talked to. If
        // separating this room would leave that one alone on the bill, the bill
        // becomes unreachable — every screen that settles one gets to it through
        // a room that is still checked in — and its money quietly strands.
        const { data: groupRows } = await supabase
            .from('bookings')
            .select('id, status')
            .eq('group_id', groupId)
            .eq('restaurant_id', currentUser.restaurantId)
            .neq('status', 'cancelled')

        const departed = (groupRows || []).filter(b => b.status === 'checked_out')
        const openAfter = (groupRows || []).filter(
            b => b.id !== bookingId && OPEN_STATUSES.includes((b.status as string) || ''),
        )
        if (departed.length > 0 && openAfter.length === 0) {
            return NextResponse.json({
                error: `${departed.length} room${departed.length === 1 ? ' has' : 's have'} already checked out against this bill and still owe on it. Settle the bill before separating the last room still in house.`,
            }, { status: 409 })
        }

        const { error: detachError } = await supabase
            .from('bookings')
            .update({ group_id: null })
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
        if (detachError) throw detachError

        // A "combined" bill with one room left is just a normal stay wearing a
        // group id — and one that would keep the group checkout path warm for
        // no reason. Cancelled rooms don't count towards the two, since the
        // folio and the checkout route both skip them.
        const { data: remaining } = await supabase
            .from('bookings')
            .select('id')
            .eq('group_id', groupId)
            .neq('status', 'cancelled')

        const remainingIds = (remaining || []).map(r => r.id as string)
        if (remainingIds.length < 2) {
            if (remainingIds.length === 1) {
                await supabase.from('bookings').update({ group_id: null }).in('id', remainingIds)
            }
            await supabase
                .from('booking_groups')
                .delete()
                .eq('id', groupId)
                .eq('restaurant_id', currentUser.restaurantId)
        }

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_bill_separated',
            entityType: 'booking',
            entityId: bookingId,
            newValue: {
                previous_group_id: groupId,
                remaining_booking_ids: remainingIds.length < 2 ? [] : remainingIds,
                group_dissolved: remainingIds.length < 2,
            },
        })

        return NextResponse.json({
            success: true,
            dissolved: remainingIds.length < 2,
            remainingCount: remainingIds.length,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
