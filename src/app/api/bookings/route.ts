import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getOptionalUser } from '@/lib/auth'
import { postHotelPaymentIncomeAndLedger } from '@/lib/ledger'
import { nepalInputToISO } from '@/lib/utils'

export async function POST(req: Request) {
    try {
        const currentUser = await getOptionalUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            room_id, guest_name, guest_phone, kyc,
            check_in, check_out, guest_count,
            adult_male, adult_female, children,
            advance_amount, advance_payment_method,
            advance_cash_amount, advance_qr_amount,
            advance_qr_code_id
        } = body

        if (!room_id || !guest_name || !guest_phone || !check_in || !check_out) {
            return NextResponse.json({ error: 'Missing required booking fields' }, { status: 400 })
        }

        // Guest mix. `guest_count` is still accepted so an older client (or the
        // demo seeder) that only knows a head count keeps working — it lands as
        // unspecified adults with no split.
        const maleCount = Math.max(0, Math.trunc(Number(adult_male) || 0))
        const femaleCount = Math.max(0, Math.trunc(Number(adult_female) || 0))
        const childCount = Math.max(0, Math.trunc(Number(children) || 0))
        const splitProvided = adult_male !== undefined || adult_female !== undefined
        const adultTotal = splitProvided
            ? maleCount + femaleCount
            : Math.max(0, Math.trunc(Number(guest_count) || 0))

        if (adultTotal < 1) {
            return NextResponse.json({ error: 'A booking needs at least one adult guest' }, { status: 400 })
        }

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

        // 1. Validate room exists
        const { data: room, error: roomError } = await supabase
            .from('rooms')
            .select('*, room_types:type_id(*)')
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()

        if (roomError || !room) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 })
        }

        // 2. Reject if this room already has an active stay - silently cancelling
        // it here used to be able to evict a real, currently-staying guest with
        // zero warning. Front desk needs to check that guest out first.
        const { data: existingActiveBooking } = await supabase
            .from('bookings')
            .select('id, guest_name')
            .eq('room_id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .in('status', ['checked_in', 'pending'])
            .limit(1)
            .maybeSingle()

        if (existingActiveBooking) {
            return NextResponse.json({
                error: `Room already has an active booking for ${existingActiveBooking.guest_name}. Check that guest out before creating a new booking.`
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

        // 4. Insert booking
        const notes = kyc ? `KYC: ${kyc.trim()}` : null
        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .insert({
                restaurant_id: currentUser.restaurantId,
                room_id,
                guest_name: guest_name.trim(),
                guest_phone: guest_phone.trim(),
                check_in: checkInISO,
                check_out: checkOutISO,
                adults: adultTotal,
                adult_male: splitProvided ? maleCount : 0,
                adult_female: splitProvided ? femaleCount : 0,
                children: childCount,
                status: 'checked_in',
                notes,
                paid_amount: paidAmount,
                advance_payment_method: advMethod,
            })
            .select()
            .single()

        if (bookingError) throw bookingError

        // Open the first room segment. Every stay has at least one, so the folio
        // can price each night from the room actually occupied rather than from
        // whatever room the booking points at when the bill is drawn.
        const { error: segmentError } = await supabase
            .from('booking_room_stays')
            .insert({
                restaurant_id: currentUser.restaurantId,
                booking_id: booking.id,
                room_id,
                from_ts: checkInISO,
            })
        if (segmentError) {
            // Not fatal — the folio falls back to the booking's current room when
            // a stay has no segments, which is the pre-move behaviour. Losing the
            // booking over a history row would be the worse trade.
            console.error('Failed to open room segment for booking', booking.id, segmentError)
        }

        // 4. Update room status to occupied
        const { error: updateError } = await supabase
            .from('rooms')
            .update({ status: 'occupied' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (updateError) throw updateError

        // Log advance payment to financial ledger and books automatically.
        // Split advances post once per method so cash and QR each land in the
        // correct income/cash-in-bank totals instead of one lump sum.
        if (isSplitAdvance) {
            const roomNumber = room?.room_number || 'Unknown'
            if (splitCashAmount > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: booking.id,
                    roomNumber,
                    guestName: booking.guest_name,
                    amount: splitCashAmount,
                    paymentMethod: 'cash',
                    isAdvance: true
                })
            }
            if (splitQrAmount > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: booking.id,
                    roomNumber,
                    guestName: booking.guest_name,
                    amount: splitQrAmount,
                    paymentMethod: 'qr_digital',
                    isAdvance: true,
                    qrCodeId: advance_qr_code_id || null
                })
            }
        } else if (paidAmount > 0) {
            const roomNumber = room?.room_number || 'Unknown'
            const paymentMethodMapped = advMethod === 'cash' ? 'cash' : 'qr_digital'

            await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                bookingId: booking.id,
                roomNumber,
                guestName: booking.guest_name,
                amount: paidAmount,
                paymentMethod: paymentMethodMapped,
                isAdvance: true,
                qrCodeId: paymentMethodMapped === 'qr_digital' ? (advance_qr_code_id || null) : null
            })
        }

        return NextResponse.json({ success: true, data: booking })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
