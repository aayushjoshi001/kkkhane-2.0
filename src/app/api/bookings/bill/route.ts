import { createAdminClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { buildBookingBill } from '@/lib/bookingBill'

/**
 * GET /api/bookings/bill?bookingId=<uuid>
 *
 * The complete bill for a stay: the one the guest was handed at checkout if it
 * has been settled, otherwise what it has run up so far. Room lines per room,
 * manual charges, every service order itemized, the charges and discounts that
 * were applied, and every payment taken against it.
 *
 * See lib/bookingBill.ts for where each figure comes from and why the settled
 * bill is read from the settlement snapshot rather than recomputed.
 *
 * Manager and above only. The payload carries the full payment trail — what was
 * taken in cash, what went on the guest's ledger, what was never collected — so
 * it is not a kitchen or bar login's to read. The proxy gates /admin but not
 * /api, so the check has to be here (see the fourth invariant in CLAUDE.md).
 */
export async function GET(req: NextRequest) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser?.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const allowedRoles = ['manager', 'super_admin']
        if (!allowedRoles.includes(currentUser.role)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        const bookingId = req.nextUrl.searchParams.get('bookingId')
        if (!bookingId) {
            return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const bill = await buildBookingBill(supabase, {
            restaurantId: currentUser.restaurantId,
            bookingId,
        })

        if (!bill) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        return NextResponse.json({ success: true, data: bill })
    } catch (e) {
        console.error('[bookings/bill] Unexpected error:', e)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
