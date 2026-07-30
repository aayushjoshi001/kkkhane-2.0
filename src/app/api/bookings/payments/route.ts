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

        // 3. Fallback: If booking_payments table has no records for this booking,
        // recover individual advance payment entries from day_book_entries / income_entries!
        if (payments.length === 0 && Number(booking.paid_amount || 0) > 0) {
            const roomNum = (booking.rooms as any)?.room_number

            // Search day_book_entries for room_deposit category around/after booking creation time
            const { data: dayBookRows } = await supabase
                .from('day_book_entries')
                .select('id, amount, description, type, created_at')
                .eq('restaurant_id', currentUser.restaurantId)
                .eq('category', 'room_deposit')
                .gte('created_at', new Date(new Date(booking.created_at).getTime() - 60000).toISOString())
                .order('created_at', { ascending: true })

            const guestNameLower = (booking.guest_name || '').toLowerCase().trim()
            const roomNumLower = roomNum ? String(roomNum).toLowerCase() : ''

            // Filter day book entries matching this guest or room
            const matchedEntries = (dayBookRows || []).filter(e => {
                const desc = (e.description || '').toLowerCase()
                return (guestNameLower && desc.includes(guestNameLower)) || (roomNumLower && desc.includes(`room ${roomNumLower}`))
            })

            if (matchedEntries.length > 0) {
                payments = matchedEntries.map(e => {
                    const method = e.type === 'cash_in' ? 'cash' : 'qr_digital'
                    let parsedNote = 'Advance'
                    if (e.description) {
                        const match = e.description.match(/Room Advance \((.*?)\):/i)
                        if (match && match[1]) {
                            const extracted = match[1].trim()
                            if (!['cash', 'qr/digital', 'split'].includes(extracted.toLowerCase())) {
                                parsedNote = extracted
                            }
                        } else {
                            const dLower = e.description.toLowerCase()
                            if (dLower.includes('dine in')) parsedNote = 'Dine in'
                            else if (dLower.includes('deposit')) parsedNote = 'Deposit'
                        }
                    }
                    return {
                        id: e.id,
                        restaurant_id: currentUser.restaurantId,
                        booking_id: booking.id,
                        amount: Number(e.amount),
                        payment_method: method,
                        note: parsedNote,
                        created_at: e.created_at
                    }
                })

                // Backfill to booking_payments table so subsequent queries read directly
                try {
                    await supabase.from('booking_payments').insert(
                        payments.map(p => ({
                            restaurant_id: currentUser.restaurantId,
                            booking_id: booking.id,
                            amount: p.amount,
                            payment_method: p.payment_method,
                            note: p.note,
                            created_at: p.created_at
                        }))
                    )
                } catch (backfillErr) {
                    console.error('Backfill booking_payments error:', backfillErr)
                }
            } else {
                // If no day book rows matched, query income_entries
                const { data: incomeRows } = await supabase
                    .from('income_entries')
                    .select('id, amount, description, created_at')
                    .eq('restaurant_id', currentUser.restaurantId)
                    .gte('created_at', new Date(new Date(booking.created_at).getTime() - 60000).toISOString())
                    .order('created_at', { ascending: true })

                const matchedIncome = (incomeRows || []).filter(e => {
                    const desc = (e.description || '').toLowerCase()
                    return desc.includes('advance') && ((guestNameLower && desc.includes(guestNameLower)) || (roomNumLower && desc.includes(`room ${roomNumLower}`)))
                })

                if (matchedIncome.length > 0) {
                    payments = matchedIncome.map(e => ({
                        id: e.id,
                        restaurant_id: currentUser.restaurantId,
                        booking_id: booking.id,
                        amount: Number(e.amount),
                        payment_method: booking.advance_payment_method || 'cash',
                        note: 'Advance',
                        created_at: e.created_at
                    }))
                } else {
                    // Final single fallback
                    payments = [{
                        id: `legacy-${booking.id}`,
                        restaurant_id: currentUser.restaurantId,
                        booking_id: booking.id,
                        amount: Number(booking.paid_amount),
                        payment_method: booking.advance_payment_method || 'cash',
                        note: 'Advance',
                        created_at: booking.created_at
                    }]
                }
            }
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
