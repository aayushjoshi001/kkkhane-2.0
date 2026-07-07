import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { logAudit } from '@/lib/audit'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, room_id, total_amount, cash_paid, qr_paid } = body

        if (!booking_id || !room_id) {
            return NextResponse.json({ error: 'Missing booking_id or room_id' }, { status: 400 })
        }

        const parsedTotal = Number(total_amount)
        if (!Number.isFinite(parsedTotal) || parsedTotal < 0) {
            return NextResponse.json({ error: 'total_amount must be a number >= 0' }, { status: 400 })
        }
        const settledNow = (Number(cash_paid) || 0) + (Number(qr_paid) || 0)

        const supabase = await createAdminClient()

        // 0. Fetch the existing booking to combine the settlement with the advance already collected
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select('id, paid_amount, status')
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }
        if (booking.status === 'checked_out') {
            return NextResponse.json({ error: 'Booking is already checked out' }, { status: 409 })
        }

        const newPaidAmount = (Number(booking.paid_amount) || 0) + settledNow
        const paymentStatus =
            parsedTotal > 0 && newPaidAmount >= parsedTotal ? 'paid'
                : newPaidAmount > 0 ? 'partial'
                    : 'unpaid'

        // 1. Persist the settlement and update booking status
        const { error: bookingError } = await supabase
            .from('bookings')
            .update({
                status: 'checked_out',
                total_amount: parsedTotal,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
            })
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (bookingError) throw bookingError

        // 2. Update Room status to dirty
        const { error: roomError } = await supabase
            .from('rooms')
            .update({ status: 'dirty' })
            .eq('id', room_id)
            .eq('restaurant_id', currentUser.restaurantId)

        if (roomError) throw roomError

        void logAudit({
            restaurantId: currentUser.restaurantId,
            userId: currentUser.id,
            action: 'booking_checked_out',
            entityType: 'booking',
            entityId: booking_id,
            newValue: {
                total_amount: parsedTotal,
                paid_amount: newPaidAmount,
                payment_status: paymentStatus,
                cash_paid: Number(cash_paid) || 0,
                qr_paid: Number(qr_paid) || 0,
            },
        })

        return NextResponse.json({ success: true })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
