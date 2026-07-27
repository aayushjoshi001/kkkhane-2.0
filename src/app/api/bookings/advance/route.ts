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
            qrCodeId
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

        const currentPaid = Number(booking.paid_amount || 0)
        const newPaidTotal = currentPaid + addAmount

        // 3. Update the booking's paid amount
        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                paid_amount: newPaidTotal,
                advance_payment_method: booking.advance_payment_method && booking.advance_payment_method !== 'none'
                    ? booking.advance_payment_method
                    : paymentMethod
            })
            .eq('id', bookingId)

        if (updateError) throw updateError

        // 4. Log payment to financial ledger and books
        const roomNumber = (booking.rooms as any)?.room_number || 'Unknown'
        if (isSplit) {
            if (splitCash > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: booking.id,
                    roomNumber,
                    guestName: booking.guest_name,
                    amount: splitCash,
                    paymentMethod: 'cash',
                    isAdvance: true
                })
            }
            if (splitQr > 0) {
                await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                    bookingId: booking.id,
                    roomNumber,
                    guestName: booking.guest_name,
                    amount: splitQr,
                    paymentMethod: 'qr_digital',
                    isAdvance: true,
                    qrCodeId: qrCodeId || null
                })
            }
        } else {
            const methodMapped = paymentMethod === 'cash' ? 'cash' : 'qr_digital'
            await postHotelPaymentIncomeAndLedger(supabase, currentUser.restaurantId, currentUser.id, {
                bookingId: booking.id,
                roomNumber,
                guestName: booking.guest_name,
                amount: addAmount,
                paymentMethod: methodMapped,
                isAdvance: true,
                qrCodeId: methodMapped === 'qr_digital' ? (qrCodeId || null) : null
            })
        }

        return NextResponse.json({ success: true, newPaidTotal })
    } catch (e: any) {
        console.error('[booking-advance] error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
