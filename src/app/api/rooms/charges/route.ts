import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { resolveFolioBookingIds } from '@/lib/bookingGroup'

/**
 * Manual charges (minibar, laundry, …) on a stay's folio.
 *
 * A multi-room reservation bills as one folio, so this returns the charges from
 * every room on it — otherwise a charge posted to room 306 would drop off the
 * bill whenever the cashier settled from room 303. A single-room stay resolves
 * to just itself and behaves exactly as before.
 */
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
        const folioBookingIds = await resolveFolioBookingIds(supabase, bookingId)
        const { data, error } = await supabase
            .from('room_charges')
            .select('*')
            .in('booking_id', folioBookingIds)
            .eq('restaurant_id', currentUser.restaurantId)
            .order('created_at', { ascending: true })

        if (error) throw error
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, description, amount, charge_type } = body

        if (!booking_id || !description || !amount || !charge_type) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const numAmount = parseFloat(amount)
        if (isNaN(numAmount) || numAmount <= 0) {
            return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('room_charges')
            .insert({
                restaurant_id: currentUser.restaurantId,
                booking_id,
                description,
                amount: numAmount,
                charge_type,
                charged_by: currentUser.id
            })
            .select()
            .single()

        if (error) throw error
        return NextResponse.json({ success: true, data })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
