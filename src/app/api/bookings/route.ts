import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth'
import { postHotelPaymentIncomeAndLedger } from '@/lib/ledger'
import { nepalInputToISO } from '@/lib/utils'
import { logAudit } from '@/lib/audit'

/** One room being booked, with the guests going into it. */
interface RoomRequest {
    roomId: string
    adults: number
    male: number
    female: number
    children: number
    splitProvided: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Read the requested rooms out of the body.
 *
 * Two shapes are accepted. `rooms: [{ room_id, adult_male, ... }]` is the
 * multi-room form. A bare `room_id` with top-level guest counts is the original
 * single-room form, still sent by the demo seeder and any client that hasn't
 * been updated — it normalizes to a one-element list and takes the exact same
 * path, so a normal booking behaves as it always has.
 */
function parseRooms(body: Record<string, unknown>): { rooms: RoomRequest[] } | { error: string } {
    const raw = Array.isArray(body.rooms) && body.rooms.length > 0
        ? (body.rooms as Record<string, unknown>[])
        : [{
            room_id: body.room_id,
            adult_male: body.adult_male,
            adult_female: body.adult_female,
            children: body.children,
            guest_count: body.guest_count,
        }]

    const rooms: RoomRequest[] = []
    const seen = new Set<string>()

    for (const entry of raw) {
        const roomId = typeof entry.room_id === 'string' ? entry.room_id : ''
        if (!roomId) return { error: 'Every room in the booking needs a room_id' }
        if (seen.has(roomId)) return { error: 'The same room was added to this booking twice' }
        seen.add(roomId)

        const n = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0))
        const male = n(entry.adult_male)
        const female = n(entry.adult_female)
        const children = n(entry.children)
        // `guest_count` is still honoured so an older client that only knows a
        // head count keeps working — it lands as unspecified adults with no split.
        const splitProvided = entry.adult_male !== undefined || entry.adult_female !== undefined
        const adults = splitProvided ? male + female : n(entry.guest_count)

        if (adults < 1) return { error: 'Every room needs at least one adult guest' }

        rooms.push({ roomId, adults, male, female, children, splitProvided })
    }

    return { rooms }
}

export async function POST(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            guest_name, guest_phone, guest_email, kyc,
            check_in, check_out,
            advance_amount, advance_payment_method,
            advance_cash_amount, advance_qr_amount,
            advance_qr_code_id, advance_note,
            parking_required, parking_vehicle_no, parking_fee
        } = body

        if (!guest_name || !guest_phone || !check_in || !check_out) {
            return NextResponse.json({ error: 'Missing required booking fields' }, { status: 400 })
        }

        const parsed = parseRooms(body)
        if ('error' in parsed) {
            return NextResponse.json({ error: parsed.error }, { status: 400 })
        }
        const { rooms: roomRequests } = parsed
        // A reservation covering more than one room gets a booking_groups header
        // tying its stays together; a single room stays exactly as it was, with
        // group_id NULL, so nothing about the ordinary flow changes.
        const isGroup = roomRequests.length > 1

        // The form sends naive `YYYY-MM-DDTHH:mm` values. Resolve them against
        // Kathmandu rather than the runtime's zone — this route executes in UTC,
        // which previously shifted every stored check-in 5h45m into the future.
        let checkInISO: string
        let checkOutISO: string
        try {
            checkInISO = nepalInputToISO(check_in)
            checkOutISO = nepalInputToISO(check_out)
        } catch {
            return NextResponse.json({ error: 'Invalid check-in or check-out date' }, { status: 400 })
        }
        if (new Date(checkOutISO) <= new Date(checkInISO)) {
            return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const roomIds = roomRequests.map(r => r.roomId)

        // 1. Validate every room exists and belongs to this restaurant
        const { data: roomRows, error: roomError } = await supabase
            .from('rooms')
            .select('id, room_number, room_types:type_id(base_price)')
            .in('id', roomIds)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError
        const roomsById = new Map((roomRows || []).map(r => [r.id as string, r]))
        const missing = roomIds.filter(id => !roomsById.has(id))
        if (missing.length > 0) {
            return NextResponse.json(
                { error: missing.length === roomIds.length ? 'Room not found' : `${missing.length} of the selected rooms could not be found` },
                { status: 404 }
            )
        }

        // 2. Reject if ANY room already has an active stay — checked across the
        // whole set before a single row is written, so a group booking can never
        // half-succeed and leave some rooms occupied by a stay the front desk
        // was told had failed. Silently cancelling the existing stay here used to
        // be able to evict a real, currently-staying guest with zero warning.
        const { data: existingActive } = await supabase
            .from('bookings')
            .select('room_id, guest_name')
            .in('room_id', roomIds)
            .eq('restaurant_id', currentUser.restaurantId)
            .in('status', ['checked_in', 'pending'])

        if (existingActive && existingActive.length > 0) {
            const conflicts = existingActive.map(b => {
                const number = roomsById.get(b.room_id as string)?.room_number ?? '?'
                return `Room ${number} (${b.guest_name})`
            })
            return NextResponse.json({
                error: conflicts.length === 1
                    ? `${conflicts[0]} already has an active booking. Check that guest out before creating a new booking.`
                    : `These rooms already have active bookings: ${conflicts.join(', ')}. Check those guests out first.`
            }, { status: 409 })
        }

        // 3. Resolve advance amount — a split advance (part cash, part QR) is
        // recorded as two separate ledger postings below so both methods show
        // up in income and cash-in-bank/bank-in, instead of collapsing to one.
        const isSplitAdvance = advance_payment_method === 'split'
        const splitCashAmount = isSplitAdvance ? Math.max(0, Number(advance_cash_amount) || 0) : 0
        const splitQrAmount = isSplitAdvance ? Math.max(0, Number(advance_qr_amount) || 0) : 0
        const paidAmount = isSplitAdvance
            ? splitCashAmount + splitQrAmount
            : Math.max(0, Number(advance_amount) || 0)
        const advMethod = paidAmount > 0 ? (isSplitAdvance ? 'split' : (advance_payment_method || 'cash')) : 'none'

        // A rate the desk agreed for this stay is tagged into the notes rather
        // than given a column of its own: it belongs to this check-in window
        // only and must never touch the room type's catalog price. Every
        // billing path reads it back through getBookingCustomPrice.
        const customPriceNum = Number(body.custom_room_price)
        const customRoomPrice = Number.isFinite(customPriceNum) && customPriceNum > 0 ? customPriceNum : undefined

        // One advance is collected for the whole reservation, but paid_amount
        // lives per booking. Spread it across the rooms in proportion to their
        // nightly rate so per-room revenue reporting stays honest, and give the
        // rounding remainder to the first room so the parts always sum to the
        // total the guest actually handed over.
        //
        // An agreed rate replaces the catalog price for every room on the
        // reservation, so it is what the advance should be split against too.
        const roomPrices = roomRequests.map(r =>
            customRoomPrice ?? (Number((roomsById.get(r.roomId)?.room_types as { base_price?: number } | null)?.base_price) || 0)
        )
        const priceTotal = roomPrices.reduce((s, p) => s + p, 0)
        const advanceShares = roomRequests.map((_, i) => {
            if (paidAmount <= 0) return 0
            if (roomRequests.length === 1) return paidAmount
            // With no rates on file, fall back to an even split.
            const share = priceTotal > 0 ? (roomPrices[i] / priceTotal) : (1 / roomRequests.length)
            return round2(paidAmount * share)
        })
        if (paidAmount > 0 && roomRequests.length > 1) {
            const allocated = advanceShares.reduce((s, a) => s + a, 0)
            advanceShares[0] = round2(advanceShares[0] + (paidAmount - allocated))
        }

        // Parking is asked once for the reservation, not per room — one guest
        // arrives in one car however many rooms they take. The flag and plate go
        // on every room so any of them answers "does this stay have a vehicle?",
        // but the fee is posted as a single charge further down.
        const parkingRequired = parking_required === true || parking_required === 'true'
        const parkingVehicleNo = typeof parking_vehicle_no === 'string' && parking_vehicle_no.trim()
            ? parking_vehicle_no.trim().slice(0, 32)
            : null
        const parkingFee = Math.max(0, Number(parking_fee) || 0)
        if (!Number.isFinite(parkingFee)) {
            return NextResponse.json({ error: 'parking_fee must be a number' }, { status: 400 })
        }

        let notesStr = kyc ? `KYC: ${kyc.trim()}` : ''
        if (customRoomPrice) {
            notesStr = `${notesStr ? notesStr + ' | ' : ''}[CUSTOM_RATE:${customRoomPrice}]`
        }
        const notes = notesStr || null
        const guestName = String(guest_name).trim()
        const guestPhone = String(guest_phone).trim()
        const guestEmail = typeof guest_email === 'string' && guest_email.trim() ? guest_email.trim() : null

        // 4. Create the reservation header for a multi-room stay
        let groupId: string | null = null
        if (isGroup) {
            const { data: group, error: groupError } = await supabase
                .from('booking_groups')
                .insert({
                    restaurant_id: currentUser.restaurantId,
                    guest_name: guestName,
                    guest_phone: guestPhone,
                    guest_email: guestEmail,
                    check_in: checkInISO,
                    check_out: checkOutISO,
                    notes,
                    created_by: currentUser.id,
                })
                .select('id')
                .single()
            if (groupError) throw groupError
            groupId = group.id
        }

        // 5. Insert one booking per room.
        //
        // There is no transaction available through the JS client, and the
        // per-room EXCLUDE constraint can still reject a room that was free at
        // step 2 but got claimed a moment later. So a failure part-way through
        // unwinds what was already written rather than leaving the guest with
        // some of their rooms — the front desk gets a clean error and retries.
        const insertedBookingIds: string[] = []
        const rollback = async () => {
            if (insertedBookingIds.length > 0) {
                await supabase.from('bookings').delete().in('id', insertedBookingIds)
            }
            if (groupId) {
                await supabase.from('booking_groups').delete().eq('id', groupId)
            }
        }

        const bookings: Array<{ id: string; room_id: string; guest_name: string }> = []
        for (const [i, r] of roomRequests.entries()) {
            const { data: booking, error: bookingError } = await supabase
                .from('bookings')
                .insert({
                    restaurant_id: currentUser.restaurantId,
                    group_id: groupId,
                    room_id: r.roomId,
                    guest_name: guestName,
                    guest_phone: guestPhone,
                    guest_email: guestEmail,
                    check_in: checkInISO,
                    check_out: checkOutISO,
                    adults: r.adults,
                    adult_male: r.splitProvided ? r.male : 0,
                    adult_female: r.splitProvided ? r.female : 0,
                    children: r.children,
                    status: 'checked_in',
                    checked_in_by: currentUser.id,
                    notes,
                    paid_amount: advanceShares[i],
                    advance_payment_method: advMethod,
                    parking_required: parkingRequired,
                    parking_vehicle_no: parkingVehicleNo,
                })
                .select()
                .single()

            if (bookingError || !booking) {
                await rollback()
                const roomNumber = roomsById.get(r.roomId)?.room_number ?? '?'
                const detail = bookingError?.message || 'unknown error'
                // The EXCLUDE constraint is the expected loser of a race here.
                const isOverlap = /overlap|exclusion/i.test(detail)
                return NextResponse.json({
                    error: isOverlap
                        ? `Room ${roomNumber} was just booked by someone else. No rooms were reserved — please try again.`
                        : `Could not book room ${roomNumber}: ${detail}`
                }, { status: isOverlap ? 409 : 500 })
            }

            insertedBookingIds.push(booking.id)
            bookings.push(booking)
        }

        // Open the first room segment for each stay. Every stay has at least
        // one, so the folio can price each night from the room actually
        // occupied rather than from whatever room the booking points at when
        // the bill is drawn.
        const { error: segmentError } = await supabase
            .from('booking_room_stays')
            .insert(bookings.map(b => ({
                restaurant_id: currentUser.restaurantId,
                booking_id: b.id,
                room_id: b.room_id,
                from_ts: checkInISO,
            })))
        if (segmentError) {
            // Not fatal — the folio falls back to the booking's current room when
            // a stay has no segments, which is the pre-move behaviour. Losing the
            // booking over a history row would be the worse trade.
            console.error('Failed to open room segments for bookings', insertedBookingIds, segmentError)
        }

        // 6. Update room status to occupied
        const { error: updateError } = await supabase
            .from('rooms')
            .update({ status: 'occupied' })
            .in('id', roomIds)
            .eq('restaurant_id', currentUser.restaurantId)

        if (updateError) throw updateError

        // Log the advance to the financial ledger and books automatically.
        // A group collects one advance for the whole reservation, so it posts
        // once, described by every room it covers — posting per room would
        // multiply one payment into several in the day book. Split advances
        // post once per method so cash and QR each land in the correct
        // income/cash-in-bank totals instead of one lump sum.
        const roomLabel = roomRequests
            .map(r => roomsById.get(r.roomId)?.room_number ?? 'Unknown')
            .join(', ')
        const primaryBookingId = bookings[0].id

        // A parking fee bills as an ordinary folio charge, on the first room of
        // the reservation only — the guest parked one vehicle and owes for it
        // once, so posting it per room would multiply the fee by the room count.
        // Not fatal if it fails: the rooms are booked and the guest is in house,
        // and a missing incidental is added at the desk in seconds, whereas
        // unwinding a completed booking over it is not recoverable.
        if (parkingFee > 0) {
            const { error: parkingChargeError } = await supabase.from('room_charges').insert({
                restaurant_id: currentUser.restaurantId,
                booking_id: primaryBookingId,
                description: parkingVehicleNo ? `Parking (${parkingVehicleNo})` : 'Parking',
                amount: parkingFee,
                charge_type: 'parking',
                charged_by: currentUser.id,
            })
            if (parkingChargeError) {
                console.error('Failed to post parking charge for booking', primaryBookingId, parkingChargeError)
            }
        }

        const noteText = advance_note && String(advance_note).trim() ? String(advance_note).trim() : 'Advance'
        const customDesc = `Room Advance (${noteText}): ${guestName} (Room ${roomLabel})`

        if (isSplitAdvance) {
            if (splitCashAmount > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: primaryBookingId,
                    roomNumber: roomLabel,
                    guestName,
                    amount: splitCashAmount,
                    paymentMethod: 'cash',
                    isAdvance: true,
                    description: customDesc
                })
            }
            if (splitQrAmount > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: primaryBookingId,
                    roomNumber: roomLabel,
                    guestName,
                    amount: splitQrAmount,
                    paymentMethod: 'qr_digital',
                    isAdvance: true,
                    qrCodeId: advance_qr_code_id || null,
                    description: customDesc
                })
            }
        } else if (paidAmount > 0) {
            const paymentMethodMapped = advMethod === 'cash' ? 'cash' : 'qr_digital'

            await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                bookingId: primaryBookingId,
                roomNumber: roomLabel,
                guestName,
                amount: paidAmount,
                paymentMethod: paymentMethodMapped,
                isAdvance: true,
                qrCodeId: paymentMethodMapped === 'qr_digital' ? (advance_qr_code_id || null) : null,
                description: customDesc
            })
        }

        if (paidAmount > 0) {
            await supabase.from('booking_payments').insert({
                restaurant_id: currentUser.restaurantId,
                booking_id: primaryBookingId,
                amount: paidAmount,
                payment_method: advMethod,
                cash_amount: isSplitAdvance ? splitCashAmount : (advMethod === 'cash' ? paidAmount : 0),
                qr_amount: isSplitAdvance ? splitQrAmount : (advMethod === 'qr_digital' ? paidAmount : 0),
                note: noteText,
                created_by: currentUser.id
            })
        }


        // `data` stays the single primary booking so existing callers that read
        // `data.id` keep working; group callers read `data.bookings`.
        return NextResponse.json({
            success: true,
            data: bookings[0],
            group_id: groupId,
            bookings,
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

/**
 * Edit active booking details (custom room rate, guest information, KYC, dates, guest mix, parking).
 */
export async function PATCH(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { bookingId, reason } = body

        if (!bookingId || typeof bookingId !== 'string') {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Fetch existing booking
        const { data: existing, error: fetchErr } = await supabase
            .from('bookings')
            .select('*')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (fetchErr || !existing) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        if (!['pending', 'checked_in'].includes(existing.status)) {
            return NextResponse.json(
                { error: 'Cannot edit a stay that is already closed or cancelled' },
                { status: 409 }
            )
        }

        const updates: Record<string, any> = {}

        // Guest info
        if (body.guest_name !== undefined) {
            const name = String(body.guest_name).trim()
            if (!name) return NextResponse.json({ error: 'Guest name cannot be empty' }, { status: 400 })
            updates.guest_name = name
        }
        if (body.guest_phone !== undefined) {
            const phone = String(body.guest_phone).trim()
            if (!phone) return NextResponse.json({ error: 'Guest phone cannot be empty' }, { status: 400 })
            updates.guest_phone = phone
        }
        if (body.guest_email !== undefined) {
            updates.guest_email = typeof body.guest_email === 'string' && body.guest_email.trim() ? body.guest_email.trim() : null
        }

        // Guest mix
        if (body.adult_male !== undefined || body.adult_female !== undefined || body.children !== undefined) {
            const male = Math.max(0, Math.trunc(Number(body.adult_male ?? existing.adult_male) || 0))
            const female = Math.max(0, Math.trunc(Number(body.adult_female ?? existing.adult_female) || 0))
            const children = Math.max(0, Math.trunc(Number(body.children ?? existing.children) || 0))
            if (male + female < 1) {
                return NextResponse.json({ error: 'At least one adult guest is required' }, { status: 400 })
            }
            updates.adult_male = male
            updates.adult_female = female
            updates.children = children
            updates.adults = male + female
        }

        // Dates
        let checkInISO = existing.check_in
        let checkOutISO = existing.check_out
        if (body.check_in) {
            try {
                checkInISO = nepalInputToISO(body.check_in)
            } catch {
                return NextResponse.json({ error: 'Invalid check-in date' }, { status: 400 })
            }
        }
        if (body.check_out) {
            try {
                checkOutISO = nepalInputToISO(body.check_out)
            } catch {
                return NextResponse.json({ error: 'Invalid check-out date' }, { status: 400 })
            }
        }
        if (new Date(checkOutISO) <= new Date(checkInISO)) {
            return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })
        }
        updates.check_in = checkInISO
        updates.check_out = checkOutISO

        // Parking
        if (body.parking_required !== undefined) {
            updates.parking_required = body.parking_required === true || body.parking_required === 'true'
        }
        if (body.parking_vehicle_no !== undefined) {
            updates.parking_vehicle_no = typeof body.parking_vehicle_no === 'string' && body.parking_vehicle_no.trim()
                ? body.parking_vehicle_no.trim().slice(0, 32)
                : null
        }
        if (body.parking_fee !== undefined) {
            const fee = Math.max(0, Number(body.parking_fee) || 0)
            if (!Number.isFinite(fee)) return NextResponse.json({ error: 'Invalid parking fee' }, { status: 400 })
            
            // Update parking charge in room_charges table instead of non-existent column on bookings
            await supabase.from('room_charges').delete().eq('booking_id', bookingId).eq('charge_type', 'parking')
            if (fee > 0) {
                const vehicleNo = updates.parking_vehicle_no !== undefined ? updates.parking_vehicle_no : existing.parking_vehicle_no
                await supabase.from('room_charges').insert({
                    restaurant_id: currentUser.restaurantId,
                    booking_id: bookingId,
                    description: vehicleNo ? `Parking (${vehicleNo})` : 'Parking',
                    amount: fee,
                    charge_type: 'parking',
                    charged_by: currentUser.id,
                })
            }
        }

        // Handle Notes (KYC + Custom Rate)
        let currentNotes = existing.notes || ''
        let hasNotesChange = false

        if (body.kyc !== undefined) {
            hasNotesChange = true
            const kycStr = typeof body.kyc === 'string' ? body.kyc.trim() : ''
            // Strip existing KYC prefix
            currentNotes = currentNotes.replace(/^KYC:\s*[^|]*/, '').replace(/^\|\s*/, '').trim()
            if (kycStr) {
                currentNotes = `KYC: ${kycStr}${currentNotes ? ' | ' + currentNotes : ''}`
            }
        }

        if (body.custom_room_price !== undefined) {
            hasNotesChange = true
            const priceNum = Number(body.custom_room_price)
            const customPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null
            // Strip existing [CUSTOM_RATE:x]
            currentNotes = currentNotes.replace(/\[CUSTOM_RATE:[^\]]*\]/g, '').replace(/\|\s*$/, '').trim()
            if (customPrice) {
                currentNotes = `${currentNotes ? currentNotes + ' | ' : ''}[CUSTOM_RATE:${customPrice}]`
            }
        }

        if (hasNotesChange) {
            updates.notes = currentNotes || null
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }

        // Apply update to booking
        const { data: updated, error: updateErr } = await supabase
            .from('bookings')
            .update(updates)
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .select()
            .single()

        if (updateErr) throw updateErr

        // Audit logging
        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_edited',
            entityType: 'booking',
            entityId: bookingId,
            oldValue: {
                guest_name: existing.guest_name,
                guest_phone: existing.guest_phone,
                check_in: existing.check_in,
                check_out: existing.check_out,
                notes: existing.notes,
                parking_fee: existing.parking_fee,
            },
            newValue: {
                ...updates,
                reason: reason || 'Booking details updated by cashier/admin',
            },
        })

        return NextResponse.json({
            success: true,
            data: updated,
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
