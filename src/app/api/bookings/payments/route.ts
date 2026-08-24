import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const bookingId = searchParams.get('bookingId')

        if (!bookingId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Fetch booking details (including guest_name and room details)
        const { data: booking, error: bookingErr } = await supabase
            .from('bookings')
            .select('id, group_id, paid_amount, guest_name, advance_payment_method, created_at, rooms(room_number)')
            .eq('id', bookingId)
            .eq('restaurant_id', currentUser.restaurantId)
            .single()

        if (bookingErr || !booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        let targetBookingIds = [booking.id]
        if (booking.group_id) {
            const { data: groupBookings } = await supabase
                .from('bookings')
                .select('id')
                .eq('group_id', booking.group_id)
                .eq('restaurant_id', currentUser.restaurantId)

            if (groupBookings && groupBookings.length > 0) {
                targetBookingIds = groupBookings.map(b => b.id)
            }
        }

        // 2. Query booking_payments history
        const { data: paymentRows, error: payErr } = await supabase
            .from('booking_payments')
            .select('*')
            .in('booking_id', targetBookingIds)
            .order('created_at', { ascending: true })

        if (payErr) {
            console.error('Error fetching booking payments:', payErr)
        }

        let payments = paymentRows || []

        // 3. Legacy fallback: a booking that predates booking_payments carries its
        // advance only on bookings.paid_amount. Synthesise a single row so the
        // history modal can still show it. Nothing is written back.
        //
        // This previously reconstructed individual advances by scanning
        // day_book_entries for 'room_deposit' rows whose free text contained the
        // guest name or "room <n>" — with no upper time bound — and INSERTed them
        // onto this booking. A GET that mutates: deposits left by later guests in
        // the same room matched too, so merely opening the modal could attach
        // other people's money to this bill permanently and print a RETURN TO
        // GUEST line for it. Reconstructing payment history from free text is not
        // recoverable; if the real breakdown matters it has to come from a source
        // that carries booking_id.
        if (payments.length === 0 && Number(booking.paid_amount || 0) > 0) {
            payments = [{
                id: `legacy-${booking.id}`,
                restaurant_id: currentUser.restaurantId,
                booking_id: booking.id,
                amount: Number(booking.paid_amount),
                payment_method: booking.advance_payment_method || 'cash',
                note: 'Advance',
                created_at: booking.created_at,
            }] as typeof payments
        }

        return NextResponse.json({
            success: true,
            payments,
            totalAdvance: payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
        })
    } catch (e: any) {
        console.error('[booking-payments-get] error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
