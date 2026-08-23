import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { postHotelPaymentIncomeAndLedger } from '@/lib/ledger'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const {
            bookingId,
            amount,
            paymentMethod,
            cashAmount,
            qrAmount,
            qrCodeId,
            note
        } = body

        if (!bookingId || !paymentMethod) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Retrieve the booking
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('id, paid_amount, guest_name, room_id, advance_payment_method, rooms(room_number)')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()

        if (fetchError || !booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        // 2. Parse amounts
        const isSplit = paymentMethod === 'split'
        const splitCash = isSplit ? Math.max(0, Number(cashAmount) || 0) : 0
        const splitQr = isSplit ? Math.max(0, Number(qrAmount) || 0) : 0
        const addAmount = isSplit ? splitCash + splitQr : Math.max(0, Number(amount) || 0)

        if (addAmount <= 0) {
            return NextResponse.json({ error: 'Payment amount must be greater than 0' }, { status: 400 })
        }

        // 3. Add to the booking's paid amount in one statement. Reading it into
        // JS and writing back the sum lost one of two deposits taken at the same
        // moment (or a deposit racing a linked table bill): the payment row and
        // the ledger posting both survived, so the books showed money the guest's
        // balance did not.
        const { data: incrementedPaid, error: incrementError } = await supabase
            .rpc('increment_booking_paid_amount', {
                p_booking_id: bookingId,
                p_restaurant_id: currentUser.restaurantId,
                p_amount: addAmount,
            })

        if (incrementError) throw incrementError
        const newPaidTotal = Number(incrementedPaid) || 0

        // The method is only stamped the first time; a later deposit by another
        // method leaves the original in place, as before.
        if (!booking.advance_payment_method || booking.advance_payment_method === 'none') {
            const { error: methodError } = await supabase
                .from('bookings')
                .update({ advance_payment_method: paymentMethod })
                .eq('id', bookingId)
                .eq('restaurant_id', currentUser.restaurantId)
            if (methodError) throw methodError
        }

        // 4. Log payment to financial ledger and books
        const roomNumber = (booking.rooms as any)?.room_number || 'Unknown'
        const noteText = note && String(note).trim() ? String(note).trim() : 'Advance'
        const customDesc = `Room Advance (${noteText}): ${booking.guest_name} (Room ${roomNumber})`

        const postTasks: PromiseLike<any>[] = []

        if (isSplit) {
            if (splitCash > 0) {
                postTasks.push(
                    postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                        bookingId: booking.id,
                        roomNumber,
                        guestName: booking.guest_name,
                        amount: splitCash,
                        paymentMethod: 'cash',
                        isAdvance: true,
                        description: customDesc
                    })
                )
            }
            if (splitQr > 0) {
                postTasks.push(
                    postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                        bookingId: booking.id,
                        roomNumber,
                        guestName: booking.guest_name,
                        amount: splitQr,
                        paymentMethod: 'qr_digital',
                        isAdvance: true,
                        qrCodeId: qrCodeId || null,
                        description: customDesc
                    })
                )
            }
        } else {
            const methodMapped = paymentMethod === 'cash' ? 'cash' : 'qr_digital'
            postTasks.push(
                postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: booking.id,
                    roomNumber,
                    guestName: booking.guest_name,
                    amount: addAmount,
                    paymentMethod: methodMapped,
                    isAdvance: true,
                    qrCodeId: methodMapped === 'qr_digital' ? (qrCodeId || null) : null,
                    description: customDesc
                })
            )
        }

        // 5. Insert payment record into booking_payments table
        postTasks.push(
            supabase.from('booking_payments').insert({
                restaurant_id: currentUser.restaurantId,
                booking_id: booking.id,
                amount: addAmount,
                payment_method: paymentMethod,
                cash_amount: isSplit ? splitCash : (paymentMethod === 'cash' ? addAmount : 0),
                qr_amount: isSplit ? splitQr : (paymentMethod === 'qr_digital' ? addAmount : 0),
                note: noteText,
                payment_kind: 'advance',
                created_by: currentUser.id
            })
                .then(({ error: paymentError }) => {
                    if (paymentError) {
                        console.error('Failed to record booking payment for booking', booking.id, paymentError)
                    }
                })
        )

        await Promise.all(postTasks)

        return NextResponse.json({ success: true, newPaidTotal })
    } catch (e: any) {
        console.error('[booking-advance] error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
