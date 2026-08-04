// Everything the room panel needs, in one request.
//
// Opening an occupied room used to cost two sequential browser round trips:
// /api/rooms/booking first, then — only once the booking id came back — a
// parallel burst of /api/rooms/charges, /api/bookings/linked-orders and
// /api/bookings/group. From Kathmandu each hop to the edge is ~300ms whatever
// the server does, so the panel could not open in less than about twice that,
// and it spent four separate function invocations doing it. The same shape was
// duplicated on the cashier's billing screen.
//
// The dependency is real — three of the four calls need the booking id — but it
// belongs on the server, where the hop between them is a local round trip
// rather than a trans-continental one. So the waterfall stays, and simply moves
// to where each step is cheap.
//
// The four original endpoints are untouched and still serve their other
// callers. Rather than restate 450 lines of billing logic here, this composes
// their handlers directly: each authenticates from cookies via
// getCurrentUser()/getOptionalUser() rather than from the request it is passed,
// so a synthetic Request carrying only the query string is all they need, and
// the answers are the same ones the browser used to get. getCurrentUser is
// React-cached per request, so the four calls share one identity lookup.
import { NextRequest, NextResponse } from 'next/server'
import { GET as getRoomBooking } from '@/app/api/rooms/booking/route'
import { GET as getRoomCharges } from '@/app/api/rooms/charges/route'
import { GET as getLinkedOrders } from '@/app/api/bookings/linked-orders/route'
import { GET as getStayGroup } from '@/app/api/bookings/group/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The composed handlers only ever read searchParams off the URL, so the origin
// is irrelevant — but Request still demands an absolute one.
const synthetic = (qs: string) => new NextRequest(new URL(`http://internal/?${qs}`))

/** Best-effort JSON: a sub-call that fails must not take the whole panel down. */
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
    try {
        return res.ok ? await res.json() : null
    } catch {
        return null
    }
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url)
        const roomId = searchParams.get('roomId')
        // A caller that already holds the booking (the room billing modal) skips
        // the lookup and goes straight to the three dependent reads.
        const knownBookingId = searchParams.get('bookingId')

        if (!roomId && !knownBookingId) {
            return NextResponse.json({ error: 'Missing roomId or bookingId' }, { status: 400 })
        }

        let booking: Record<string, unknown> | null = null

        if (!knownBookingId) {
            const bookingRes = await getRoomBooking(synthetic(`roomId=${encodeURIComponent(roomId!)}`))
            // Propagate a real refusal rather than reporting an empty room: 401
            // here means the session went stale, and showing "no booking" would
            // read as a checked-out guest.
            if (bookingRes.status === 401) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            const bookingBody = await readJson(bookingRes)
            booking = (bookingBody?.data as Record<string, unknown> | null) ?? null

            // Vacant room — nothing downstream to ask for.
            if (!booking?.id) {
                return NextResponse.json({ success: true, booking: null, charges: [], linkedOrders: [], group: null })
            }
        }

        const bookingId = String(knownBookingId ?? booking!.id)
        const qs = `bookingId=${encodeURIComponent(bookingId)}`

        const [chargesBody, linkedBody, groupBody] = await Promise.all([
            getRoomCharges(synthetic(qs)).then(readJson),
            getLinkedOrders(synthetic(qs)).then(readJson),
            getStayGroup(synthetic(qs)).then(readJson),
        ])

        return NextResponse.json({
            success: true,
            // Callers passing bookingId already have the booking and ignore this.
            booking,
            charges: chargesBody?.success ? (chargesBody.data ?? []) : [],
            linkedOrders: linkedBody?.success ? (linkedBody.items ?? []) : [],
            // The group endpoint answers isGroup:false for a single-room stay,
            // which the screens represent as no group at all.
            group: groupBody?.success && groupBody.isGroup ? groupBody : null,
        })
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
